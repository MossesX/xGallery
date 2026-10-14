import { Router } from 'express'
import { db, now } from '../db.js'
import { requireUser } from '../auth.js'
import { HttpError, num, slugify, str, wrap, IdRow } from '../util.js'
import { accessibleGalleryIds, canManageGallery, canViewAlbum, galleryById, grantedGalleryIds, type GalleryRow } from '../access.js'
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
      .filter((r) => manage || canViewAlbum(req.user, { id: r.id, gallery_id: g.id, visibility: r.visibility as string, restricted: r.restricted as number }))
      .map((r) => albumJson(r, req.user!.id, { access: manage }))
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
    let pub = g.public_album_id
    if ('publicAlbumId' in b) {
      pub = b.publicAlbumId == null ? null : num(b.publicAlbumId)
      if (pub != null && !db.prepare('SELECT 1 FROM albums WHERE id = ? AND gallery_id = ?').get(pub, g.id)) throw new HttpError(400, 'Public album must belong to this gallery')
      // Selecting an album as the public hook makes it public.
      if (pub != null) db.prepare("UPDATE albums SET visibility = 'public', updated_at = ? WHERE id = ?").run(now(), pub)
    }
    db.prepare('UPDATE galleries SET title = ?, slug = ?, tagline = ?, headline = ?, splash_media_id = ?, theme_id = ?, public_album_id = ?, updated_at = ? WHERE id = ?').run(title, slug, tagline, headline, splash, theme, pub, now(), g.id)
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
    const hook = albums.find((a) => a.id === g.public_album_id) ?? albums[0] ?? null
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
