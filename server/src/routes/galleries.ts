import { Router } from 'express'
import { db, now } from '../db.js'
import { requireUser } from '../auth.js'
import { HttpError, num, parseJson, slugify, str, wrap, IdRow } from '../util.js'
import { accessibleGalleryIds, canBrowseAlbum, canManageGallery, galleriesOf, galleryById, galleryOf, grantedGalleryIds, uniqueGallerySlugFor, type GalleryRow } from '../access.js'
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { MEDIA_DIR } from '../db.js'
import { track } from '../activity.js'
import { albumJson, galleryJson, mediaJson } from '../serialize.js'

export const galleriesRouter = Router()

/** Galleries the signed-in user can browse. */
galleriesRouter.get(
  '/',
  requireUser,
  wrap((req, res) => {
    const ids = accessibleGalleryIds(req.user!)
    const granted = new Set(grantedGalleryIds(req.user!))
    const rows = ids.length ? (db.prepare(`SELECT * FROM galleries WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY updated_at DESC`).all(...ids) as unknown as GalleryRow[]) : []
    res.json({ galleries: rows.map((g) => ({ ...galleryJson(g, req.user!.id), granted: granted.has(g.id) })) })
  }),
)

function loadGallery(key: string): GalleryRow {
  const byId = /^\d+$/.test(key)
  const g = db.prepare(`SELECT * FROM galleries WHERE ${byId ? 'id' : 'slug'} = ?`).get(byId ? Number(key) : key) as GalleryRow | undefined
  if (!g) throw new HttpError(404, 'Gallery not found')
  return g
}

galleriesRouter.get(
  '/:key',
  requireUser,
  wrap((req, res) => {
    const g = loadGallery(req.params.key as string)
    if (!accessibleGalleryIds(req.user!).includes(g.id)) throw new HttpError(404, 'Gallery not found')
    const manage = canManageGallery(req.user, g.id)
    const rows = db.prepare('SELECT * FROM albums WHERE gallery_id = ? ORDER BY sort_order, created_at').all(g.id) as IdRow[]
    const albums = rows
      .filter((r) => canBrowseAlbum(req.user, { id: r.id, gallery_id: g.id, visibility: r.visibility as string, restricted: r.restricted as number }))
      .map((r) => albumJson(r, req.user!.id))
    const themeRow = g.theme_id ? (db.prepare('SELECT * FROM themes WHERE id = ?').get(g.theme_id) as IdRow | undefined) : undefined
    res.json({ gallery: galleryJson(g, req.user!.id), albums, canManage: manage, theme: themeRow ? themeJson(themeRow) : null })
  }),
)

function themeJson(r: IdRow) {
  return { id: r.id, name: r.name, light: JSON.parse(r.light as string), dark: JSON.parse(r.dark as string), fontDisplay: r.font_display, fontBody: r.font_body, radius: r.radius, scale: r.scale, builtIn: !!r.built_in, createdAt: r.created_at }
}

galleriesRouter.put(
  '/:id',
  requireUser,
  wrap((req, res) => {
    const g = loadGallery(req.params.id as string)
    if (!canManageGallery(req.user, g.id)) throw new HttpError(403, 'You can only edit your own gallery')
    const b = req.body ?? {}
    const title = b.title != null ? str(b.title, 80) || g.title : g.title
    let slug = g.slug
    if (b.slug != null) {
      const want = slugify(str(b.slug, 60) || title)
      if (db.prepare('SELECT 1 FROM galleries WHERE slug = ? AND id <> ?').get(want, g.id)) throw new HttpError(409, 'That gallery URL is already used')
      slug = want
    }
    const tagline = b.tagline != null ? str(b.tagline, 160) : g.tagline
    const headline = b.headline != null ? str(b.headline, 120) : g.headline
    let splash = g.splash_media_id
    if ('splashMediaId' in b) {
      splash = b.splashMediaId == null ? null : num(b.splashMediaId)
      if (splash != null && !db.prepare('SELECT 1 FROM media m JOIN albums a ON a.id = m.album_id WHERE m.id = ? AND a.gallery_id = ?').get(splash, g.id)) throw new HttpError(400, 'Splash image must belong to this gallery')
    }
    let theme = g.theme_id
    if ('themeId' in b) theme = b.themeId == null ? null : num(b.themeId)
    if (b.clearCover === true && g.cover_path) {
      try {
        unlinkSync(path.join(MEDIA_DIR, g.cover_path))
      } catch {
        /* ignore */
      }
      db.prepare('UPDATE galleries SET cover_path = NULL WHERE id = ?').run(g.id)
    }
    let pub = g.public_album_id
    if ('publicAlbumId' in b) {
      pub = b.publicAlbumId == null ? null : num(b.publicAlbumId)
      if (pub != null && !req.user!.perms.canPublish) throw new HttpError(403, 'Your account is not allowed to make albums public. Ask the owner.')
      if (pub != null && !db.prepare('SELECT 1 FROM albums WHERE id = ? AND gallery_id = ?').get(pub, g.id)) throw new HttpError(400, 'Public album must belong to this gallery')
      // Selecting an album as the public hook makes it public.
      if (pub != null) db.prepare("UPDATE albums SET visibility = 'public', updated_at = ? WHERE id = ?").run(now(), pub)
    }
    db.prepare('UPDATE galleries SET title = ?, slug = ?, tagline = ?, headline = ?, splash_media_id = ?, theme_id = ?, public_album_id = ?, updated_at = ? WHERE id = ?').run(title, slug, tagline, headline, splash, theme, pub, now(), g.id)
    res.json({ gallery: galleryJson(galleryById(g.id)!, req.user!.id) })
  }),
)


/* ---------- many galleries per account ---------- */

const MAX_COVER = 8 * 1024 * 1024

/** Create an extra gallery, within the account's gallery limit. */
galleriesRouter.post(
  '/',
  requireUser,
  wrap((req, res) => {
    const u = req.user!
    const title = str(req.body?.title, 80).trim()
    if (!title) throw new HttpError(400, 'Give the gallery a name')
    const owned = galleriesOf(u.id)
    if (!u.perms.canCreateGalleries && owned.length >= 1) throw new HttpError(403, 'Your account is not allowed to create extra galleries. Ask the owner.')
    const max = u.limits.maxGalleries
    if (max > 0 && owned.length >= max) throw new HttpError(403, `Your account may have ${max} galler${max === 1 ? 'y' : 'ies'}. Ask the owner for more.`)
    const t = now()
    const info = db.prepare('INSERT INTO galleries(owner_user_id, slug, title, tagline, is_primary, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(u.id, uniqueGallerySlugFor(title), title, str(req.body?.tagline, 160), owned.length === 0 ? 1 : 0, owned.length, t, t)
    const gid = info.lastInsertRowid as number
    db.prepare('INSERT OR IGNORE INTO gallery_access(user_id, gallery_id, created_at) VALUES (?, ?, ?)').run(u.id, gid, t)
    track(req, 'gallery.create', { targetType: 'gallery', targetId: gid, targetLabel: title })
    res.status(201).json({ gallery: galleryJson(galleryById(gid)!, u.id) })
  }),
)

/** Upload a custom gallery image (JPEG/PNG/WebP/GIF, up to 8 MB). */
galleriesRouter.post(
  '/:id/cover',
  requireUser,
  wrap(async (req, res) => {
    const g = galleryById(Number(req.params.id))
    if (!g || !canManageGallery(req.user, g.id)) throw new HttpError(404, 'Gallery not found')
    const mime = str(req.headers['content-type'], 100)
    const ext: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }
    if (!ext[mime]) throw new HttpError(415, 'Use a JPEG, PNG, WebP or GIF image')
    if (Number(req.headers['content-length'] ?? 0) > MAX_COVER) throw new HttpError(413, 'Image must be under 8 MB')
    const rel = path.posix.join('covers', `${g.id}-${now()}${ext[mime]}`)
    const abs = path.join(MEDIA_DIR, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    let received = 0
    req.on('data', (c: Buffer) => {
      received += c.length
      if (received > MAX_COVER) req.destroy(new HttpError(413, 'Image must be under 8 MB'))
    })
    await pipeline(req, createWriteStream(abs))
    if (g.cover_path && existsSync(path.join(MEDIA_DIR, g.cover_path))) {
      try {
        unlinkSync(path.join(MEDIA_DIR, g.cover_path))
      } catch {
        /* ignore */
      }
    }
    db.prepare('UPDATE galleries SET cover_path = ?, updated_at = ? WHERE id = ?').run(rel, now(), g.id)
    track(req, 'gallery.cover', { targetType: 'gallery', targetId: g.id, targetLabel: g.title })
    res.json({ gallery: galleryJson(galleryById(g.id)!, req.user!.id) })
  }),
)

galleriesRouter.get(
  '/:id/cover',
  wrap((req, res) => {
    const g = galleryById(Number(req.params.id))
    if (!g?.cover_path) throw new HttpError(404, 'No image')
    const abs = path.join(MEDIA_DIR, g.cover_path)
    if (!existsSync(abs)) throw new HttpError(404, 'No image')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.sendFile(abs)
  }),
)

/** Delete a non-primary gallery; its albums move to the owner's primary gallery. */
galleriesRouter.delete(
  '/:id',
  requireUser,
  wrap((req, res) => {
    const g = galleryById(Number(req.params.id))
    if (!g || !canManageGallery(req.user, g.id)) throw new HttpError(404, 'Gallery not found')
    if (g.is_primary) throw new HttpError(400, 'The primary gallery cannot be deleted')
    const primary = galleryOf(g.owner_user_id)
    if (primary && primary.id !== g.id) {
      db.prepare('UPDATE albums SET gallery_id = ? WHERE gallery_id = ?').run(primary.id, g.id)
    }
    db.prepare('DELETE FROM galleries WHERE id = ?').run(g.id)
    track(req, 'gallery.delete', { targetType: 'gallery', targetId: g.id, targetLabel: g.title })
    res.json({ ok: true, movedTo: primary?.id ?? null })
  }),
)

/** Make one of your galleries the primary (the one your profile page shows first). */
galleriesRouter.post(
  '/:id/primary',
  requireUser,
  wrap((req, res) => {
    const g = galleryById(Number(req.params.id))
    if (!g || !canManageGallery(req.user, g.id)) throw new HttpError(404, 'Gallery not found')
    db.prepare('UPDATE galleries SET is_primary = 0 WHERE owner_user_id = ?').run(g.owner_user_id)
    db.prepare('UPDATE galleries SET is_primary = 1 WHERE id = ?').run(g.id)
    res.json({ gallery: galleryJson(galleryById(g.id)!, req.user!.id) })
  }),
)

/** Login-free pages: gallery directory, gallery landing (splash + public albums) and public album detail. */
export const publicRouter = Router()

function publicSuffix(slug: string): string {
  return `?g=${encodeURIComponent(slug)}`
}

function publicGalleryJson(g: GalleryRow) {
  const j = galleryJson(g)
  const suffix = publicSuffix(g.slug)
  const fix = (m: ReturnType<typeof mediaJson> | null) => (m ? { ...m, url: m.url + suffix, thumbUrl: m.thumbUrl ? m.thumbUrl + suffix : null } : null)
  return {
    ...j,
    splash: fix(j.splash),
    previews: j.previews.filter((p) => p && p.visibility === 'public').map((p) => ({ ...p!, cover: fix(p!.cover) })),
  }
}

function publicAlbumJson(row: IdRow, slug: string) {
  const a = albumJson(row)
  const suffix = publicSuffix(slug)
  return { ...a, cover: a.cover ? { ...a.cover, url: a.cover.url + suffix, thumbUrl: a.cover.thumbUrl ? a.cover.thumbUrl + suffix : null } : null }
}

/** The social feed: every public album across all galleries, the people behind them, tags and totals. */
publicRouter.get(
  '/feed',
  wrap((req, res) => {
    const sort = str(req.query.sort, 20) || 'newest'
    const q = str(req.query.q, 80).toLowerCase()
    const tag = str(req.query.tag, 40).toLowerCase()
    const galleries = db.prepare("SELECT DISTINCT g.* FROM galleries g JOIN albums a ON a.gallery_id = g.id WHERE a.visibility = 'public' ORDER BY g.updated_at DESC").all() as unknown as GalleryRow[]
    const bySlug = new Map(galleries.map((g) => [g.id, g.slug]))
    let rows = db.prepare("SELECT a.* FROM albums a WHERE a.visibility = 'public'").all() as IdRow[]
    if (q) rows = rows.filter((r) => `${r.title} ${r.description} ${r.tags}`.toLowerCase().includes(q))
    if (tag) rows = rows.filter((r) => parseJson<string[]>(r.tags, []).some((x) => x.toLowerCase() === tag))
    let albums = rows.map((r) => publicAlbumJson(r, bySlug.get(r.gallery_id as number) ?? ''))
    if (q) albums = albums.filter((a) => a.gallery?.owner?.displayName.toLowerCase().includes(q) || `${a.title} ${a.description} ${a.tags.join(' ')}`.toLowerCase().includes(q))
    albums.sort((a, b) => {
      if (sort === 'popular') return (b.views as number) - (a.views as number) || (b.updatedAt as number) - (a.updatedAt as number)
      if (sort === 'liked') return b.counts.likes + b.counts.comments - (a.counts.likes + a.counts.comments) || (b.updatedAt as number) - (a.updatedAt as number)
      return (b.updatedAt as number) - (a.updatedAt as number)
    })
    const tags = new Map<string, number>()
    for (const a of albums) for (const t of a.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
    const photos = albums.reduce((n, a) => n + a.counts.media, 0)
    const likes = albums.reduce((n, a) => n + a.counts.likes, 0)
    res.json({ albums, people: galleries.map(publicGalleryJson), tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([name, count]) => ({ name, count })), stats: { people: galleries.length, albums: albums.length, photos, likes } })
  }),
)

publicRouter.get(
  '/galleries',
  wrap((_req, res) => {
    const rows = db.prepare("SELECT DISTINCT g.* FROM galleries g JOIN albums a ON a.gallery_id = g.id WHERE a.visibility = 'public' ORDER BY g.updated_at DESC").all() as unknown as GalleryRow[]
    res.json({ galleries: rows.map(publicGalleryJson) })
  }),
)

publicRouter.get(
  '/galleries/:slug',
  wrap((req, res) => {
    const g = db.prepare('SELECT * FROM galleries WHERE slug = ?').get(req.params.slug as string) as GalleryRow | undefined
    if (!g) throw new HttpError(404, 'Gallery not found')
    const rows = db.prepare("SELECT * FROM albums WHERE gallery_id = ? AND visibility = 'public' ORDER BY (id = ?) DESC, featured DESC, sort_order, created_at").all(g.id, g.public_album_id ?? -1) as IdRow[]
    const albums = rows.map((r) => publicAlbumJson(r, g.slug))
    // Only an explicitly chosen public album leads the page; by default a gallery has none.
    const hook = albums.find((a) => a.id === g.public_album_id) ?? null
    const media = hook ? (db.prepare('SELECT * FROM media WHERE album_id = ? ORDER BY sort_order, id').all(hook.id) as IdRow[]).map((m) => mediaJson(m, undefined, publicSuffix(g.slug))) : []
    const themeRow = g.theme_id ? (db.prepare('SELECT * FROM themes WHERE id = ?').get(g.theme_id) as IdRow | undefined) : undefined
    res.json({ gallery: publicGalleryJson(g), album: hook, albums, media, theme: themeRow ? themeJson(themeRow) : null })
  }),
)

publicRouter.get(
  '/galleries/:slug/albums/:album',
  wrap((req, res) => {
    const g = db.prepare('SELECT * FROM galleries WHERE slug = ?').get(req.params.slug as string) as GalleryRow | undefined
    if (!g) throw new HttpError(404, 'Gallery not found')
    const row = db.prepare("SELECT * FROM albums WHERE gallery_id = ? AND slug = ? AND visibility = 'public'").get(g.id, req.params.album as string) as IdRow | undefined
    if (!row) throw new HttpError(404, 'Album not found')
    db.prepare('UPDATE albums SET views = views + 1 WHERE id = ?').run(row.id)
    const media = (db.prepare('SELECT * FROM media WHERE album_id = ? ORDER BY sort_order, id').all(row.id) as IdRow[]).map((m) => mediaJson(m, undefined, publicSuffix(g.slug)))
    const themeRow = g.theme_id ? (db.prepare('SELECT * FROM themes WHERE id = ?').get(g.theme_id) as IdRow | undefined) : undefined
    res.json({ gallery: publicGalleryJson(g), album: publicAlbumJson(row, g.slug), media, theme: themeRow ? themeJson(themeRow) : null })
  }),
)
