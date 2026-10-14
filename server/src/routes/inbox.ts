import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { db, now } from '../db.js'
import { hashPassword, newSalt, publicUser, requireOwner, requireUser } from '../auth.js'
import { HttpError, str, wrap, IdRow } from '../util.js'
import { ensureGalleryFor, grantGallery, galleryOf } from '../access.js'

/**
 * The owner's inbox: account requests from visitors and contact messages from members. Separate
 * from private messages, which are person to person; this is site administration.
 */
export const inboxRouter = Router()

// Light abuse control for the public form: a handful of requests per address per hour.
const recent = new Map<string, number[]>()
function throttle(ip: string): void {
  const t = Date.now()
  const list = (recent.get(ip) ?? []).filter((x) => t - x < 3_600_000)
  if (list.length >= 5) throw new HttpError(429, 'Too many requests from this address. Try again later.')
  list.push(t)
  recent.set(ip, list)
}

function itemJson(r: IdRow) {
  const from = r.from_user_id ? (db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(r.from_user_id as number) as { id: number; username: string; display_name: string } | undefined) : undefined
  return {
    id: r.id,
    kind: r.kind,
    from: from ? { id: from.id, username: from.username, displayName: from.display_name } : null,
    name: r.name,
    contact: r.contact,
    usernameWanted: r.username_wanted,
    body: r.body,
    status: r.status,
    note: r.note,
    createdAt: r.created_at,
    handledAt: r.handled_at ?? null,
    readAt: r.read_at ?? null,
  }
}

/* ---------- public / member entry points ---------- */

inboxRouter.post(
  '/request',
  wrap((req, res) => {
    throttle(req.ip ?? 'unknown')
    const name = str(req.body?.name, 80).trim()
    const username = str(req.body?.username, 32).trim().toLowerCase()
    const contact = str(req.body?.contact, 160).trim()
    const body = str(req.body?.message, 2000).trim()
    if (!name) throw new HttpError(400, 'Tell the owner your name')
    if (username && !/^[a-z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore')
    if (!contact) throw new HttpError(400, 'Leave a way to reach you (email or handle)')
    db.prepare("INSERT INTO admin_messages(kind, from_user_id, name, contact, username_wanted, body, status, created_at) VALUES ('account_request', ?, ?, ?, ?, ?, 'open', ?)").run(req.user?.id ?? null, name, contact, username, body, now())
    res.status(201).json({ ok: true })
  }),
)

inboxRouter.post(
  '/contact',
  requireUser,
  wrap((req, res) => {
    const body = str(req.body?.message, 4000).trim()
    if (!body) throw new HttpError(400, 'Message is empty')
    db.prepare("INSERT INTO admin_messages(kind, from_user_id, name, contact, body, status, created_at) VALUES ('contact', ?, ?, ?, ?, 'open', ?)").run(req.user!.id, req.user!.display_name, `@${req.user!.username}`, body, now())
    res.status(201).json({ ok: true })
  }),
)

/* ---------- owner ---------- */

inboxRouter.get(
  '/',
  requireOwner,
  wrap((req, res) => {
    const status = str(req.query.status, 20)
    const rows = (status ? db.prepare('SELECT * FROM admin_messages WHERE status = ? ORDER BY created_at DESC LIMIT 300').all(status) : db.prepare('SELECT * FROM admin_messages ORDER BY (status = \'open\') DESC, created_at DESC LIMIT 300').all()) as IdRow[]
    res.json({ items: rows.map(itemJson) })
  }),
)

inboxRouter.get(
  '/unread',
  requireOwner,
  wrap((_req, res) => {
    const open = (db.prepare("SELECT COUNT(*) c FROM admin_messages WHERE status = 'open'").get() as { c: number }).c
    const unread = (db.prepare('SELECT COUNT(*) c FROM admin_messages WHERE read_at IS NULL').get() as { c: number }).c
    res.json({ open, unread })
  }),
)

inboxRouter.put(
  '/read',
  requireOwner,
  wrap((_req, res) => {
    db.prepare('UPDATE admin_messages SET read_at = ? WHERE read_at IS NULL').run(now())
    res.json({ ok: true })
  }),
)

/** Approve an account request (creates a pending member and returns the credentials once), dismiss, or reopen. */
inboxRouter.put(
  '/:id',
  requireOwner,
  wrap((req, res) => {
    const row = db.prepare('SELECT * FROM admin_messages WHERE id = ?').get(Number(req.params.id)) as IdRow | undefined
    if (!row) throw new HttpError(404, 'Not found')
    const action = str(req.body?.action, 20)
    const note = str(req.body?.note, 500)
    let credentials: { username: string; password: string } | null = null
    if (action === 'approve') {
      if (row.kind !== 'account_request') throw new HttpError(400, 'Only account requests can be approved')
      let username = str(req.body?.username, 32).toLowerCase() || (row.username_wanted as string) || (row.name as string).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')
      if (!/^[a-z0-9_.-]{3,32}$/.test(username)) username = `member.${randomBytes(2).toString('hex')}`
      let candidate = username
      let n = 2
      while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) candidate = `${username}${n++}`
      const password = str(req.body?.password, 72) || randomBytes(9).toString('base64url')
      if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters')
      const salt = newSalt()
      const role = req.body?.role === 'admin' ? 'admin' : 'user'
      const info = db
        .prepare("INSERT INTO users(username, display_name, role, password_hash, salt, created_at, status, created_by) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)")
        .run(candidate, (row.name as string) || candidate, role, hashPassword(password, salt), salt, now(), req.user!.id)
      const uid = info.lastInsertRowid as number
      ensureGalleryFor(uid, (row.name as string) || candidate)
      const og = galleryOf(req.user!.id)
      if (og) grantGallery(uid, og.id)
      credentials = { username: candidate, password }
      db.prepare("UPDATE admin_messages SET status = 'approved', handled_at = ?, read_at = COALESCE(read_at, ?), note = ? WHERE id = ?").run(now(), now(), note || `Account @${candidate} created`, row.id)
      res.json({ item: itemJson(db.prepare('SELECT * FROM admin_messages WHERE id = ?').get(row.id) as IdRow), credentials, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as IdRow) })
      return
    }
    if (action === 'dismiss') db.prepare("UPDATE admin_messages SET status = 'dismissed', handled_at = ?, read_at = COALESCE(read_at, ?), note = ? WHERE id = ?").run(now(), now(), note, row.id)
    else if (action === 'done') db.prepare("UPDATE admin_messages SET status = 'done', handled_at = ?, read_at = COALESCE(read_at, ?), note = ? WHERE id = ?").run(now(), now(), note, row.id)
    else if (action === 'reopen') db.prepare("UPDATE admin_messages SET status = 'open', handled_at = NULL WHERE id = ?").run(row.id)
    else if (action === 'read') db.prepare('UPDATE admin_messages SET read_at = COALESCE(read_at, ?) WHERE id = ?').run(now(), row.id)
    else throw new HttpError(400, 'Unknown action')
    res.json({ item: itemJson(db.prepare('SELECT * FROM admin_messages WHERE id = ?').get(row.id) as IdRow), credentials })
  }),
)

inboxRouter.delete(
  '/:id',
  requireOwner,
  wrap((req, res) => {
    db.prepare('DELETE FROM admin_messages WHERE id = ?').run(Number(req.params.id))
    res.json({ ok: true })
  }),
)
