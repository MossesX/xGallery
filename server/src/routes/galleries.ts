import { Router } from 'express'
import { db, now } from '../db.js'
import { requireUser } from '../auth.js'
import { HttpError, num, parseJson, slugify, str, wrap, IdRow } from '../util.js'
import { accessibleGalleryIds, canBrowseAlbum, canManageGallery, galleryById, grantedGalleryIds, type GalleryRow } from '../access.js'
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
