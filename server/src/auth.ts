import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { db, now } from './db.js'

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
  created_at: number
  last_seen_at: number | null
}

/** Per-account capabilities the owner can switch off. Everything is on by default. */
export interface Perms {
  canUpload: boolean
  canMessage: boolean
  canComment: boolean
  canReact: boolean
  canBuddies: boolean
  canPublish: boolean
}
export const DEFAULT_PERMS: Perms = { canUpload: true, canMessage: true, canComment: true, canReact: true, canBuddies: true, canPublish: true }
export const PERM_LABELS: Record<keyof Perms, string> = {
  canUpload: 'create albums and upload media',
  canMessage: 'send private messages',
  canComment: 'comment',
  canReact: 'like and save albums',
  canBuddies: 'send buddy requests',
  canPublish: 'make albums public',
}
export function parsePerms(v: unknown): Perms {
  let o: Partial<Perms> = {}
  if (typeof v === 'string') {
    try {
      o = JSON.parse(v) as Partial<Perms>
    } catch {
      o = {}
    }
  } else if (v && typeof v === 'object') o = v as Partial<Perms>
  const out = { ...DEFAULT_PERMS }
  for (const k of Object.keys(DEFAULT_PERMS) as (keyof Perms)[]) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean
  return out
}

/** Public URL of a user's profile picture, versioned by its stored path so browsers refresh on change. */
export function avatarUrlFor(id: number, avatarPath: unknown): string | null {
  return typeof avatarPath === 'string' && avatarPath ? `/api/social/avatar/${id}?v=${encodeURIComponent(avatarPath.replace(/^.*[/\\]/, '').replace(/\.[^.]*$/, ''))}` : null
}

const SESSION_DAYS = 30
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
    aiEnabled: row.role === 'owner' || !!row.ai_enabled,
    perms: row.role === 'owner' ? { ...DEFAULT_PERMS } : parsePerms(row.perms),
    created_at: row.created_at as number,
    last_seen_at: (row.last_seen_at as number | null) ?? null,
  }
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
  if (token) cookies.push(`${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure}`)
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
