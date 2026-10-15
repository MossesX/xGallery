import { Router } from 'express'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { db, MEDIA_DIR, mediaRel, now, removeMedia } from '../db.js'
import { requirePerm, requireUser, type User } from '../auth.js'
import { HttpError, num, parseJson, str, wrap, IdRow } from '../util.js'
import { commentJson, mediaJson } from '../serialize.js'
import { canManageGallery, canViewAlbum } from '../access.js'
import { track } from '../activity.js'
import { hasPinAccess } from '../pin.js'
import { notify } from '../notifications.js'
import { getPolicy } from '../policy.js'
import { visibleAlbumRows } from '../access.js'

export const mediaRouter = Router()

const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES ?? 2 * 1024 * 1024 * 1024)

export function removeMediaFiles(row: Record<string, unknown>): void {
  for (const p of [row.file_path, row.thumb_path]) if (typeof p === 'string' && p) removeMedia(p)
}

function extFor(mime: string, name: string): string {
  const fromName = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, '')
  if (fromName && fromName.length <= 6) return fromName
  const map: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' }
  return map[mime] ?? ''
}

async function streamToFile(req: import('express').Request, rel: string): Promise<number> {
  const abs = path.join(MEDIA_DIR, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > MAX_UPLOAD) throw new HttpError(413, 'File is too large')
  let received = 0
  req.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (received > MAX_UPLOAD) req.destroy(new HttpError(413, 'File is too large'))
  })
  await pipeline(req, createWriteStream(abs))
  return (await stat(abs)).size
}

function loadMedia(id: number): IdRow {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as IdRow | undefined
  if (!row) throw new HttpError(404, 'Media not found')
  return row
}

function canView(req: import('express').Request, row: Record<string, unknown>): boolean {
  const album = db.prepare('SELECT id, gallery_id, visibility, restricted, share_token FROM albums WHERE id = ?').get(row.album_id as number) as
    | { id: number; gallery_id: number; visibility: string; restricted: number; share_token: string | null }
    | undefined
  if (!album) return false
  const share = typeof req.query.s === 'string' ? req.query.s : ''
  if (share && ((album.share_token && share === album.share_token) || db.prepare('SELECT 1 FROM album_links WHERE token = ? AND album_id = ? AND revoked_at IS NULL').get(share, album.id)) && (album.visibility !== 'shared' || hasPinAccess(req, album.id))) return true
  // Public gallery landing: the gallery's designated public album, or its splash image.
  const gslug = typeof req.query.g === 'string' ? req.query.g : ''
  if (gslug) {
    const g = db.prepare('SELECT id, splash_media_id FROM galleries WHERE slug = ?').get(gslug) as { id: number; splash_media_id: number | null } | undefined
    if (g && ((album.gallery_id === g.id && album.visibility === 'public') || g.splash_media_id === row.id)) return true
  }
  if (album.visibility === 'public') return true
  if (!req.user) return false
  return canViewAlbum(req.user, album)
}

function requireManage(req: import('express').Request, albumId: number): void {
  const album = db.prepare('SELECT gallery_id FROM albums WHERE id = ?').get(albumId) as { gallery_id: number } | undefined
  if (!album) throw new HttpError(404, 'Album not found')
  if (canManageGallery(req.user, album.gallery_id)) return
  if (db.prepare('SELECT 1 FROM album_collaborators WHERE album_id = ? AND user_id = ?').get(albumId, req.user!.id)) return
  throw new HttpError(403, 'This album belongs to another gallery')
}

/* ---------- reactions + timeline ---------- */

const EMOJI = ['❤️', '👍', '😂', '😮', '😢', '🔥', '👏', '🎉']

mediaRouter.post(
  '/media/:id/react',
  requireUser,
  requirePerm('canReact'),
  wrap((req, res) => {
    const row = loadMedia(Number(req.params.id))
    if (!canView(req, row)) throw new HttpError(404, 'Not available')
    const emoji = str(req.body?.emoji, 8)
    if (emoji && !EMOJI.includes(emoji)) throw new HttpError(400, 'Unknown reaction')
    if (!emoji) db.prepare('DELETE FROM reactions WHERE user_id = ? AND media_id = ?').run(req.user!.id, row.id)
    else {
      db.prepare('INSERT INTO reactions(user_id, media_id, emoji, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, media_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at').run(req.user!.id, row.id, emoji, now())
      const owner = db.prepare('SELECT g.owner_user_id o, a.slug s FROM albums a JOIN galleries g ON g.id = a.gallery_id WHERE a.id = ?').get(row.album_id as number) as { o: number; s: string } | undefined
      if (owner && owner.o !== req.user!.id) notify({ userId: owner.o, kind: 'media.reaction', title: `${req.user!.display_name} reacted ${emoji} to “${row.title}”`, actorId: req.user!.id, data: { mediaId: row.id, albumSlug: owner.s, emoji } })
    }
    track(req, emoji ? 'media.react' : 'media.unreact', { targetType: 'media', targetId: row.id as number, targetLabel: String(row.title ?? ''), detail: { emoji } })
    res.json({ media: mediaJson(loadMedia(row.id as number), req.user!.id), emoji: EMOJI })
  }),
)

/** Google-Photos style timeline: everything the member may see, newest first, with day grouping keys. */
mediaRouter.get(
  '/media/timeline',
  requireUser,
  wrap((req, res) => {
    const before = req.query.before ? Number(req.query.before) : Date.now() + 1
    const limit = Math.min(400, Number(req.query.limit) || 120)
    const kind = str(req.query.kind, 10)
    const q = str(req.query.q, 80).toLowerCase()
    const albums = visibleAlbumRows(req.user!).map((r) => r.id as number)
    if (!albums.length) return res.json({ items: [], nextBefore: null })
    const marks = albums.map(() => '?').join(',')
    const rows = db
      .prepare(`SELECT m.*, a.slug AS album_slug, a.title AS album_title FROM media m JOIN albums a ON a.id = m.album_id WHERE m.album_id IN (${marks}) AND m.created_at < ? ${kind ? 'AND m.kind = ?' : ''} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`)
      .all(...albums, before, ...(kind ? [kind] : []), limit) as IdRow[]
    const items = rows
      .filter((r) => !q || `${r.title} ${r.description} ${r.album_title}`.toLowerCase().includes(q))
      .map((r) => ({ ...mediaJson(r, req.user!.id), album: { slug: r.album_slug, title: r.album_title }, day: new Date(r.created_at as number).toISOString().slice(0, 10) }))
    res.json({ items, nextBefore: rows.length >= limit ? (rows[rows.length - 1].created_at as number) : null })
  }),
)

/* ---------- upload (admin) ---------- */

mediaRouter.post(
  '/albums/:albumId/media',
  requireUser,
  requirePerm('canUpload'),
  wrap(async (req, res) => {
    const albumId = Number(req.params.albumId)
    requireManage(req, albumId)
    const meta = parseJson<Record<string, unknown>>(Buffer.from(str(req.headers['x-meta'], 4000) || 'e30=', 'base64').toString('utf8'), {})
    const mime = str(req.headers['content-type'], 100) || 'application/octet-stream'
    const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : null
    if (!kind) throw new HttpError(415, `Unsupported file type: ${mime}`)
    const policy = getPolicy()
    if (!policy.allowedTypes.some((t) => mime.startsWith(t))) throw new HttpError(415, `The owner does not allow ${mime} uploads`)
    const declaredBytes = Number(req.headers['content-length'] ?? 0)
    const maxMb = req.user!.limits.maxUploadMb
    if (maxMb > 0 && declaredBytes > maxMb * 1024 * 1024) throw new HttpError(413, `Files may be at most ${maxMb} MB for your account`)
    const quotaMb = req.user!.limits.storageQuotaMb
    if (quotaMb > 0) {
      const used = (db.prepare('SELECT COALESCE(SUM(m.size), 0) s FROM media m JOIN albums a ON a.id = m.album_id JOIN galleries g ON g.id = a.gallery_id WHERE g.owner_user_id = ?').get(req.user!.id) as { s: number }).s
      if (used + declaredBytes > quotaMb * 1024 * 1024) throw new HttpError(413, `Storage quota reached (${quotaMb} MB). Delete something or ask the owner for more.`)
    }
    const perAlbum = req.user!.limits.maxMediaPerAlbum
    if (perAlbum > 0 && (db.prepare('SELECT COUNT(*) c FROM media WHERE album_id = ?').get(albumId) as { c: number }).c >= perAlbum) throw new HttpError(403, `Albums may hold ${perAlbum} items for your account`)
    const name = str(meta.fileName, 200) || 'upload'
    const rel = mediaRel(path.posix.join(String(albumId), `${now()}-${randomBytes(4).toString('hex')}${extFor(mime, name)}`))
    const size = await streamToFile(req, rel)
    const last = db.prepare('SELECT MAX(sort_order) m FROM media WHERE album_id = ?').get(albumId) as { m: number | null }
    const info = db
      .prepare('INSERT INTO media(album_id, kind, title, description, mime, file_path, width, height, size, duration, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(albumId, kind, str(meta.title, 200) || name.replace(/\.[^.]+$/, ''), '', mime, rel, num(meta.width), num(meta.height), size, meta.duration == null ? null : num(meta.duration), (last.m ?? 0) + 1, now())
    db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now(), albumId)
    track(req, 'media.upload', { targetType: 'media', targetId: info.lastInsertRowid as number, targetLabel: name, detail: { albumId, kind, size } })
    res.status(201).json({ media: mediaJson(loadMedia(info.lastInsertRowid as number), req.user!.id) })
  }),
)

mediaRouter.post(
  '/media/:id/thumb',
  requireUser,
  wrap(async (req, res) => {
    const row = loadMedia(Number(req.params.id))
    requireManage(req, row.album_id as number)
    const rel = (row.file_path as string).replace(/\.[^.]*$/, '') + '.thumb.webp'
    await streamToFile(req, rel)
    db.prepare('UPDATE media SET thumb_path = ? WHERE id = ?').run(rel, row.id)
    res.json({ media: mediaJson(loadMedia(row.id as number), req.user!.id) })
  }),
)

/* ---------- files ---------- */

function sendFile(res: import('express').Response, rel: string, mime: string, download?: string) {
  const abs = path.join(MEDIA_DIR, rel)
  if (!existsSync(abs)) throw new HttpError(404, 'File missing')
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  const headers: Record<string, string> = { 'Content-Type': mime }
  if (download) headers['Content-Disposition'] = `attachment; filename="${download.replace(/["\r\n]/g, '')}"`
  res.sendFile(abs, { headers, acceptRanges: true })
}

mediaRouter.get(
  '/media/:id/file',
  wrap((req, res) => {
    const row = loadMedia(Number(req.params.id))
    if (!canView(req, row)) throw new HttpError(req.user ? 404 : 401, 'Not available')
    if (req.query.download != null && req.user && !req.user.perms.canDownload) throw new HttpError(403, 'Your account is not allowed to download originals. Ask the owner.')
    const dl = req.query.download != null ? `${(row.title as string) || 'media'}${path.extname(row.file_path as string)}` : undefined
    sendFile(res, row.file_path as string, row.mime as string, dl)
  }),
)

mediaRouter.get(
  '/media/:id/thumb',
  wrap((req, res) => {
    const row = loadMedia(Number(req.params.id))
    if (!canView(req, row)) throw new HttpError(req.user ? 404 : 401, 'Not available')
    if (row.thumb_path) sendFile(res, row.thumb_path as string, 'image/webp')
    else sendFile(res, row.file_path as string, row.mime as string)
  }),
)

/* ---------- metadata (admin) ---------- */

mediaRouter.put(
  '/media/reorder',
  requireUser,
  wrap((req, res) => {
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : []
    if (ids.length) requireManage(req, (loadMedia(ids[0]).album_id as number))
    const upd = db.prepare('UPDATE media SET sort_order = ? WHERE id = ?')
    ids.forEach((id, i) => upd.run(i + 1, id))
    res.json({ ok: true })
  }),
)

mediaRouter.put(
  '/media/:id',
  requireUser,
  wrap((req, res) => {
    const row = loadMedia(Number(req.params.id))
    requireManage(req, row.album_id as number)
    const title = req.body?.title != null ? str(req.body.title, 200) : (row.title as string)
    const description = req.body?.description != null ? str(req.body.description, 2000) : (row.description as string)
    db.prepare('UPDATE media SET title = ?, description = ? WHERE id = ?').run(title, description, row.id)
    res.json({ media: mediaJson(loadMedia(row.id as number), req.user!.id) })
  }),
)

mediaRouter.delete(
  '/media/:id',
  requireUser,
  wrap((req, res) => {
    const row = loadMedia(Number(req.params.id))
    requireManage(req, row.album_id as number)
    db.prepare('UPDATE galleries SET splash_media_id = NULL WHERE splash_media_id = ?').run(row.id)
    db.prepare('DELETE FROM media WHERE id = ?').run(row.id)
    db.prepare('UPDATE albums SET cover_media_id = NULL WHERE cover_media_id = ?').run(row.id)
    removeMediaFiles(row)
    track(req, 'media.delete', { targetType: 'media', targetId: row.id as number, targetLabel: String(row.title ?? '') })
    res.json({ ok: true })
  }),
)

/* ---------- social ---------- */

mediaRouter.post(
  '/media/:id/view',
  requireUser,
  wrap((req, res) => {
    db.prepare('UPDATE media SET views = views + 1 WHERE id = ?').run(Number(req.params.id))
    res.json({ ok: true })
  }),
)

mediaRouter.post(
  '/media/:id/like',
  requireUser,
  requirePerm('canReact'),
  wrap((req, res) => {
    const row = loadMedia(Number(req.params.id))
    if (!canView(req, row)) throw new HttpError(404, 'Media not found')
    const existing = db.prepare('SELECT id FROM likes WHERE user_id = ? AND media_id = ?').get(req.user!.id, row.id)
    if (existing) db.prepare('DELETE FROM likes WHERE id = ?').run((existing as { id: number }).id)
    else db.prepare('INSERT INTO likes(user_id, media_id, created_at) VALUES (?, ?, ?)').run(req.user!.id, row.id, now())
    track(req, existing ? 'media.unlike' : 'media.like', { targetType: 'media', targetId: row.id as number, targetLabel: String(row.title ?? '') })
    if (!existing) {
      const owner = db.prepare('SELECT g.owner_user_id o, a.slug s, a.title t FROM albums a JOIN galleries g ON g.id = a.gallery_id WHERE a.id = ?').get(row.album_id as number) as { o: number; s: string; t: string } | undefined
      if (owner && owner.o !== req.user!.id) notify({ userId: owner.o, kind: 'media.like', title: `${req.user!.display_name} liked “${row.title || owner.t}”`, actorId: req.user!.id, data: { mediaId: row.id, albumSlug: owner.s } })
    }
    res.json({ media: mediaJson(loadMedia(row.id as number), req.user!.id) })
  }),
)

mediaRouter.get(
  '/media/:id/comments',
  requireUser,
  wrap((req, res) => {
    const row = loadMedia(Number(req.params.id))
    if (!canView(req, row)) throw new HttpError(404, 'Media not found')
    const comments = db
      .prepare('SELECT c.*, u.display_name, u.username, u.avatar_path FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.media_id = ? ORDER BY c.created_at')
      .all(row.id) as IdRow[]
    res.json({ comments: visibleComments(req, comments, galleryOfMedia(row)).map(commentJson) })
  }),
)

mediaRouter.post(
  '/media/:id/comments',
  requireUser,
  requirePerm('canComment'),
  wrap((req, res) => {
    const row = loadMedia(Number(req.params.id))
    if (!canView(req, row)) throw new HttpError(404, 'Media not found')
    const body = str(req.body?.body, 2000)
    if (!body) throw new HttpError(400, 'Comment cannot be empty')
    const held = getPolicy().moderateComments && !canManageGallery(req.user, galleryOfMedia(row) ?? -1)
    const info = db.prepare('INSERT INTO comments(user_id, media_id, body, created_at, approved) VALUES (?, ?, ?, ?, ?)').run(req.user!.id, row.id, body, now(), held ? 0 : 1)
    const c = db.prepare('SELECT c.*, u.display_name, u.username, u.avatar_path FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(info.lastInsertRowid as number) as IdRow
    track(req, 'comment.media', { targetType: 'media', targetId: row.id as number, targetLabel: String(row.title ?? ''), detail: { body: String(c.body ?? '').slice(0, 140), held } })
    const ownerRow = db.prepare('SELECT g.owner_user_id o, a.slug s FROM albums a JOIN galleries g ON g.id = a.gallery_id WHERE a.id = ?').get(row.album_id as number) as { o: number; s: string } | undefined
    if (ownerRow && ownerRow.o !== req.user!.id)
      notify({ userId: ownerRow.o, kind: held ? 'comment.pending' : 'comment.media', title: held ? `${req.user!.display_name} left a comment on “${row.title}” that needs your approval` : `${req.user!.display_name} commented on “${row.title}”`, body: String(c.body ?? '').slice(0, 200), actorId: req.user!.id, data: { mediaId: row.id, albumSlug: ownerRow.s, commentId: c.id } })
    res.status(201).json({ comment: commentJson(c), held })
  }),
)

/** Which comments a viewer sees: approved ones, their own, and (for the album's managers) everything. */
export function visibleComments(req: { user?: User }, rows: IdRow[], galleryId: number | null | undefined): IdRow[] {
  const manages = galleryId != null && canManageGallery(req.user, galleryId)
  return rows.filter((c) => c.approved !== 0 || manages || c.user_id === req.user?.id)
}

function galleryOfMedia(row: IdRow): number | null {
  return (db.prepare('SELECT gallery_id FROM albums WHERE id = ?').get(row.album_id as number) as { gallery_id: number } | undefined)?.gallery_id ?? null
}

/** Album managers approve a held comment. */
mediaRouter.post(
  '/comments/:id/approve',
  requireUser,
  wrap((req, res) => {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(req.params.id)) as IdRow | undefined
    if (!c) throw new HttpError(404, 'Comment not found')
    const albumId = (c.album_id as number | null) ?? (db.prepare('SELECT album_id FROM media WHERE id = ?').get(c.media_id as number) as { album_id: number } | undefined)?.album_id
    const galleryId = albumId ? (db.prepare('SELECT gallery_id FROM albums WHERE id = ?').get(albumId) as { gallery_id: number } | undefined)?.gallery_id : undefined
    if (galleryId == null || !canManageGallery(req.user, galleryId)) throw new HttpError(403, 'Only the album owner can approve comments')
    db.prepare('UPDATE comments SET approved = 1 WHERE id = ?').run(c.id)
    track(req, 'comment.approve', { targetType: 'comment', targetId: c.id as number, detail: { body: String(c.body ?? '').slice(0, 140) } })
    const full = db.prepare('SELECT c.*, u.display_name, u.username, u.avatar_path FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(c.id) as IdRow
    res.json({ comment: commentJson(full) })
  }),
)

mediaRouter.delete(
  '/comments/:id',
  requireUser,
  wrap((req, res) => {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(req.params.id)) as IdRow | undefined
    if (!c) throw new HttpError(404, 'Comment not found')
    const albumId = (c.album_id as number | null) ?? (db.prepare('SELECT album_id FROM media WHERE id = ?').get(c.media_id as number) as { album_id: number } | undefined)?.album_id
    const galleryId = albumId ? (db.prepare('SELECT gallery_id FROM albums WHERE id = ?').get(albumId) as { gallery_id: number } | undefined)?.gallery_id : undefined
    const moderating = req.query.moderate != null && galleryId != null && canManageGallery(req.user, galleryId)
    if (c.user_id !== req.user!.id && !moderating) throw new HttpError(403, 'You can only delete your own comments')
    db.prepare('DELETE FROM comments WHERE id = ?').run(c.id)
    res.json({ ok: true })
  }),
)
