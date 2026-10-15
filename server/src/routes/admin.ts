import { Router } from 'express'
import { db } from '../db.js'
import { requireOwner } from '../auth.js'
import { num, str, wrap, IdRow } from '../util.js'
import { mediaJson } from '../serialize.js'
import { avatarUrlFor } from '../auth.js'

/** Owner only: the whole site as a tree (people → galleries → albums → files) and the new-album feed. */
export const adminRouter = Router()
adminRouter.use(requireOwner)

interface FileNode {
  id: number
  title: string
  kind: string
  size: number
  thumbUrl: string | null
  url: string
  createdAt: number
}
interface AlbumNode {
  id: number
  slug: string
  title: string
  visibility: string
  photos: number
  videos: number
  bytes: number
  updatedAt: number
  files?: FileNode[]
}
interface GalleryNode {
  id: number
  slug: string
  title: string
  isPrimary: boolean
  coverUrl: string | null
  albums: AlbumNode[]
}
interface UserNode {
  id: number
  username: string
  displayName: string
  role: string
  email: string
  phone: string
  avatarUrl: string | null
  galleries: GalleryNode[]
}

/**
 * The tree. `files=1` includes every file (heavier); otherwise album nodes carry counts and the
 * client fetches files per album. `q` filters down to matching users, galleries, albums or files.
 */
adminRouter.get(
  '/tree',
  wrap((req, res) => {
    const withFiles = req.query.files === '1'
    const q = str(req.query.q, 80).toLowerCase()
    const users = db.prepare('SELECT id, username, display_name, role, email, phone, avatar_path FROM users WHERE disabled = 0 ORDER BY display_name').all() as IdRow[]
    const galleries = db.prepare('SELECT id, owner_user_id, slug, title, is_primary, cover_path FROM galleries ORDER BY owner_user_id, is_primary DESC, sort_order, id').all() as IdRow[]
    const albums = db
      .prepare(
        `SELECT a.id, a.gallery_id, a.slug, a.title, a.visibility, a.updated_at,
          (SELECT COUNT(*) FROM media m WHERE m.album_id = a.id AND m.kind = 'image') AS photos,
          (SELECT COUNT(*) FROM media m WHERE m.album_id = a.id AND m.kind = 'video') AS videos,
          (SELECT COALESCE(SUM(size), 0) FROM media m WHERE m.album_id = a.id) AS bytes
         FROM albums a ORDER BY a.gallery_id, a.sort_order, a.created_at`,
      )
      .all() as IdRow[]
    const files = withFiles ? (db.prepare('SELECT id, album_id, title, kind, size, thumb_path, created_at FROM media ORDER BY album_id, sort_order, id').all() as IdRow[]) : []
    const filesByAlbum = new Map<number, FileNode[]>()
    for (const f of files) {
      const list = filesByAlbum.get(f.album_id as number) ?? []
      list.push({ id: f.id, title: String(f.title), kind: String(f.kind), size: Number(f.size), thumbUrl: f.thumb_path || f.kind === 'image' ? `/api/media/${f.id}/thumb` : null, url: `/api/media/${f.id}/file`, createdAt: Number(f.created_at) })
      filesByAlbum.set(f.album_id as number, list)
    }
    const albumsByGallery = new Map<number, AlbumNode[]>()
    for (const a of albums) {
      const node: AlbumNode = { id: a.id, slug: String(a.slug), title: String(a.title), visibility: String(a.visibility), photos: Number(a.photos), videos: Number(a.videos), bytes: Number(a.bytes), updatedAt: Number(a.updated_at) }
      if (withFiles) node.files = filesByAlbum.get(a.id) ?? []
      const list = albumsByGallery.get(a.gallery_id as number) ?? []
      list.push(node)
      albumsByGallery.set(a.gallery_id as number, list)
    }
    const galleriesByUser = new Map<number, GalleryNode[]>()
    for (const g of galleries) {
      const node: GalleryNode = { id: g.id, slug: String(g.slug), title: String(g.title), isPrimary: !!g.is_primary, coverUrl: g.cover_path ? `/api/galleries/${g.id}/cover` : null, albums: albumsByGallery.get(g.id) ?? [] }
      const list = galleriesByUser.get(g.owner_user_id as number) ?? []
      list.push(node)
      galleriesByUser.set(g.owner_user_id as number, list)
    }
    let tree: UserNode[] = users.map((u) => ({ id: u.id, username: String(u.username), displayName: String(u.display_name), role: String(u.role), email: String(u.email ?? ''), phone: String(u.phone ?? ''), avatarUrl: avatarUrlFor(u.id, u.avatar_path), galleries: galleriesByUser.get(u.id) ?? [] }))
    if (q) {
      // Keep any node whose own text matches, plus the ancestors of every match.
      const match = (t: string) => t.toLowerCase().includes(q)
      tree = tree
        .map((u) => {
          const uHit = match(u.displayName) || match(u.username) || match(u.email) || match(u.phone)
          const gs = u.galleries
            .map((g) => {
              const gHit = match(g.title)
              const as = g.albums
                .map((a) => {
                  const aHit = match(a.title) || match(a.slug)
                  const fs = a.files?.filter((f) => match(f.title))
                  if (aHit || gHit || uHit) return { ...a, files: aHit || !a.files ? a.files : fs }
                  return fs && fs.length ? { ...a, files: fs } : null
                })
                .filter(Boolean) as AlbumNode[]
              if (gHit || uHit || as.length) return { ...g, albums: as }
              return null
            })
            .filter(Boolean) as GalleryNode[]
          if (uHit || gs.length) return { ...u, galleries: gs }
          return null
        })
        .filter(Boolean) as UserNode[]
    }
    res.json({ tree, totals: { users: users.length, galleries: galleries.length, albums: albums.length } })
  }),
)

/** Files of one album for the tree (any album: the owner sees everything). */
adminRouter.get(
  '/albums/:id/files',
  wrap((req, res) => {
    const rows = db.prepare('SELECT * FROM media WHERE album_id = ? ORDER BY sort_order, id').all(Number(req.params.id)) as IdRow[]
    res.json({ files: rows.map((m) => mediaJson(m, req.user!.id)) })
  }),
)

/** The new-album log: who, how to reach them, what, and how much. */
adminRouter.get(
  '/new-albums',
  wrap((req, res) => {
    const limit = Math.min(500, req.query.limit ? num(req.query.limit) : 100)
    const since = req.query.since ? num(req.query.since) : 0
    const rows = db
      .prepare(
        `SELECT a.id, a.slug, a.title, a.visibility, a.created_at, a.updated_at, g.id AS gallery_id, g.title AS gallery_title,
          u.id AS user_id, u.username, u.display_name, u.email, u.phone, u.avatar_path,
          (SELECT COUNT(*) FROM media m WHERE m.album_id = a.id AND m.kind = 'image') AS photos,
          (SELECT COUNT(*) FROM media m WHERE m.album_id = a.id AND m.kind = 'video') AS videos,
          (SELECT COALESCE(SUM(size), 0) FROM media m WHERE m.album_id = a.id) AS bytes,
          (SELECT id FROM media m WHERE m.album_id = a.id ORDER BY sort_order, id LIMIT 1) AS cover_id,
          (SELECT read_at FROM notifications n WHERE n.user_id IS NULL AND n.kind = 'album.new' AND json_extract(n.data, '$.albumId') = a.id ORDER BY n.id DESC LIMIT 1) AS seen_at
         FROM albums a JOIN galleries g ON g.id = a.gallery_id JOIN users u ON u.id = g.owner_user_id
         WHERE a.created_at >= ? ORDER BY a.created_at DESC LIMIT ?`,
      )
      .all(since, limit) as IdRow[]
    res.json({
      albums: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        visibility: r.visibility,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        gallery: { id: r.gallery_id, title: r.gallery_title },
        user: { id: r.user_id, username: r.username, displayName: r.display_name, email: r.email ?? '', phone: r.phone ?? '', avatarUrl: avatarUrlFor(r.user_id as number, r.avatar_path) },
        photos: r.photos,
        videos: r.videos,
        bytes: r.bytes,
        coverUrl: r.cover_id ? `/api/media/${r.cover_id}/thumb` : null,
        seen: r.seen_at != null,
      })),
    })
  }),
)
