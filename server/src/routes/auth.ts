import { Router } from 'express'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { db, getSetting, now, setSetting } from '../db.js'
import { attemptsFor, createSession, destroySession, hashPassword, loginFailed, loginSucceeded, loginThrottle, newSalt, publicUser, requireOwner, requireUser, returningOwner, setSessionCookie, verifyPassword } from '../auth.js'
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

/* ---------- owner recovery (typing username "password" + password "reset" on the sign-in page) ---------- */

interface RecoveryCode { hash: string; usedAt: number | null }
const codeHash = (code: string) => createHash('sha256').update(`owner-recovery:${code.replace(/[^a-z0-9]/gi, '').toLowerCase()}`).digest('hex')
const recoveryCodes = () => getSetting<{ codes: RecoveryCode[]; generatedAt: number }>('ownerRecoveryCodes', { codes: [], generatedAt: 0 })
const envKey = () => (process.env.RESET_OWNER_PASSWORD ?? '').trim()
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const firstOwner = () => db.prepare("SELECT * FROM users WHERE role = 'owner' ORDER BY id LIMIT 1").get() as IdRow | undefined

/** What the recovery dialog can offer: the deploy secret, unused recovery codes, or nothing yet. */
authRouter.get('/owner-recovery', (_req, res) => {
  const rc = recoveryCodes()
  res.json({ viaSecret: !!envKey(), codesLeft: rc.codes.filter((c) => !c.usedAt).length, owner: firstOwner()?.username ?? null })
})

/**
 * Reset the owner password with a recovery key: the RESET_OWNER_PASSWORD deploy secret, or one of the
 * single-use recovery codes generated in the owner console. Heavily throttled; every attempt is logged.
 */
authRouter.post(
  '/owner-recovery',
  wrap((req, res) => {
    const key = str(req.body?.key, 200).trim()
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    try {
      loginThrottle(`recover:${req.ip}`, 5)
    } catch (e) {
      logActivity({ userId: null, kind: 'security.owner_recovery_throttled', ip: req.ip ?? '' })
      throw new HttpError(429, (e as Error).message)
    }
    const owner = firstOwner()
    if (!owner) throw new HttpError(400, 'There is no owner account to recover')
    const minLen = getPolicy().minPasswordLength
    if (password.length < minLen) throw new HttpError(400, `New password must be at least ${minLen} characters`)
    const rc = recoveryCodes()
    const env = envKey()
    let via: 'secret' | 'code' | null = null
    if (key && env && same(key, env)) via = 'secret'
    else if (key) {
      const h = codeHash(key)
      const hit = rc.codes.find((c) => !c.usedAt && same(c.hash, h))
      if (hit) {
        hit.usedAt = now()
        setSetting('ownerRecoveryCodes', rc)
        via = 'code'
      }
    }
    if (!via) {
      loginFailed(`recover:${req.ip}`)
      logActivity({ userId: owner.id as number, kind: 'security.owner_recovery_failed', ip: req.ip ?? '' })
      notifyOwner({ kind: 'security.owner_recovery_failed', title: 'Someone tried to reset the owner password with a wrong recovery key', body: `From ${req.ip}. If this was not you, rotate your recovery codes and the RESET_OWNER_PASSWORD secret.`, data: { ip: req.ip } })
      throw new HttpError(401, env || rc.codes.some((c) => !c.usedAt) ? 'That recovery key is not right' : 'No recovery key exists yet: set the RESET_OWNER_PASSWORD secret and deploy, or use the docker command in the README')
    }
    const salt = newSalt()
    db.prepare('UPDATE users SET salt = ?, password_hash = ?, must_change_password = 0, disabled = 0 WHERE id = ?').run(salt, hashPassword(password, salt), owner.id)
    for (const t of db.prepare('SELECT token FROM sessions WHERE user_id = ?').all(owner.id) as { token: string }[]) endSessionsForLogin(t.token, 'owner-recovery')
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(owner.id)
    loginSucceeded(`recover:${req.ip}`)
    logActivity({ userId: owner.id as number, kind: 'security.owner_recovery', targetLabel: via, ip: req.ip ?? '' })
    notifyOwner({ kind: 'security.owner_reset', title: `Owner password reset from the sign-in page (${via === 'secret' ? 'deploy secret' : 'recovery code'})`, body: `From ${req.ip}. Every other session was signed out.${via === 'code' ? ` ${rc.codes.filter((c) => !c.usedAt).length} recovery code(s) left.` : ' Remove the RESET_OWNER_PASSWORD secret if you no longer need it.'}`, data: { ip: req.ip, via } })
    const token = createSession(owner.id as number)
    setSessionCookie(res, token)
    db.prepare("UPDATE users SET last_seen_at = ?, status = 'active' WHERE id = ?").run(now(), owner.id)
    res.json({ ok: true, via, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(owner.id) as IdRow) })
  }),
)

/** Recovery codes: the owner generates a fresh set (shown once) after confirming the account password. */
authRouter.get('/owner-recovery/codes', requireOwner, (_req, res) => {
  const rc = recoveryCodes()
  res.json({ total: rc.codes.length, remaining: rc.codes.filter((c) => !c.usedAt).length, generatedAt: rc.generatedAt || null, viaSecret: !!envKey() })
})
authRouter.post(
  '/owner-recovery/codes',
  requireOwner,
  wrap((req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as IdRow
    if (!verifyPassword(password, row.salt as string, row.password_hash as string)) throw new HttpError(400, 'Your account password is not right')
    const codes = Array.from({ length: 8 }, () => randomBytes(6).toString('hex').match(/.{4}/g)!.join('-'))
    setSetting('ownerRecoveryCodes', { codes: codes.map((c) => ({ hash: codeHash(c), usedAt: null })), generatedAt: now() })
    logActivity({ userId: req.user!.id, kind: 'security.owner_recovery_codes', ip: req.ip ?? '' })
    res.json({ codes, generatedAt: now() })
  }),
)
