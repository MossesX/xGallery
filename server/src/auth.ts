import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { db, now } from './db.js'
import { PERM_LABELS, getPolicy, resolveEffective, type Limits, type Perms } from './policy.js'
export type { Perms, Limits } from './policy.js'

export interface User {
  id: number
  username: string
  display_name: string
  role: 'owner' | 'admin' | 'user'
  disabled: number
  status: 'active' | 'pending'
  created_by: number | null
  bio: string
  avatarUrl: string | null
  aiEnabled: boolean
  perms: Perms
  limits: Limits
  groups: { id: number; name: string }[]
  mustChangePassword: boolean
  email: string
  phone: string
  created_at: number
  last_seen_at: number | null
}


/** Public URL of a user's profile picture, versioned by its stored path so browsers refresh on change. */
export function avatarUrlFor(id: number, avatarPath: unknown): string | null {
  return typeof avatarPath === 'string' && avatarPath ? `/api/social/avatar/${id}?v=${encodeURIComponent(avatarPath.replace(/^.*[/\\]/, '').replace(/\.[^.]*$/, ''))}` : null
}

const SESSION_DAYS = 30
const sessionDays = () => { try { return getPolicy().sessionDays } catch { return SESSION_DAYS } }
export const COOKIE = 'xg_session'
/** While the owner is signed in as someone else, this holds the owner's own session token. */
export const RETURN_COOKIE = 'xg_return'

export function hashPassword(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, 120_000, 32, 'sha256').toString('hex')
}

export function newSalt(): string {
  return randomBytes(16).toString('hex')
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const a = Buffer.from(hashPassword(password, salt), 'hex')
  const b = Buffer.from(hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function publicUser(row: Record<string, unknown>): User {
  const eff = resolveEffective({ id: row.id as number, role: row.role as string, perms: row.perms, limits: row.limits, ai_enabled: row.ai_enabled })
  return {
    id: row.id as number,
    username: row.username as string,
    display_name: row.display_name as string,
    role: row.role as 'owner' | 'admin' | 'user',
    disabled: row.disabled as number,
    status: ((row.status as string) === 'pending' ? 'pending' : 'active'),
    created_by: (row.created_by as number | null) ?? null,
    bio: (row.bio as string) ?? '',
    avatarUrl: avatarUrlFor(row.id as number, row.avatar_path),
    aiEnabled: eff.perms.canUseAssistant,
    perms: eff.perms,
    limits: eff.limits,
    groups: eff.groups,
    mustChangePassword: !!row.must_change_password,
    email: (row.email as string) ?? '',
    phone: (row.phone as string) ?? '',
    created_at: row.created_at as number,
    last_seen_at: (row.last_seen_at as number | null) ?? null,
  }
}

/** Sliding-window login throttle per IP and per username, sized by policy. */
const attempts = new Map<string, number[]>()
export function loginThrottle(key: string, max: number): void {
  const t = Date.now()
  const list = (attempts.get(key) ?? []).filter((x) => t - x < 15 * 60_000)
  attempts.set(key, list)
  if (list.length >= max) throw new Error('Too many sign-in attempts. Try again in a few minutes.')
}
export function loginFailed(key: string): void {
  const list = attempts.get(key) ?? []
  list.push(Date.now())
  attempts.set(key, list)
}
export function loginSucceeded(key: string): void {
  attempts.delete(key)
}
export function attemptsFor(username: string): number {
  const t = Date.now()
  return (attempts.get(`user:${username}`) ?? []).filter((x) => t - x < 15 * 60_000).length
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('base64url')
  const t = now()
  db.prepare('INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, t, t + SESSION_DAYS * 86_400_000)
  return token
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function setSessionCookie(res: Response, token: string | null, returnToken?: string | null): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  const cookies: string[] = []
  if (token) cookies.push(`${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDays() * 86_400}${secure}`)
  else cookies.push(`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
  if (returnToken !== undefined) {
    if (returnToken) cookies.push(`${RETURN_COOKIE}=${returnToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}${secure}`)
    else cookies.push(`${RETURN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
  }
  res.setHeader('Set-Cookie', cookies)
}

/** The owner's own user when they are signed in as someone else, else null. */
export function returningOwner(req: Request): { user: User; token: string } | null {
  const token = parseCookies(req.headers.cookie)[RETURN_COOKIE]
  if (!token) return null
  const row = db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND u.disabled = 0 AND u.role = 'owner'").get(token, now()) as Record<string, unknown> | undefined
  return row ? { user: publicUser(row), token } : null
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User
    sessionToken?: string
  }
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = parseCookies(req.headers.cookie)[COOKIE]
  if (!token) return next()
  const row = db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND u.disabled = 0')
    .get(token, now()) as Record<string, unknown> | undefined
  if (row) {
    req.user = publicUser(row)
    req.sessionToken = token
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), req.user.id)
  }
  next()
}

/** Gate a route on one of the owner-controlled capabilities. */
export function requirePerm(perm: keyof Perms) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Sign in required' })
      return
    }
    if (!req.user.perms[perm]) {
      res.status(403).json({ error: `Your account is not allowed to ${PERM_LABELS[perm]}. Ask the owner.` })
      return
    }
    next()
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in required' })
    return
  }
  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in required' })
    return
  }
  if (req.user.role !== 'admin' && req.user.role !== 'owner') {
    res.status(403).json({ error: 'Administrator access required' })
    return
  }
  next()
}

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in required' })
    return
  }
  if (req.user.role !== 'owner') {
    res.status(403).json({ error: 'Owner access required' })
    return
  }
  next()
}

/** Removes expired sessions. */
export function pruneSessions(): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now())
}
