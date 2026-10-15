import { Router } from 'express'
import express from 'express'
import { randomBytes } from 'node:crypto'
import { db, now } from '../db.js'
import { hashPassword, requirePerm, requireUser, verifyPassword } from '../auth.js'
import { hasPinAccess, issuePin, PIN_RE, pinAttemptAllowed, pinAttemptFailed, pinAttemptReset } from '../pin.js'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { canManageGallery, canViewAlbum, galleryOf, isOwner, managedGalleryIds, visibleAlbumRows } from '../access.js'
import { HttpError, bool, num, slugify, str, wrap, IdRow } from '../util.js'
import { albumJson, commentJson, mediaJson } from '../serialize.js'
import { removeMediaFiles, visibleComments } from './media.js'
import { track, logActivity } from '../activity.js'
import { notify, notifyOwner } from '../notifications.js'
import { writeZip } from '../zip.js'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { MEDIA_DIR } from '../db.js'
import { galleryById } from '../access.js'
import { getPolicy } from '../policy.js'

export const albumsRouter = Router()


function uniqueSlug(base: string, excludeId?: number): string {
  const root = slugify(base)
  let slug = root
  let n = 2
  while (db.prepare('SELECT id FROM albums WHERE slug = ? AND id <> ?').get(slug, excludeId ?? -1)) slug = `${root}-${n++}`
  return slug
}

albumsRouter.get(
  '/',
  requireUser,
  wrap((req, res) => {
    const q = str(req.query.q, 100).toLowerCase()
    const tag = str(req.query.tag, 60).toLowerCase()
    const sort = str(req.query.sort, 20) || 'manual'
    const order =
      sort === 'newest' ? 'created_at DESC' : sort === 'updated' ? 'updated_at DESC' : sort === 'title' ? 'title COLLATE NOCASE' : sort === 'popular' ? 'views DESC' : 'sort_order, created_at'
    const galleryFilter = str(req.query.gallery, 80)
    const mine = req.query.mine != null
    let rows = visibleAlbumRows(req.user!, mine) as IdRow[]
    if (galleryFilter) rows = rows.filter((r) => String(r.gallery_id) === galleryFilter)
    if (mine) {
      const managed = new Set(managedGalleryIds(req.user!))
      rows = rows.filter((r) => managed.has(r.gallery_id as number))
    }
    rows = rows.sort((a, b) => {
      const key = (r: IdRow) => (sort === 'newest' ? -(r.created_at as number) : sort === 'updated' ? -(r.updated_at as number) : sort === 'popular' ? -(r.views as number) : sort === 'title' ? 0 : (r.sort_order as number))
      if (sort === 'title') return String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' })
      return key(a) - key(b)
    })
    void order
    if (q) rows = rows.filter((r) => `${r.title} ${r.description} ${r.tags}`.toLowerCase().includes(q))
    if (tag) rows = rows.filter((r) => (JSON.parse(r.tags as string) as string[]).map((t) => t.toLowerCase()).includes(tag))
    const managedSet = new Set(managedGalleryIds(req.user!))
    const albums = rows.map((r) => albumJson(r, req.user!.id, { access: mine && managedSet.has(r.gallery_id as number) }))
    const tags = new Map<string, number>()
    for (const a of albums) for (const t of a.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
    res.json({ albums, tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })) })
  }),
)

albumsRouter.get(
  '/favorites',
  requireUser,
  wrap((req, res) => {
    const rows = db.prepare('SELECT a.* FROM favorites f JOIN albums a ON a.id = f.album_id WHERE f.user_id = ? ORDER BY f.created_at DESC').all(req.user!.id) as IdRow[]
    const visible = rows.filter((r) => canViewAlbum(req.user, { id: r.id, gallery_id: r.gallery_id as number, visibility: r.visibility as string, restricted: r.restricted as number }))
    res.json({ albums: visible.map((r) => albumJson(r, req.user!.id)) })
  }),
)

albumsRouter.post(
  '/',
  requireUser,
  requirePerm('canUpload'),
  wrap((req, res) => {
    const title = str(req.body?.title, 120)
    if (!title) throw new HttpError(400, 'Title is required')
    let galleryId = req.body?.galleryId != null ? num(req.body.galleryId) : (galleryOf(req.user!.id)?.id ?? null)
    if (galleryId == null && isOwner(req.user)) galleryId = galleryOf(req.user!.id)?.id ?? null
    if (galleryId == null || !canManageGallery(req.user, galleryId)) throw new HttpError(403, 'You can only create albums in your own gallery')
    const maxAlbums = req.user!.limits.maxAlbums
    if (maxAlbums > 0 && (db.prepare('SELECT COUNT(*) c FROM albums a JOIN galleries g ON g.id = a.gallery_id WHERE g.owner_user_id = ?').get(req.user!.id) as { c: number }).c >= maxAlbums) throw new HttpError(403, `Your account may have ${maxAlbums} albums. Ask the owner for more.`)
    const t = now()
    const last = db.prepare('SELECT MAX(sort_order) m FROM albums').get() as { m: number | null }
    const info = db
      .prepare('INSERT INTO albums(slug, title, description, visibility, tags, sort_order, created_at, updated_at, gallery_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uniqueSlug(title), title, str(req.body?.description, 2000), 'draft', JSON.stringify([]), (last.m ?? 0) + 1, t, t, galleryId)
    const newId = info.lastInsertRowid as number
    // Optionally make the new album the gallery's public album (visible without login, shown first on the public page).
    if (req.body?.makePublic === true) {
      if (!req.user!.perms.canPublish) throw new HttpError(403, 'Your account is not allowed to make albums public. Ask the owner.')
      db.prepare("UPDATE albums SET visibility = 'public' WHERE id = ?").run(newId)
      db.prepare('UPDATE galleries SET public_album_id = ?, updated_at = ? WHERE id = ?').run(newId, t, galleryId)
    }
    const row = db.prepare('SELECT * FROM albums WHERE id = ?').get(newId) as IdRow
    track(req, 'album.create', { targetType: 'album', targetId: newId, targetLabel: title, detail: { public: req.body?.makePublic === true } })
    notifyOwner({ kind: 'album.new', title: `New album “${title}” by ${req.user!.display_name}`, body: req.body?.makePublic === true ? 'Created as the public album' : '', actorId: req.user!.id, data: { albumId: newId, slug: row.slug, galleryId, username: req.user!.username, email: req.user!.email, phone: req.user!.phone } })
    res.status(201).json({ album: albumJson(row, req.user!.id) })
  }),
)

albumsRouter.put(
  '/reorder',
  requireUser,
  wrap((req, res) => {
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : []
    const managed = managedGalleryIds(req.user!)
    const upd = db.prepare(`UPDATE albums SET sort_order = ? WHERE id = ? AND gallery_id IN (${managed.map(() => '?').join(',') || 'NULL'})`)
    ids.forEach((id, i) => upd.run(i + 1, id, ...managed))
    res.json({ ok: true })
  }),
)

type AlbumRow = IdRow & { visibility: string; tags: string; gallery_id: number; restricted: number }

function loadAlbum(req: import('express').Request, key: string): AlbumRow {
  const byId = /^\d+$/.test(key)
  const row = db.prepare(`SELECT * FROM albums WHERE ${byId ? 'id' : 'slug'} = ?`).get(byId ? Number(key) : key) as AlbumRow | undefined
  if (!row) throw new HttpError(404, 'Album not found')
  if (!canViewAlbum(req.user, row)) throw new HttpError(404, 'Album not found')
  return row
}

function loadManaged(req: import('express').Request, id: number): AlbumRow {
  const row = db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as AlbumRow | undefined
  if (!row) throw new HttpError(404, 'Album not found')
  if (!canManageGallery(req.user, row.gallery_id)) throw new HttpError(403, 'This album belongs to another gallery')
  return row
}

albumsRouter.get(
  '/:key',
  requireUser,
  wrap((req, res) => {
    const row = loadAlbum(req, req.params.key as string)
    db.prepare('UPDATE albums SET views = views + 1 WHERE id = ?').run(row.id)
    const media = db.prepare('SELECT * FROM media WHERE album_id = ? ORDER BY sort_order, id').all(row.id) as IdRow[]
    const comments = db
      .prepare('SELECT c.*, u.display_name, u.username, u.avatar_path FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.album_id = ? AND c.media_id IS NULL ORDER BY c.created_at')
      .all(row.id) as IdRow[]
    const manage = canManageGallery(req.user, row.gallery_id)
    res.json({ album: albumJson(row, req.user!.id, { access: manage }), media: media.map((m) => mediaJson(m, req.user!.id)), comments: visibleComments(req, comments, row.gallery_id).map(commentJson), canManage: manage })
  }),
)

albumsRouter.put(
  '/:id',
  requireUser,
  wrap((req, res) => {
    const id = Number(req.params.id)
    const row = loadManaged(req, id)
    const b = req.body ?? {}
    const title = str(b.title, 120) || (row.title as string)
    const slug = b.slug != null ? uniqueSlug(str(b.slug, 80) || title, id) : (row.slug as string)
    const description = b.description != null ? str(b.description, 2000) : (row.description as string)
    const visibility = b.visibility === 'published' || b.visibility === 'draft' || b.visibility === 'public' || b.visibility === 'shared' ? b.visibility : row.visibility
    const pin = typeof b.pin === 'string' ? b.pin.trim() : ''
    if (visibility === 'shared' && !isOwner(req.user) && !req.user!.perms.canShareLinks) throw new HttpError(403, 'Your account is not allowed to share albums behind a PIN. Ask the owner.')
    if (visibility === 'shared' && !pin && !row.pin_hash) throw new HttpError(400, 'Set a PIN of 4 to 8 digits for the shared album')
    if (pin && !PIN_RE.test(pin)) throw new HttpError(400, 'The PIN must be 4 to 8 digits')
    if (pin) {
      const salt = randomBytes(16).toString('hex')
      db.prepare('UPDATE albums SET pin_hash = ?, pin_salt = ?, pin_set_at = ? WHERE id = ?').run(hashPassword(pin, salt), salt, now(), id)
    }
    if (b.galleryId != null && num(b.galleryId) !== row.gallery_id) {
      const target = num(b.galleryId)
      if (!canManageGallery(req.user, target)) throw new HttpError(403, 'You can only move albums between your own galleries')
      db.prepare('UPDATE galleries SET public_album_id = NULL WHERE public_album_id = ?').run(id)
      db.prepare('UPDATE albums SET gallery_id = ? WHERE id = ?').run(target, id)
      track(req, 'album.move', { targetType: 'album', targetId: id, detail: { from: row.gallery_id, to: target } })
    }
    if (visibility === 'public' && row.visibility !== 'public' && !req.user!.perms.canPublish) throw new HttpError(403, 'Your account is not allowed to make albums public. Ask the owner.')
    const tags = Array.isArray(b.tags) ? JSON.stringify(b.tags.map((t: unknown) => str(t, 40)).filter(Boolean).slice(0, 20)) : (row.tags as string)
    const layout = 'layoutOverride' in b ? (b.layoutOverride ? JSON.stringify(b.layoutOverride) : null) : (row.layout_override as string | null)
    const featured = 'featured' in b ? (bool(b.featured) ? 1 : 0) : (row.featured as number)
    const cover = 'coverMediaId' in b ? (b.coverMediaId == null ? null : num(b.coverMediaId)) : (row.cover_media_id as number | null)
    db.prepare(
      'UPDATE albums SET title = ?, slug = ?, description = ?, visibility = ?, tags = ?, layout_override = ?, featured = ?, cover_media_id = ?, updated_at = ? WHERE id = ?',
    ).run(title, slug, description, visibility as string, tags, layout, featured, cover, now(), id)
    // An album that stops being public can no longer be the gallery's public hook.
    if (visibility !== 'public') db.prepare('UPDATE galleries SET public_album_id = NULL WHERE public_album_id = ? AND id = ?').run(id, row.gallery_id)
    track(req, visibility !== row.visibility ? 'album.visibility' : 'album.update', { targetType: 'album', targetId: id, targetLabel: title, detail: visibility !== row.visibility ? { from: row.visibility, to: visibility } : {} })
    res.json({ album: albumJson(db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as IdRow, req.user!.id, { access: true }) })
  }),
)

/** Per-user access: restricted albums are visible only to the listed members. */
albumsRouter.put(
  '/:id/access',
  requireUser,
  wrap((req, res) => {
    const row = loadManaged(req, Number(req.params.id))
    const restricted = bool(req.body?.restricted, !!row.restricted)
    const ids: number[] = Array.isArray(req.body?.userIds) ? (req.body.userIds as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : []
    db.prepare('UPDATE albums SET restricted = ?, updated_at = ? WHERE id = ?').run(restricted ? 1 : 0, now(), row.id)
    db.prepare('DELETE FROM album_access WHERE album_id = ?').run(row.id)
    const ins = db.prepare('INSERT OR IGNORE INTO album_access(album_id, user_id, created_at) VALUES (?, ?, ?)')
    for (const uid of ids) ins.run(row.id, uid, now())
    res.json({ album: albumJson(db.prepare('SELECT * FROM albums WHERE id = ?').get(row.id) as IdRow, req.user!.id, { access: true }) })
  }),
)

albumsRouter.post(
  '/:id/share',
  requireUser,
  wrap((req, res) => {
    // Legacy single link: creating now mints a fresh private link; disabling clears the legacy token.
    const id = loadManaged(req, Number(req.params.id)).id
    const enable = bool(req.body?.enabled, true)
    if (!enable) {
      db.prepare('UPDATE albums SET share_token = NULL WHERE id = ?').run(id)
      res.json({ shareToken: null })
      return
    }
    const link = createLink(id, req.user!.id, str(req.body?.label, 80))
    res.json({ shareToken: link.token, link: linkJson(link) })
  }),
)

/* ---------- private links: unlimited, each unique, revocable ---------- */

type LinkRow = IdRow & { album_id: number; token: string; label: string; created_by: number | null; created_at: number; views: number; revoked_at: number | null }

function linkJson(l: LinkRow) {
  return { id: l.id, albumId: l.album_id, token: l.token, label: l.label, url: `/s/${l.token}`, createdBy: l.created_by, createdAt: l.created_at, views: l.views, revokedAt: l.revoked_at ?? null }
}

/** Every call mints a brand-new token, even when the album already has links. */
function createLink(albumId: number, userId: number, label: string): LinkRow {
  let token = ''
  do token = randomBytes(15).toString('base64url')
  while (db.prepare('SELECT 1 FROM album_links WHERE token = ?').get(token) || db.prepare('SELECT 1 FROM albums WHERE share_token = ?').get(token))
  const info = db.prepare('INSERT INTO album_links(album_id, token, label, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(albumId, token, label, userId, now())
  return db.prepare('SELECT * FROM album_links WHERE id = ?').get(info.lastInsertRowid as number) as LinkRow
}

albumsRouter.get(
  '/:id/links',
  requireUser,
  wrap((req, res) => {
    const id = loadManaged(req, Number(req.params.id)).id
    const rows = db.prepare('SELECT * FROM album_links WHERE album_id = ? ORDER BY created_at DESC').all(id) as LinkRow[]
    res.json({ links: rows.map(linkJson) })
  }),
)

albumsRouter.post(
  '/:id/links',
  requireUser,
  wrap((req, res) => {
    const id = loadManaged(req, Number(req.params.id)).id
    if (!req.user!.perms.canShareLinks) throw new HttpError(403, 'Your account is not allowed to create private links. Ask the owner.')
    const maxLinks = req.user!.limits.maxPrivateLinks
    if (maxLinks > 0 && (db.prepare('SELECT COUNT(*) c FROM album_links WHERE album_id = ? AND revoked_at IS NULL').get(id) as { c: number }).c >= maxLinks) throw new HttpError(403, `This album may have ${maxLinks} active private links.`)
    const link = createLink(id, req.user!.id, str(req.body?.label, 80))
    track(req, 'album.link_create', { targetType: 'album', targetId: id, detail: { label: link.label } })
    res.status(201).json({ link: linkJson(link) })
  }),
)

albumsRouter.delete(
  '/:id/links/:linkId',
  requireUser,
  wrap((req, res) => {
    const id = loadManaged(req, Number(req.params.id)).id
    const r = db.prepare('UPDATE album_links SET revoked_at = ? WHERE id = ? AND album_id = ? AND revoked_at IS NULL').run(now(), Number(req.params.linkId), id) as { changes: number }
    if (!r.changes) throw new HttpError(404, 'Link not found')
    track(req, 'album.link_revoke', { targetType: 'album', targetId: id })
    res.json({ ok: true })
  }),
)

/** Resolve a share token to its album: a live private link, or the legacy single token. */
export function albumForToken(token: string): IdRow | undefined {
  const link = db.prepare('SELECT * FROM album_links WHERE token = ? AND revoked_at IS NULL').get(token) as LinkRow | undefined
  if (link) return db.prepare('SELECT * FROM albums WHERE id = ?').get(link.album_id) as IdRow | undefined
  return db.prepare('SELECT * FROM albums WHERE share_token = ?').get(token) as IdRow | undefined
}

albumsRouter.delete(
  '/:id',
  requireUser,
  wrap((req, res) => {
    const id = loadManaged(req, Number(req.params.id)).id
    const media = db.prepare('SELECT * FROM media WHERE album_id = ?').all(id) as IdRow[]
    db.prepare('UPDATE galleries SET public_album_id = NULL WHERE public_album_id = ?').run(id)
    db.prepare('DELETE FROM albums WHERE id = ?').run(id)
    for (const m of media) removeMediaFiles(m)
    track(req, 'album.delete', { targetType: 'album', targetId: Number(req.params.id) })
    res.json({ ok: true })
  }),
)

albumsRouter.post(
  '/:id/favorite',
  requireUser,
  requirePerm('canReact'),
  wrap((req, res) => {
    const row = loadAlbum(req, req.params.id as string)
    const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND album_id = ?').get(req.user!.id, row.id)
    if (existing) db.prepare('DELETE FROM favorites WHERE user_id = ? AND album_id = ?').run(req.user!.id, row.id)
    else db.prepare('INSERT INTO favorites(user_id, album_id, created_at) VALUES (?, ?, ?)').run(req.user!.id, row.id, now())
    track(req, existing ? 'album.unfavorite' : 'album.favorite', { targetType: 'album', targetId: row.id, targetLabel: String(row.title ?? '') })
    res.json({ favorited: !existing })
  }),
)

albumsRouter.get(
  '/:id/comments',
  requireUser,
  wrap((req, res) => {
    const row = loadAlbum(req, req.params.id as string)
    const comments = db
      .prepare('SELECT c.*, u.display_name, u.username, u.avatar_path FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.album_id = ? AND c.media_id IS NULL ORDER BY c.created_at')
      .all(row.id) as IdRow[]
    res.json({ comments: visibleComments(req, comments, row.gallery_id).map(commentJson) })
  }),
)

albumsRouter.post(
  '/:id/comments',
  requireUser,
  requirePerm('canComment'),
  wrap((req, res) => {
    const row = loadAlbum(req, req.params.id as string)
    const body = str(req.body?.body, 2000)
    if (!body) throw new HttpError(400, 'Comment cannot be empty')
    const held = getPolicy().moderateComments && !canManageGallery(req.user, row.gallery_id)
    const info = db.prepare('INSERT INTO comments(user_id, album_id, body, created_at, approved) VALUES (?, ?, ?, ?, ?)').run(req.user!.id, row.id, body, now(), held ? 0 : 1)
    const c = db.prepare('SELECT c.*, u.display_name, u.username, u.avatar_path FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(info.lastInsertRowid as number) as IdRow
    track(req, 'comment.album', { targetType: 'album', targetId: row.id, targetLabel: String(row.title ?? ''), detail: { body: String(c.body ?? '').slice(0, 140), held } })
    const albumOwner = galleryById(row.gallery_id)?.owner_user_id
    if (albumOwner && albumOwner !== req.user!.id)
      notify({ userId: albumOwner, kind: held ? 'comment.pending' : 'comment.album', title: held ? `${req.user!.display_name} left a comment on “${row.title}” that needs your approval` : `${req.user!.display_name} commented on “${row.title}”`, body: String(c.body ?? '').slice(0, 200), actorId: req.user!.id, data: { albumId: row.id, slug: row.slug, commentId: c.id } })
    res.status(201).json({ comment: commentJson(c), held })
  }),
)

/* ---------- shared albums: collaborators may upload ---------- */

albumsRouter.get(
  '/:id/collaborators',
  requireUser,
  wrap((req, res) => {
    const id = loadManaged(req, Number(req.params.id)).id
    const rows = db.prepare('SELECT u.id, u.username, u.display_name FROM album_collaborators c JOIN users u ON u.id = c.user_id WHERE c.album_id = ? ORDER BY u.display_name').all(id) as IdRow[]
    res.json({ collaborators: rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name })) })
  }),
)

albumsRouter.put(
  '/:id/collaborators',
  requireUser,
  wrap((req, res) => {
    const row = loadManaged(req, Number(req.params.id))
    const ids: number[] = Array.isArray(req.body?.userIds) ? (req.body.userIds as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : []
    db.prepare('DELETE FROM album_collaborators WHERE album_id = ?').run(row.id)
    for (const uid of ids) {
      if (uid === req.user!.id) continue
      db.prepare('INSERT OR IGNORE INTO album_collaborators(album_id, user_id, created_at) VALUES (?, ?, ?)').run(row.id, uid, now())
      notify({ userId: uid, kind: 'album.shared', title: `${req.user!.display_name} invited you to add to “${row.title}”`, actorId: req.user!.id, data: { albumId: row.id, slug: row.slug } })
    }
    track(req, 'album.collaborators', { targetType: 'album', targetId: row.id, targetLabel: String(row.title ?? ''), detail: { count: ids.length } })
    res.json({ ok: true, count: ids.length })
  }),
)

/** Download the whole album as a ZIP (store method). */
albumsRouter.get(
  '/:id/download.zip',
  requireUser,
  wrap(async (req, res) => {
    const row = loadAlbum(req, req.params.id as string)
    if (!req.user!.perms.canDownload) throw new HttpError(403, 'Your account is not allowed to download originals. Ask the owner.')
    const media = db.prepare('SELECT id, title, file_path FROM media WHERE album_id = ? ORDER BY sort_order, id').all(row.id) as IdRow[]
    const entries = media
      .map((m) => ({ name: `${String(m.title || 'media').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}${path.extname(String(m.file_path))}`, path: path.join(MEDIA_DIR, String(m.file_path)) }))
      .filter((e) => existsSync(e.path))
    const safeTitle = String(row.title ?? 'album').replace(/[^\w.-]+/g, '_').slice(0, 60)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.zip"`)
    track(req, 'album.download', { targetType: 'album', targetId: row.id, targetLabel: String(row.title ?? ''), detail: { files: entries.length } })
    await writeZip(res, entries)
    res.end()
  }),
)

/* ---------- lock-screen snapshot of a shared private album ---------- */

const SNAP_DIR = 'snapshots'
albumsRouter.post(
  '/:id/snapshot',
  requireUser,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '6mb' }),
  wrap((req, res) => {
    const row = loadManaged(req, Number(req.params.id))
    const body = req.body as Buffer
    if (!Buffer.isBuffer(body) || body.length < 100) throw new HttpError(400, 'Send the snapshot image as the request body')
    const ext = req.headers['content-type'] === 'image/png' ? '.png' : req.headers['content-type'] === 'image/webp' ? '.webp' : '.jpg'
    const rel = path.posix.join(SNAP_DIR, `${row.id}-${now()}${ext}`)
    mkdirSync(path.join(MEDIA_DIR, SNAP_DIR), { recursive: true })
    writeFileSync(path.join(MEDIA_DIR, rel), body)
    const old = row.lock_snapshot as string | null
    db.prepare('UPDATE albums SET lock_snapshot = ? WHERE id = ?').run(rel, row.id)
    if (old && existsSync(path.join(MEDIA_DIR, old))) {
      try {
        unlinkSync(path.join(MEDIA_DIR, old))
      } catch {
        /* ignore */
      }
    }
    res.json({ album: albumJson(db.prepare('SELECT * FROM albums WHERE id = ?').get(row.id) as IdRow, req.user!.id) })
  }),
)
albumsRouter.get(
  '/:id/snapshot',
  requireUser,
  wrap((req, res) => {
    const row = loadManaged(req, Number(req.params.id))
    const rel = row.lock_snapshot as string | null
    if (!rel || !existsSync(path.join(MEDIA_DIR, rel))) throw new HttpError(404, 'No snapshot yet')
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.sendFile(path.join(MEDIA_DIR, rel))
  }),
)

/** Public, login-free access through a share token. */
export const shareRouter = Router()
shareRouter.get(
  '/:token',
  wrap((req, res) => {
    const row = albumForToken(req.params.token as string)
    if (!row) throw new HttpError(404, 'This private link is not valid or was revoked')
    if (row.visibility === 'shared' && !hasPinAccess(req, row.id as number) && !(req.user && canManageGallery(req.user, row.gallery_id as number))) {
      // Locked: only the title, the blurred snapshot and the PIN prompt; media stays hidden.
      res.json({ locked: true, album: { id: row.id, title: row.title, description: row.description, slug: row.slug }, snapshotUrl: row.lock_snapshot ? `/api/share/${req.params.token}/snapshot` : null })
      return
    }
    db.prepare('UPDATE album_links SET views = views + 1 WHERE token = ?').run(req.params.token as string)
    logActivity({ userId: req.user?.id ?? null, kind: 'album.link_view', targetType: 'album', targetId: row.id as number, targetLabel: String(row.title ?? ''), ip: req.ip ?? '', detail: { token: (req.params.token as string).slice(0, 6) + '…' } })
    const media = db.prepare('SELECT * FROM media WHERE album_id = ? ORDER BY sort_order, id').all(row.id) as IdRow[]
    const token = req.params.token as string
    res.json({
      album: albumJson(row),
      media: media.map((m) => {
        const j = mediaJson(m)
        return { ...j, url: `${j.url}?s=${token}`, thumbUrl: j.thumbUrl ? `${j.thumbUrl}?s=${token}` : null }
      }),
    })
  }),
)

/** The blurred backdrop of a locked album (no PIN needed: it is a deliberately low-detail preview). */
shareRouter.get(
  '/:token/snapshot',
  wrap((req, res) => {
    const row = albumForToken(req.params.token as string)
    const rel = row?.lock_snapshot as string | null | undefined
    if (!row || !rel || !existsSync(path.join(MEDIA_DIR, rel))) throw new HttpError(404, 'No preview')
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.sendFile(path.join(MEDIA_DIR, rel))
  }),
)

/** Enter the PIN of a shared private album; success sets an album-scoped cookie for 12 hours. */
shareRouter.post(
  '/:token/unlock',
  wrap((req, res) => {
    const token = req.params.token as string
    const row = albumForToken(token)
    if (!row) throw new HttpError(404, 'This private link is not valid or was revoked')
    if (row.visibility !== 'shared') {
      res.json({ ok: true })
      return
    }
    const key = `${token}|${req.ip ?? ''}`
    if (!pinAttemptAllowed(key)) throw new HttpError(429, 'Too many wrong PINs. Try again in 15 minutes.')
    const pin = str(req.body?.pin, 12)
    if (!row.pin_hash || !row.pin_salt || !PIN_RE.test(pin) || !verifyPassword(pin, row.pin_salt as string, row.pin_hash as string)) {
      pinAttemptFailed(key)
      logActivity({ userId: req.user?.id ?? null, kind: 'album.pin_failed', targetType: 'album', targetId: row.id as number, targetLabel: String(row.title ?? ''), ip: req.ip ?? '' })
      throw new HttpError(401, 'Wrong PIN')
    }
    pinAttemptReset(key)
    issuePin(res, row.id as number)
    logActivity({ userId: req.user?.id ?? null, kind: 'album.pin_unlock', targetType: 'album', targetId: row.id as number, targetLabel: String(row.title ?? ''), ip: req.ip ?? '' })
    res.json({ ok: true })
  }),
)
