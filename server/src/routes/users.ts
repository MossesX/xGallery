import { Router } from 'express'
import { randomBytes, randomInt } from 'node:crypto'
import { db, now } from '../db.js'
import { createSession, hashPassword, newSalt, publicUser, requireAdmin, requireOwner, setSessionCookie } from '../auth.js'
import { LIMIT_KEYS, PERM_KEYS, parseLimitOverrides, parsePermOverrides, resolveEffective, getPolicy } from '../policy.js'
import { galleriesOf } from '../access.js'
import { HttpError, num, str, wrap, IdRow } from '../util.js'
import { ensureGalleryFor, galleryOf, grantGallery, isOwner, managedGalleryIds } from '../access.js'
import { track } from '../activity.js'
import { resetSandbox, sandboxInfo } from '../sandbox.js'

export const usersRouter = Router()
usersRouter.use(requireAdmin)

/** Owner-only: full gallery list for the access matrix. */
usersRouter.get('/galleries', requireOwner, (_req, res) => {
  res.json({ galleries: db.prepare('SELECT g.id, g.slug, g.title, u.display_name AS owner FROM galleries g JOIN users u ON u.id = g.owner_user_id ORDER BY g.created_at').all() })
})

function userJson(r: IdRow) {
  const galleryIds = (db.prepare('SELECT gallery_id FROM gallery_access WHERE user_id = ?').all(r.id) as { gallery_id: number }[]).map((x) => x.gallery_id)
  const own = galleryOf(r.id)
  const c = (sql: string) => (db.prepare(sql).get(r.id) as { c: number }).c
  const eff = resolveEffective({ id: r.id, role: r.role as string, perms: r.perms, limits: r.limits, ai_enabled: r.ai_enabled })
  return {
    ...publicUser(r),
    permOverrides: parsePermOverrides(r.perms),
    limitOverrides: parseLimitOverrides(r.limits),
    permSources: eff.permSources,
    limitSources: eff.limitSources,
    galleries: galleriesOf(r.id).map((g) => ({ id: g.id, slug: g.slug, title: g.title, isPrimary: !!g.is_primary })),
    likes: c('SELECT COUNT(*) c FROM likes WHERE user_id = ?'),
    comments: c('SELECT COUNT(*) c FROM comments WHERE user_id = ?'),
    galleryIds,
    ownGalleryId: own?.id ?? null,
    ownGallerySlug: own?.slug ?? null,
    counts: {
      albums: (db.prepare('SELECT COUNT(*) c FROM albums a JOIN galleries g ON g.id = a.gallery_id WHERE g.owner_user_id = ?').get(r.id) as { c: number }).c,
      publicAlbums: (db.prepare("SELECT COUNT(*) c FROM albums a JOIN galleries g ON g.id = a.gallery_id WHERE g.owner_user_id = ? AND a.visibility = 'public'").get(r.id) as { c: number }).c,
      media: (db.prepare('SELECT COUNT(*) c FROM media m JOIN albums a ON a.id = m.album_id JOIN galleries g ON g.id = a.gallery_id WHERE g.owner_user_id = ?').get(r.id) as { c: number }).c,
      bytes: ((db.prepare('SELECT COALESCE(SUM(m.size), 0) s FROM media m JOIN albums a ON a.id = m.album_id JOIN galleries g ON g.id = a.gallery_id WHERE g.owner_user_id = ?').get(r.id) as { s: number }).s ?? 0),
      galleries: galleriesOf(r.id).length,
      messagesSent: c('SELECT COUNT(*) c FROM messages WHERE from_id = ?'),
      buddies: (db.prepare("SELECT COUNT(*) c FROM buddies WHERE status = 'accepted' AND (user_id = ? OR buddy_id = ?)").get(r.id, r.id) as { c: number }).c,
      sessions: c('SELECT COUNT(*) c FROM sessions WHERE user_id = ? AND expires_at > ' + now()),
      aiConversations: c('SELECT COUNT(*) c FROM ai_conversations WHERE user_id = ?'),
    },
  }
}

/** Owner: every account. Admin: accounts with access to their gallery. */
usersRouter.get(
  '/',
  wrap((req, res) => {
    let rows: IdRow[]
    if (isOwner(req.user)) rows = db.prepare('SELECT * FROM users ORDER BY created_at').all() as IdRow[]
    else {
      const g = galleryOf(req.user!.id)
      rows = g ? (db.prepare('SELECT u.* FROM users u WHERE u.id IN (SELECT user_id FROM gallery_access WHERE gallery_id = ?) OR u.created_by = ? ORDER BY u.created_at').all(g.id, req.user!.id) as IdRow[]) : []
    }
    res.json({ users: rows.map(userJson) })
  }),
)

function insertUser(v: { username: string; displayName: string; role: string; password: string; status: string; createdBy: number; email?: string; phone?: string }): IdRow {
  const salt = newSalt()
  const info = db
    .prepare('INSERT INTO users(username, display_name, role, password_hash, salt, created_at, status, created_by, email, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(v.username, v.displayName, v.role, hashPassword(v.password, salt), salt, now(), v.status, v.createdBy, v.email ?? '', v.phone ?? '')
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid as number) as IdRow
  const policy = getPolicy()
  if (policy.forcePasswordChange) db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(row.id)
  for (const g of policy.defaultGroupIds) db.prepare('INSERT OR IGNORE INTO group_members(group_id, user_id, created_at) VALUES (?, ?, ?)').run(g, row.id, now())
  if (v.email || v.phone) db.prepare('UPDATE users SET email = ?, phone = ? WHERE id = ?').run(v.email ?? '', v.phone ?? '', row.id)
  ensureGalleryFor(row.id, v.displayName)
  return row
}

usersRouter.post(
  '/',
  wrap((req, res) => {
    const username = str(req.body?.username, 32).toLowerCase()
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const displayName = str(req.body?.displayName, 80) || username
    const role = isOwner(req.user) && (req.body?.role === 'admin' || (req.body?.role === 'temp_owner' && !req.sandbox)) ? (req.body.role as string) : 'user'
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore')
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters')
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is already taken')
    const row = insertUser({ username, displayName, role, password, status: 'active', createdBy: req.user!.id, email: str(req.body?.email, 160).trim().toLowerCase(), phone: str(req.body?.phone, 40).trim() })
    const galleryIds: number[] = Array.isArray(req.body?.galleryIds) ? req.body.galleryIds.map(Number) : []
    const allowed = new Set(managedGalleryIds(req.user!))
    const grants = isOwner(req.user) ? galleryIds : galleryIds.filter((g) => allowed.has(g))
    if (!isOwner(req.user) && grants.length === 0) {
      const g = galleryOf(req.user!.id)
      if (g) grants.push(g.id)
    }
    for (const g of grants) grantGallery(row.id, g)
    track(req, 'admin.user_create', { userId: row.id, targetType: 'user', targetId: row.id, targetLabel: username, detail: { role } })
    res.status(201).json({ user: userJson(row) })
  }),
)

const ADJ = ['amber', 'golden', 'quiet', 'velvet', 'copper', 'ivory', 'indigo', 'saffron', 'cobalt', 'umber', 'sienna', 'ember', 'onyx', 'opal', 'coral']
const NOUN = ['falcon', 'harbor', 'meadow', 'summit', 'river', 'lantern', 'orchid', 'comet', 'willow', 'canyon', 'ridge', 'ember', 'atlas', 'marble', 'prism']

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(14)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out.slice(0, 4) + '-' + out.slice(4, 9) + '-' + out.slice(9, 14)
}

/** Generates a pending account with a random name and password. The password is returned once. */
usersRouter.post(
  '/generate',
  wrap((req, res) => {
    const requested = req.body?.galleryId != null ? num(req.body.galleryId) : null
    const own = galleryOf(req.user!.id)
    const galleryId = requested ?? own?.id ?? null
    if (galleryId == null) throw new HttpError(400, 'No gallery to attach the account to')
    if (!managedGalleryIds(req.user!).includes(galleryId)) throw new HttpError(403, 'You can only generate accounts for your own gallery')
    let username = ''
    for (let i = 0; i < 20 && !username; i++) {
      const candidate = `${ADJ[randomInt(ADJ.length)]}-${NOUN[randomInt(NOUN.length)]}-${randomInt(100, 999)}`
      if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) username = candidate
    }
    if (!username) throw new HttpError(500, 'Could not find a free username')
    const password = generatePassword()
    const displayName = str(req.body?.displayName, 80) || username.split('-').slice(0, 2).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
    const row = insertUser({ username, displayName, role: 'user', password, status: 'pending', createdBy: req.user!.id })
    grantGallery(row.id, galleryId)
    track(req, 'admin.user_generate', { userId: row.id, targetType: 'user', targetId: row.id, targetLabel: username })
    res.status(201).json({ user: userJson(row), credentials: { username, password } })
  }),
)

usersRouter.put(
  '/:id',
  wrap((req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as IdRow | undefined
    if (!row) throw new HttpError(404, 'User not found')
    const owner = isOwner(req.user)
    const self = id === req.user!.id
    if (!owner) {
      // Admins may only touch accounts attached to their gallery that they created, and never change roles.
      const own = galleryOf(req.user!.id)
      const attached = own && db.prepare('SELECT 1 FROM gallery_access WHERE user_id = ? AND gallery_id = ?').get(id, own.id)
      if (!attached || row.role !== 'user') throw new HttpError(403, 'You can only manage members of your own gallery')
    }
    const b = req.body ?? {}
    let role = row.role as string
    if (owner && (b.role === 'admin' || b.role === 'user' || b.role === 'owner' || b.role === 'temp_owner')) {
      if (self && b.role !== 'owner') throw new HttpError(400, 'You cannot demote your own account')
      if (req.sandbox && b.role === 'temp_owner') throw new HttpError(400, 'Temporary owners are appointed by the real owner')
      role = b.role
    }
    // Leaving the temporary-owner role throws the sandbox away.
    if (row.role === 'temp_owner' && role !== 'temp_owner' && !req.sandbox) resetSandbox(id)
    const disabled: number = typeof b.disabled === 'boolean' ? (b.disabled ? 1 : 0) : (row.disabled as number)
    if (self && disabled) throw new HttpError(400, 'You cannot disable your own account')
    const displayName = str(b.displayName, 80) || (row.display_name as string)
    db.prepare('UPDATE users SET role = ?, disabled = ?, display_name = ? WHERE id = ?').run(role, disabled, displayName, id)
    // Owner-only account controls: assistant access (any role, admins included), capabilities, login name, bio, status, picture.
    if (owner && typeof b.aiEnabled === 'boolean') {
      // The assistant switch is the canUseAssistant override; the legacy column mirrors it.
      const cur = parsePermOverrides(row.perms)
      db.prepare('UPDATE users SET ai_enabled = ?, perms = ? WHERE id = ?').run(b.aiEnabled ? 1 : 0, JSON.stringify({ ...cur, canUseAssistant: b.aiEnabled }), id)
    }
    if (owner && b.perms && typeof b.perms === 'object') {
      // Each key: true/false = override, null = inherit from group/site defaults.
      const cur = parsePermOverrides(db.prepare('SELECT perms FROM users WHERE id = ?').get(id) as { perms: string } | undefined ? (db.prepare('SELECT perms FROM users WHERE id = ?').get(id) as { perms: string }).perms : row.perms)
      const next: Record<string, boolean> = { ...cur }
      for (const k of PERM_KEYS) {
        const v = (b.perms as Record<string, unknown>)[k]
        if (v === null) delete next[k]
        else if (typeof v === 'boolean') next[k] = v
      }
      db.prepare('UPDATE users SET perms = ?, ai_enabled = ? WHERE id = ?').run(JSON.stringify(next), next.canUseAssistant === true ? 1 : next.canUseAssistant === false ? 0 : (row.ai_enabled as number), id)
    }
    if (owner && b.limits && typeof b.limits === 'object') {
      const cur = parseLimitOverrides(row.limits)
      const next: Record<string, number> = { ...cur }
      for (const k of LIMIT_KEYS) {
        const v = (b.limits as Record<string, unknown>)[k]
        if (v === null) delete next[k]
        else if (typeof v === 'number' && Number.isFinite(v)) next[k] = Math.max(0, Math.floor(v))
      }
      db.prepare('UPDATE users SET limits = ? WHERE id = ?').run(JSON.stringify(next), id)
    }
    if (owner && typeof b.email === 'string') db.prepare('UPDATE users SET email = ? WHERE id = ?').run(str(b.email, 160).trim().toLowerCase(), id)
    if (owner && typeof b.phone === 'string') db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(str(b.phone, 40).trim(), id)
    if (owner && typeof b.mustChangePassword === 'boolean') db.prepare('UPDATE users SET must_change_password = ? WHERE id = ?').run(b.mustChangePassword ? 1 : 0, id)
    if (owner && Array.isArray(b.groupIds)) {
      db.prepare('DELETE FROM group_members WHERE user_id = ?').run(id)
      for (const g of (b.groupIds as unknown[]).map(Number)) if (Number.isFinite(g)) db.prepare('INSERT OR IGNORE INTO group_members(group_id, user_id, created_at) VALUES (?, ?, ?)').run(g, id, now())
    }
    if (owner && typeof b.username === 'string' && b.username && b.username !== row.username) {
      const username = str(b.username, 32).toLowerCase()
      if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore')
      if (db.prepare('SELECT 1 FROM users WHERE username = ? AND id <> ?').get(username, id)) throw new HttpError(409, 'That username is already taken')
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id)
    }
    if (owner && typeof b.bio === 'string') db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(str(b.bio, 400), id)
    if (owner && (b.status === 'active' || b.status === 'pending')) db.prepare('UPDATE users SET status = ? WHERE id = ?').run(b.status, id)
    if (owner && b.clearAvatar === true) db.prepare('UPDATE users SET avatar_path = NULL WHERE id = ?').run(id)
    ensureGalleryFor(id, displayName)
    if (typeof b.password === 'string' && b.password) {
      if (b.password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters')
      const salt = newSalt()
      db.prepare("UPDATE users SET salt = ?, password_hash = ?, status = 'pending', must_change_password = ? WHERE id = ?").run(salt, hashPassword(b.password, salt), getPolicy().forcePasswordChange ? 1 : 0, id)
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
    }
    if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
    if (owner && Array.isArray(b.galleryIds)) {
      const ids = (b.galleryIds as unknown[]).map(Number).filter((n) => Number.isFinite(n))
      db.prepare('DELETE FROM gallery_access WHERE user_id = ?').run(id)
      for (const g of ids) grantGallery(id, g)
      const own = galleryOf(id)
      if (own) grantGallery(id, own.id)
    }
    const changed = Object.keys(b).filter((k) => k !== 'password')
    track(req, typeof b.password === 'string' && b.password ? 'admin.user_password_reset' : 'admin.user_update', { userId: id, targetType: 'user', targetId: id, targetLabel: String(row.username), detail: { fields: changed } })
    res.json({ user: userJson(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as IdRow) })
  }),
)

/** Owner: one account in full. */
usersRouter.get(
  '/:id',
  requireOwner,
  wrap((req, res) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id)) as IdRow | undefined
    if (!row) throw new HttpError(404, 'User not found')
    const gids = galleriesOf(row.id).map((g) => g.id)
    const albums = gids.length ? (db.prepare(`SELECT a.id, a.slug, a.title, a.visibility, a.updated_at, a.gallery_id, g.title AS gallery_title, (SELECT COUNT(*) FROM media m WHERE m.album_id = a.id) AS media_count FROM albums a JOIN galleries g ON g.id = a.gallery_id WHERE a.gallery_id IN (${gids.map(() => '?').join(',')}) ORDER BY a.updated_at DESC LIMIT 200`).all(...gids) as IdRow[]) : []
    const recentComments = db.prepare('SELECT id, body, created_at FROM comments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(row.id) as IdRow[]
    res.json({ user: userJson(row), albums: albums.map((a) => ({ id: a.id, slug: a.slug, title: a.title, visibility: a.visibility, updatedAt: a.updated_at, galleryId: a.gallery_id, galleryTitle: a.gallery_title, mediaCount: a.media_count })), recentComments: recentComments.map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at })) })
  }),
)

/** Owner: end every session of an account (forces a fresh sign-in everywhere). */
usersRouter.post(
  '/:id/signout',
  requireOwner,
  wrap((req, res) => {
    const id = Number(req.params.id)
    const r = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(id, id === req.user!.id ? (req.sessionToken ?? '') : '') as { changes: number }
    track(req, 'admin.user_signout', { userId: id, targetType: 'user', targetId: id, detail: { sessions: r.changes } })
    res.json({ ok: true, sessions: r.changes })
  }),
)

/** Owner: sign in as another account to see exactly what they see; a return cookie brings the owner back. */
usersRouter.post(
  '/:id/impersonate',
  requireOwner,
  wrap((req, res) => {
    const id = Number(req.params.id)
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as IdRow | undefined
    if (!row) throw new HttpError(404, 'User not found')
    if (row.role === 'owner') throw new HttpError(400, 'You are the owner already')
    if (row.disabled) throw new HttpError(400, 'That account is disabled')
    const token = createSession(id)
    track(req, 'admin.impersonate', { userId: id, targetType: 'user', targetId: id, targetLabel: String(row.username) })
    setSessionCookie(res, token, req.sessionToken ?? null)
    res.json({ user: publicUser(row) })
  }),
)

/** Owner: apply one change to many accounts at once. */
usersRouter.post(
  '/bulk',
  requireOwner,
  wrap((req, res) => {
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n: number) => Number.isFinite(n) && n !== req.user!.id) : []
    const b = req.body?.patch ?? {}
    if (!ids.length) throw new HttpError(400, 'No accounts selected')
    const marks = ids.map(() => '?').join(',')
    const owners = new Set((db.prepare(`SELECT id FROM users WHERE role = 'owner' AND id IN (${marks})`).all(...ids) as { id: number }[]).map((r) => r.id))
    const targets = ids.filter((i) => !owners.has(i))
    const tm = targets.map(() => '?').join(',')
    if (!targets.length) throw new HttpError(400, 'Nothing to change')
    if (typeof b.aiEnabled === 'boolean') {
      for (const id of targets) {
        const row = db.prepare('SELECT perms FROM users WHERE id = ?').get(id) as { perms: string }
        db.prepare('UPDATE users SET ai_enabled = ?, perms = ? WHERE id = ?').run(b.aiEnabled ? 1 : 0, JSON.stringify({ ...parsePermOverrides(row.perms), canUseAssistant: b.aiEnabled }), id)
      }
    }
    if (typeof b.disabled === 'boolean') {
      db.prepare(`UPDATE users SET disabled = ? WHERE id IN (${tm})`).run(b.disabled ? 1 : 0, ...targets)
      if (b.disabled) db.prepare(`DELETE FROM sessions WHERE user_id IN (${tm})`).run(...targets)
    }
    if (b.role === 'admin' || b.role === 'user') db.prepare(`UPDATE users SET role = ? WHERE id IN (${tm})`).run(b.role, ...targets)
    if (b.perms && typeof b.perms === 'object') {
      for (const id of targets) {
        const row = db.prepare('SELECT perms FROM users WHERE id = ?').get(id) as { perms: string }
        const next: Record<string, boolean> = { ...parsePermOverrides(row.perms) }
        for (const k of PERM_KEYS) {
          const v = (b.perms as Record<string, unknown>)[k]
          if (v === null) delete next[k]
          else if (typeof v === 'boolean') next[k] = v
        }
        db.prepare('UPDATE users SET perms = ? WHERE id = ?').run(JSON.stringify(next), id)
      }
    }
    if (b.limits && typeof b.limits === 'object') {
      for (const id of targets) {
        const row = db.prepare('SELECT limits FROM users WHERE id = ?').get(id) as { limits: string }
        const next: Record<string, number> = { ...parseLimitOverrides(row.limits) }
        for (const k of LIMIT_KEYS) {
          const v = (b.limits as Record<string, unknown>)[k]
          if (v === null) delete next[k]
          else if (typeof v === 'number' && Number.isFinite(v)) next[k] = Math.max(0, Math.floor(v))
        }
        db.prepare('UPDATE users SET limits = ? WHERE id = ?').run(JSON.stringify(next), id)
      }
    }
    if (typeof b.addGroupId === 'number') for (const id of targets) db.prepare('INSERT OR IGNORE INTO group_members(group_id, user_id, created_at) VALUES (?, ?, ?)').run(b.addGroupId, id, now())
    if (typeof b.removeGroupId === 'number') for (const id of targets) db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(b.removeGroupId, id)
    if (Array.isArray(b.grantGalleryIds)) for (const id of targets) for (const g of (b.grantGalleryIds as unknown[]).map(Number)) if (Number.isFinite(g)) grantGallery(id, g)
    if (Array.isArray(b.revokeGalleryIds)) for (const id of targets) for (const g of (b.revokeGalleryIds as unknown[]).map(Number)) if (Number.isFinite(g) && galleryOf(id)?.id !== g) db.prepare('DELETE FROM gallery_access WHERE user_id = ? AND gallery_id = ?').run(id, g)
    if (b.signOut === true) db.prepare(`DELETE FROM sessions WHERE user_id IN (${tm})`).run(...targets)
    if (b.delete === true) db.prepare(`DELETE FROM users WHERE id IN (${tm})`).run(...targets)
    for (const id of targets) track(req, 'admin.user_bulk', { userId: id, targetType: 'user', targetId: id, detail: { patch: b } })
    res.json({ ok: true, changed: targets.length })
  }),
)

usersRouter.delete(
  '/:id',
  wrap((req, res) => {
    const id = Number(req.params.id)
    if (id === req.user!.id) throw new HttpError(400, 'You cannot delete your own account')
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as IdRow | undefined
    if (!row) throw new HttpError(404, 'User not found')
    if (!isOwner(req.user) && (row.created_by !== req.user!.id || row.role !== 'user')) throw new HttpError(403, 'You can only delete members you created')
    if (row.role === 'owner') throw new HttpError(400, 'The owner account cannot be deleted')
    track(req, 'admin.user_delete', { userId: id, targetType: 'user', targetId: id, targetLabel: String(row.username) })
    if (row.role === 'temp_owner' && !req.sandbox) resetSandbox(id)
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    res.json({ ok: true })
  }),
)


/** The real owner throws a temporary owner's sandbox away: their next request starts from the live site again. */
usersRouter.post(
  '/:id/sandbox/reset',
  requireOwner,
  wrap((req, res) => {
    if (req.sandbox) throw new HttpError(403, 'Only the real owner resets other sandboxes')
    const id = Number(req.params.id)
    const row = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id) as IdRow | undefined
    if (!row || row.role !== 'temp_owner') throw new HttpError(404, 'No temporary owner with that id')
    resetSandbox(id)
    track(req, 'admin.sandbox_reset', { targetType: 'user', targetId: id, targetLabel: String(row.username) })
    res.json({ ok: true })
  }),
)
usersRouter.get(
  '/:id/sandbox',
  requireOwner,
  wrap((req, res) => {
    const id = Number(req.params.id)
    res.json({ sandbox: req.sandbox ? null : sandboxInfo(id) })
  }),
)
