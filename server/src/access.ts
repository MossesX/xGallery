import { db, now } from './db.js'
import { slugify } from './util.js'
import type { User } from './auth.js'

export interface GalleryRow {
  id: number
  owner_user_id: number
  slug: string
  title: string
  tagline: string
  headline: string
  splash_media_id: number | null
  cover_path: string | null
  theme_id: number | null
  public_album_id: number | null
  is_primary: number
  sort_order: number
  created_at: number
  updated_at: number
}

export function isOwner(u?: User | null): boolean {
  return u?.role === 'owner'
}

export function isAdmin(u?: User | null): boolean {
  return u?.role === 'owner' || u?.role === 'admin'
}

export function galleryById(id: number): GalleryRow | undefined {
  return db.prepare('SELECT * FROM galleries WHERE id = ?').get(id) as GalleryRow | undefined
}

/** The account's primary gallery (every account has one). */
export function galleryOf(userId: number): GalleryRow | undefined {
  return db.prepare('SELECT * FROM galleries WHERE owner_user_id = ? ORDER BY is_primary DESC, sort_order, id LIMIT 1').get(userId) as GalleryRow | undefined
}

/** Every gallery the account owns, primary first. */
export function galleriesOf(userId: number): GalleryRow[] {
  return db.prepare('SELECT * FROM galleries WHERE owner_user_id = ? ORDER BY is_primary DESC, sort_order, id').all(userId) as unknown as GalleryRow[]
}

export function uniqueGallerySlugFor(base: string): string {
  return uniqueGallerySlug(base)
}

function uniqueGallerySlug(base: string): string {
  const root = slugify(base)
  let slug = root
  let n = 2
  while (db.prepare('SELECT 1 FROM galleries WHERE slug = ?').get(slug)) slug = `${root}-${n++}`
  return slug
}

/** Every account gets exactly one gallery. Creates it when missing. */
export function ensureGalleryFor(userId: number, displayName: string): GalleryRow {
  const existing = galleryOf(userId)
  if (existing) return existing
  const t = now()
  const title = displayName
  db.prepare('INSERT INTO galleries(owner_user_id, slug, title, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(userId, uniqueGallerySlug(displayName), title, t, t)
  grantGallery(userId, galleryOf(userId)!.id)
  return galleryOf(userId)!
}

export function grantGallery(userId: number, galleryId: number): void {
  db.prepare('INSERT OR IGNORE INTO gallery_access(user_id, gallery_id, created_at) VALUES (?, ?, ?)').run(userId, galleryId, now())
}

/** Can this user manage (edit) the gallery? Owners manage all; admins manage their own. */
export function canManageGallery(u: User | undefined, galleryId: number): boolean {
  if (!u) return false
  if (isOwner(u)) return true
  const g = galleryById(galleryId)
  return !!g && g.owner_user_id === u.id
}

/** Accepted buddies, in either direction. */
export function areBuddies(a: number, b: number): boolean {
  return !!db.prepare("SELECT 1 FROM buddies WHERE status = 'accepted' AND ((user_id = ? AND buddy_id = ?) OR (user_id = ? AND buddy_id = ?))").get(a, b, b, a)
}

/** Can this user browse the gallery at all? Granted members and the owner's buddies can. */
export function canViewGallery(u: User | undefined, galleryId: number): boolean {
  if (!u) return false
  if (isOwner(u)) return true
  if (canManageGallery(u, galleryId)) return true
  if (db.prepare('SELECT 1 FROM gallery_access WHERE user_id = ? AND gallery_id = ?').get(u.id, galleryId)) return true
  const g = galleryById(galleryId)
  return !!g && areBuddies(u.id, g.owner_user_id)
}

export interface AlbumAccessRow {
  id: number
  gallery_id: number
  visibility: string
  restricted: number
}

/** Can this user see the album (published state + gallery access + per-user restriction)? */
export function canViewAlbum(u: User | undefined, album: AlbumAccessRow): boolean {
  if (album.visibility === 'public') return true
  if (!u) return false
  if (canManageGallery(u, album.gallery_id)) return true
  if (album.visibility !== 'published') return false
  if (!canViewGallery(u, album.gallery_id)) return false
  if (!album.restricted) return true
  return !!db.prepare('SELECT 1 FROM album_access WHERE album_id = ? AND user_id = ?').get(album.id, u.id)
}

/** Gallery ids the user may browse (granted, owned, or carrying public albums). */
export function accessibleGalleryIds(u: User): number[] {
  if (isOwner(u)) return (db.prepare('SELECT id FROM galleries').all() as { id: number }[]).map((r) => r.id)
  const rows = db
    .prepare(
      "SELECT gallery_id AS id FROM gallery_access WHERE user_id = ? UNION SELECT id FROM galleries WHERE owner_user_id = ? UNION SELECT DISTINCT gallery_id AS id FROM albums WHERE visibility = 'public' UNION SELECT g.id FROM galleries g WHERE g.owner_user_id IN (SELECT buddy_id FROM buddies WHERE user_id = ? AND status = 'accepted' UNION SELECT user_id FROM buddies WHERE buddy_id = ? AND status = 'accepted')",
    )
    .all(u.id, u.id, u.id, u.id) as { id: number }[]
  return rows.map((r) => r.id)
}

/** Gallery ids the user was explicitly granted or owns (no public spill-over). */
export function grantedGalleryIds(u: User): number[] {
  if (isOwner(u)) return (db.prepare('SELECT id FROM galleries').all() as { id: number }[]).map((r) => r.id)
  const rows = db
    .prepare(
      "SELECT gallery_id AS id FROM gallery_access WHERE user_id = ? UNION SELECT id FROM galleries WHERE owner_user_id = ? UNION SELECT g.id FROM galleries g WHERE g.owner_user_id IN (SELECT buddy_id FROM buddies WHERE user_id = ? AND status = 'accepted' UNION SELECT user_id FROM buddies WHERE buddy_id = ? AND status = 'accepted')",
    )
    .all(u.id, u.id, u.id, u.id) as { id: number }[]
  return rows.map((r) => r.id)
}

/** Gallery ids the user may manage: everything for the owner, all owned galleries otherwise. */
export function managedGalleryIds(u: User): number[] {
  if (isOwner(u)) return (db.prepare('SELECT id FROM galleries').all() as { id: number }[]).map((r) => r.id)
  return galleriesOf(u.id).map((g) => g.id)
}

/**
 * Album rows the user may browse. Browsing is identical for every role: drafts never appear and
 * per-user restrictions apply to admins too. Pass `manage = true` for control-panel listings,
 * which include drafts of the galleries the user manages.
 */
export function visibleAlbumRows(u: User, manage = false): Record<string, unknown>[] {
  const ids = accessibleGalleryIds(u)
  const managed = new Set(managedGalleryIds(u))
  const rows = db
    .prepare(`SELECT * FROM albums WHERE visibility = 'public' OR gallery_id IN (${ids.map(() => '?').join(',') || 'NULL'}) ORDER BY sort_order, created_at`)
    .all(...ids) as Record<string, unknown>[]
  return rows.filter((r) => {
    if (manage && managed.has(r.gallery_id as number)) return true
    return canBrowseAlbum(u, { id: r.id as number, gallery_id: r.gallery_id as number, visibility: r.visibility as string, restricted: r.restricted as number })
  })
}

/** Browsing visibility: the same rule for every role (no manager bypass). */
export function canBrowseAlbum(u: User | undefined, album: AlbumAccessRow): boolean {
  if (album.visibility === 'public') return true
  if (!u) return false
  if (album.visibility !== 'published') return false
  if (!canViewGallery(u, album.gallery_id)) return false
  if (!album.restricted) return true
  if (canManageGallery(u, album.gallery_id)) return true
  return !!db.prepare('SELECT 1 FROM album_access WHERE album_id = ? AND user_id = ?').get(album.id, u.id)
}
