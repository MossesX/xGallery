import { Router } from 'express'
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { db, MEDIA_DIR, now } from '../db.js'
import { avatarUrlFor, publicUser, requirePerm, requireUser } from '../auth.js'
import { HttpError, str, wrap, IdRow } from '../util.js'
import { areBuddies, galleryOf } from '../access.js'

/** Social layer: profile pictures, the people directory, buddy lists and private messages. */
export const socialRouter = Router()

const MAX_AVATAR = 6 * 1024 * 1024

function personJson(row: IdRow, me: number) {
  const g = galleryOf(row.id)
  const publicAlbums = g ? (db.prepare("SELECT COUNT(*) c FROM albums WHERE gallery_id = ? AND visibility = 'public'").get(g.id) as { c: number }).c : 0
  const out = db.prepare('SELECT status FROM buddies WHERE user_id = ? AND buddy_id = ?').get(me, row.id) as { status: string } | undefined
  const inc = db.prepare('SELECT status FROM buddies WHERE user_id = ? AND buddy_id = ?').get(row.id, me) as { status: string } | undefined
  const buddy: 'none' | 'accepted' | 'outgoing' | 'incoming' = out?.status === 'accepted' || inc?.status === 'accepted' ? 'accepted' : out ? 'outgoing' : inc ? 'incoming' : 'none'
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio ?? '',
    avatarUrl: avatarUrlFor(row.id, row.avatar_path),
    role: row.role,
    gallerySlug: g?.slug ?? null,
    publicAlbums,
    buddy,
    lastSeenAt: row.last_seen_at ?? null,
  }
}

/* ---------- avatars ---------- */

socialRouter.get(
  '/avatar/:id',
  wrap((req, res) => {
    const row = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(Number(req.params.id)) as { avatar_path: string | null } | undefined
    if (!row?.avatar_path) throw new HttpError(404, 'No picture')
    const abs = path.join(MEDIA_DIR, row.avatar_path)
    if (!existsSync(abs)) throw new HttpError(404, 'No picture')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.sendFile(abs)
  }),
)

socialRouter.post(
  '/avatar',
  requireUser,
  wrap(async (req, res) => {
    const mime = str(req.headers['content-type'], 100)
    const ext: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }
    if (!ext[mime]) throw new HttpError(415, 'Use a JPEG, PNG, WebP or GIF picture')
    if (Number(req.headers['content-length'] ?? 0) > MAX_AVATAR) throw new HttpError(413, 'Picture must be under 6 MB')
    const rel = path.posix.join('avatars', `${req.user!.id}-${now()}${ext[mime]}`)
    const abs = path.join(MEDIA_DIR, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    let received = 0
    req.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > MAX_AVATAR) req.destroy(new HttpError(413, 'Picture must be under 6 MB'))
    })
    await pipeline(req, createWriteStream(abs))
    const old = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.user!.id) as { avatar_path: string | null }
    db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(rel, req.user!.id)
    if (old.avatar_path && existsSync(path.join(MEDIA_DIR, old.avatar_path))) {
      try {
        unlinkSync(path.join(MEDIA_DIR, old.avatar_path))
      } catch {
        /* ignore */
      }
    }
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as IdRow) })
  }),
)

socialRouter.delete(
  '/avatar',
  requireUser,
  wrap((req, res) => {
    const old = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.user!.id) as { avatar_path: string | null }
    db.prepare('UPDATE users SET avatar_path = NULL WHERE id = ?').run(req.user!.id)
    if (old.avatar_path && existsSync(path.join(MEDIA_DIR, old.avatar_path))) {
      try {
        unlinkSync(path.join(MEDIA_DIR, old.avatar_path))
      } catch {
        /* ignore */
      }
    }
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as IdRow) })
  }),
)

/* ---------- people directory ---------- */

socialRouter.get(
  '/people',
  requireUser,
  wrap((req, res) => {
    const q = str(req.query.q, 80).toLowerCase()
    let rows = db.prepare("SELECT * FROM users WHERE disabled = 0 AND status = 'active' AND id <> ? ORDER BY display_name").all(req.user!.id) as IdRow[]
    if (q) rows = rows.filter((r) => `${r.display_name} ${r.username} ${r.bio ?? ''}`.toLowerCase().includes(q))
    res.json({ people: rows.slice(0, 100).map((r) => personJson(r, req.user!.id)) })
  }),
)

socialRouter.get(
  '/people/:id',
  requireUser,
  wrap((req, res) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ? AND disabled = 0').get(Number(req.params.id)) as IdRow | undefined
    if (!row) throw new HttpError(404, 'Person not found')
    res.json({ person: personJson(row, req.user!.id) })
  }),
)

/* ---------- buddies ---------- */

socialRouter.get(
  '/buddies',
  requireUser,
  wrap((req, res) => {
    const me = req.user!.id
    const accepted = db
      .prepare("SELECT u.* FROM users u WHERE u.id IN (SELECT buddy_id FROM buddies WHERE user_id = ? AND status = 'accepted' UNION SELECT user_id FROM buddies WHERE buddy_id = ? AND status = 'accepted') ORDER BY u.display_name")
      .all(me, me) as IdRow[]
    const incoming = db.prepare("SELECT u.* FROM buddies b JOIN users u ON u.id = b.user_id WHERE b.buddy_id = ? AND b.status = 'pending' ORDER BY b.created_at DESC").all(me) as IdRow[]
    const outgoing = db.prepare("SELECT u.* FROM buddies b JOIN users u ON u.id = b.buddy_id WHERE b.user_id = ? AND b.status = 'pending' ORDER BY b.created_at DESC").all(me) as IdRow[]
    res.json({ buddies: accepted.map((r) => personJson(r, me)), incoming: incoming.map((r) => personJson(r, me)), outgoing: outgoing.map((r) => personJson(r, me)) })
  }),
)

/** Send a buddy request; if the other person already asked, this accepts instead. */
socialRouter.post(
  '/buddies/:id',
  requireUser,
  requirePerm('canBuddies'),
  wrap((req, res) => {
    const me = req.user!.id
    const other = Number(req.params.id)
    if (other === me) throw new HttpError(400, 'You are already your own buddy')
    const row = db.prepare('SELECT * FROM users WHERE id = ? AND disabled = 0').get(other) as IdRow | undefined
    if (!row) throw new HttpError(404, 'Person not found')
    if (areBuddies(me, other)) return res.json({ person: personJson(row, me) })
    const incoming = db.prepare("SELECT id FROM buddies WHERE user_id = ? AND buddy_id = ? AND status = 'pending'").get(other, me)
    if (incoming) db.prepare("UPDATE buddies SET status = 'accepted' WHERE user_id = ? AND buddy_id = ?").run(other, me)
    else db.prepare("INSERT OR IGNORE INTO buddies(user_id, buddy_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(me, other, now())
    res.json({ person: personJson(row, me) })
  }),
)

socialRouter.put(
  '/buddies/:id/accept',
  requireUser,
  wrap((req, res) => {
    const me = req.user!.id
    const other = Number(req.params.id)
    const r = db.prepare("UPDATE buddies SET status = 'accepted' WHERE user_id = ? AND buddy_id = ? AND status = 'pending'").run(other, me) as { changes: number }
    if (!r.changes) throw new HttpError(404, 'No pending request from that person')
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(other) as IdRow
    res.json({ person: personJson(row, me) })
  }),
)

/** Remove a buddy, decline an incoming request, or cancel an outgoing one. */
socialRouter.delete(
  '/buddies/:id',
  requireUser,
  wrap((req, res) => {
    const me = req.user!.id
    const other = Number(req.params.id)
    db.prepare('DELETE FROM buddies WHERE (user_id = ? AND buddy_id = ?) OR (user_id = ? AND buddy_id = ?)').run(me, other, other, me)
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(other) as IdRow | undefined
    res.json({ person: row ? personJson(row, me) : null })
  }),
)

/* ---------- private messages ---------- */

function messageJson(m: IdRow) {
  return { id: m.id, fromId: m.from_id, toId: m.to_id, body: m.body, createdAt: m.created_at, readAt: m.read_at ?? null }
}

/** Conversations: one entry per person you have exchanged messages with, newest first, with unread counts. */
socialRouter.get(
  '/messages',
  requireUser,
  wrap((req, res) => {
    const me = req.user!.id
    const peers = db
      .prepare(
        `SELECT peer, MAX(created_at) AS last FROM (
           SELECT to_id AS peer, created_at FROM messages WHERE from_id = ?
           UNION ALL
           SELECT from_id AS peer, created_at FROM messages WHERE to_id = ?
         ) GROUP BY peer ORDER BY last DESC LIMIT 100`,
      )
      .all(me, me) as { peer: number; last: number }[]
    const conversations = peers
      .map((p) => {
        const u = db.prepare('SELECT * FROM users WHERE id = ?').get(p.peer) as IdRow | undefined
        if (!u) return null
        const last = db.prepare('SELECT * FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY created_at DESC, id DESC LIMIT 1').get(me, p.peer, p.peer, me) as IdRow
        const unread = (db.prepare('SELECT COUNT(*) c FROM messages WHERE from_id = ? AND to_id = ? AND read_at IS NULL').get(p.peer, me) as { c: number }).c
        return { person: personJson(u, me), last: messageJson(last), unread }
      })
      .filter(Boolean)
    res.json({ conversations })
  }),
)

socialRouter.get(
  '/unread',
  requireUser,
  wrap((req, res) => {
    const me = req.user!.id
    const messages = (db.prepare('SELECT COUNT(*) c FROM messages WHERE to_id = ? AND read_at IS NULL').get(me) as { c: number }).c
    const requests = (db.prepare("SELECT COUNT(*) c FROM buddies WHERE buddy_id = ? AND status = 'pending'").get(me) as { c: number }).c
    res.json({ messages, requests })
  }),
)

/** The thread with one person (latest 200), marking their messages to you as read. */
socialRouter.get(
  '/messages/:id',
  requireUser,
  wrap((req, res) => {
    const me = req.user!.id
    const other = Number(req.params.id)
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(other) as IdRow | undefined
    if (!u) throw new HttpError(404, 'Person not found')
    db.prepare('UPDATE messages SET read_at = ? WHERE from_id = ? AND to_id = ? AND read_at IS NULL').run(now(), other, me)
    const rows = db.prepare('SELECT * FROM (SELECT * FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY created_at DESC, id DESC LIMIT 200) ORDER BY created_at, id').all(me, other, other, me) as IdRow[]
    res.json({ person: personJson(u, me), messages: rows.map(messageJson) })
  }),
)

socialRouter.post(
  '/messages/:id',
  requireUser,
  requirePerm('canMessage'),
  wrap((req, res) => {
    const me = req.user!.id
    const other = Number(req.params.id)
    if (other === me) throw new HttpError(400, 'You cannot message yourself')
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND disabled = 0').get(other) as IdRow | undefined
    if (!u) throw new HttpError(404, 'Person not found')
    const body = str(req.body?.body, 4000).trim()
    if (!body) throw new HttpError(400, 'Message is empty')
    const info = db.prepare('INSERT INTO messages(from_id, to_id, body, created_at) VALUES (?, ?, ?, ?)').run(me, other, body, now())
    res.status(201).json({ message: messageJson(db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid as number) as IdRow) })
  }),
)

socialRouter.delete(
  '/messages/:id',
  requireUser,
  wrap((req, res) => {
    const r = db.prepare('DELETE FROM messages WHERE id = ? AND from_id = ?').run(Number(req.params.id), req.user!.id) as { changes: number }
    if (!r.changes) throw new HttpError(404, 'Message not found')
    res.json({ ok: true })
  }),
)
