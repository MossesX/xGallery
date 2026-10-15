import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { parseCookies } from './auth.js'
import { getSetting, setSetting } from './db.js'

/**
 * PIN walls for shared private albums. A correct PIN earns a signed, album-scoped cookie for a
 * few hours; the signature key is generated once and kept in settings.
 */

function secret(): string {
  let s = getSetting<string>('pinSecret', '')
  if (!s) {
    s = randomBytes(32).toString('hex')
    setSetting('pinSecret', s)
  }
  return s
}
export const pinCookie = (albumId: number) => `xg_pin_${albumId}`
const sign = (albumId: number, exp: number) => createHmac('sha256', secret()).update(`${albumId}.${exp}`).digest('hex')

export function issuePin(res: Response, albumId: number, hours = 12): void {
  const exp = Date.now() + hours * 3600_000
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.append('Set-Cookie', `${pinCookie(albumId)}=${exp}.${sign(albumId, exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${hours * 3600}${secure}`)
}

export function hasPinAccess(req: Request, albumId: number): boolean {
  const v = parseCookies(req.headers.cookie)[pinCookie(albumId)]
  if (!v) return false
  const [exp, sig] = v.split('.')
  if (!exp || !sig || Number(exp) < Date.now()) return false
  const want = sign(albumId, Number(exp))
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig))
}

/* A small in-memory brake on guessing: 8 wrong PINs per link and address, then a 15-minute wait. */
const attempts = new Map<string, { n: number; until: number }>()
export function pinAttemptAllowed(key: string): boolean {
  const a = attempts.get(key)
  if (!a) return true
  if (a.until < Date.now()) {
    attempts.delete(key)
    return true
  }
  return a.n < 8
}
export function pinAttemptFailed(key: string): void {
  const a = attempts.get(key)
  if (a && a.until > Date.now()) a.n++
  else attempts.set(key, { n: 1, until: Date.now() + 15 * 60_000 })
}
export function pinAttemptReset(key: string): void {
  attempts.delete(key)
}
export const PIN_RE = /^\d{4,8}$/
