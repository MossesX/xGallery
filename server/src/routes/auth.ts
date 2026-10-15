import { Router } from 'express'
import { db, now } from '../db.js'
import { attemptsFor, createSession, destroySession, hashPassword, loginFailed, loginSucceeded, loginThrottle, newSalt, publicUser, requireUser, returningOwner, setSessionCookie, verifyPassword } from '../auth.js'
import { HttpError, str, wrap, IdRow } from '../util.js'
import { track, logActivity } from '../activity.js'
import { notifyOwner } from '../notifications.js'
import { getPolicy } from '../policy.js'
import { endSessionsForLogin } from '../dev.js'

export const authRouter = Router()

authRouter.post(
  '/login',
  wrap((req, res) => {
    const username = str(req.body?.username, 64).toLowerCase()
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const maxAttempts = getPolicy().loginAttempts
    try {
      loginThrottle(`ip:${req.ip}`, maxAttempts * 3)
      loginThrottle(`user:${username}`, maxAttempts)
    } catch (e) {
      logActivity({ userId: null, kind: 'security.login_throttled', targetLabel: username, ip: req.ip ?? '' })
      throw new HttpError(429, (e as Error).message)
    }
    const row = db.prepare('SELECT * FROM users WHERE username = ? OR (email <> \'\' AND email = ?)').get(username, username) as IdRow | undefined
    if (!row || !verifyPassword(password, row.salt as string, row.password_hash as string)) {
      loginFailed(`ip:${req.ip}`)
      loginFailed(`user:${username}`)
      logActivity({ userId: (row?.id as number | undefined) ?? null, kind: 'auth.login_failed', targetLabel: username, ip: req.ip ?? '' })
      const recent = (attemptsFor(username) ?? 0)
      if (recent === Math.max(3, Math.floor(maxAttempts / 2))) notifyOwner({ kind: 'security.failed_logins', title: `Repeated failed sign-ins for ${username}`, body: `${recent} failed attempts in the last 15 minutes from ${req.ip}`, data: { username, ip: req.ip } })
      throw new HttpError(401, 'Invalid username or password')
    }
    loginSucceeded(`user:${username}`)
    if (row.disabled) throw new HttpError(403, 'This account has been disabled')
    const token = createSession(row.id as number)
    logActivity({ userId: row.id as number, kind: 'auth.login', targetLabel: username, ip: req.ip ?? '', detail: { userAgent: str(req.headers['user-agent'], 200) } })
    if (!row.last_seen_at && row.role !== 'owner') notifyOwner({ kind: 'member.first_login', title: `${row.display_name} signed in for the first time`, actorId: row.id as number, data: { userId: row.id, username } })
    setSessionCookie(res, token)
    db.prepare("UPDATE users SET last_seen_at = ?, status = 'active' WHERE id = ?").run(now(), row.id)
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(row.id) as IdRow) })
  }),
)

authRouter.post(
  '/logout',
  wrap((req, res) => {
    if (req.user) track(req, 'auth.logout')
    if (req.sessionToken) {
      endSessionsForLogin(req.sessionToken, 'signout')
      destroySession(req.sessionToken)
    }
    setSessionCookie(res, null, null)
    res.json({ ok: true })
  }),
)

authRouter.get('/me', (req, res) => {
  const ret = req.user ? returningOwner(req) : null
  res.json({ user: req.user ?? null, viewingAs: ret && ret.user.id !== req.user!.id ? { owner: { id: ret.user.id, displayName: ret.user.display_name } } : null })
})

/** Owner: leave a "sign in as" session and return to their own account. */
authRouter.post(
  '/return',
  wrap((req, res) => {
    const ret = returningOwner(req)
    if (!ret) throw new HttpError(400, 'Not viewing as anyone')
    if (req.sessionToken && req.sessionToken !== ret.token) destroySession(req.sessionToken)
    logActivity({ userId: req.user!.id, actorId: ret.user.id, kind: 'admin.impersonate_end', targetType: 'user', targetId: req.user!.id, targetLabel: req.user!.username, ip: req.ip ?? '' })
    setSessionCookie(res, ret.token, null)
    res.json({ user: ret.user })
  }),
)

authRouter.put(
  '/profile',
  requireUser,
  wrap((req, res) => {
    if (!req.user!.perms.canChangeProfile) throw new HttpError(403, 'Your account is not allowed to change its profile. Ask the owner.')
    const displayName = str(req.body?.displayName, 80) || req.user!.username
    const bio = str(req.body?.bio, 400)
    db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(displayName, bio, req.user!.id)
    track(req, 'profile.update', { detail: { displayName } })
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as IdRow
    res.json({ user: publicUser(row) })
  }),
)

authRouter.post(
  '/password',
  requireUser,
  wrap((req, res) => {
    const current = typeof req.body?.current === 'string' ? req.body.current : ''
    const next = typeof req.body?.next === 'string' ? req.body.next : ''
    const minLen = getPolicy().minPasswordLength
    if (next.length < minLen) throw new HttpError(400, `New password must be at least ${minLen} characters`)
    if (next === current) throw new HttpError(400, 'Choose a password you have not used just now')
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as IdRow
    if (!verifyPassword(current, row.salt as string, row.password_hash as string)) throw new HttpError(400, 'Current password is incorrect')
    const salt = newSalt()
    db.prepare('UPDATE users SET salt = ?, password_hash = ?, must_change_password = 0 WHERE id = ?').run(salt, hashPassword(next, salt), req.user!.id)
    // sign other sessions out
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user!.id, req.sessionToken ?? '')
    track(req, 'profile.password_changed')
    res.json({ ok: true })
  }),
)

/** Visitors who lost their password: records a reset request for the owner (no email is sent). */
authRouter.post(
  '/forgot',
  wrap((req, res) => {
    const who = str(req.body?.username, 160).trim().toLowerCase()
    const note = str(req.body?.message, 500).trim()
    if (!who) throw new HttpError(400, 'Enter your username, email or phone')
    const row = db.prepare('SELECT id, username, display_name FROM users WHERE username = ? OR email = ? OR phone = ?').get(who, who, who) as { id: number; username: string; display_name: string } | undefined
    const info = db.prepare("INSERT INTO admin_messages(kind, from_user_id, name, contact, username_wanted, body, status, created_at) VALUES ('password_reset', ?, ?, ?, ?, ?, 'open', ?)").run(row?.id ?? null, row?.display_name ?? who, who, row?.username ?? '', note || 'Forgot password', now())
    notifyOwner({ kind: 'inbox.password_reset', title: `Password reset requested for ${row ? `@${row.username}` : who}`, body: note, actorId: row?.id ?? null, data: { inboxId: info.lastInsertRowid, userId: row?.id ?? null, who } })
    logActivity({ userId: row?.id ?? null, kind: 'auth.forgot_password', targetLabel: who, ip: req.ip ?? '' })
    // Always the same answer, so the form cannot be used to probe for accounts.
    res.json({ ok: true })
  }),
)
