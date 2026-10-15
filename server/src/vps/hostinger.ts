import { getSetting, setSetting } from '../db.js'
import { HttpError } from '../util.js'

/**
 * Hostinger API client (https://developers.hostinger.com). The token is stored in the panel's
 * settings and never sent to the browser; the VPS manager calls these from the server.
 */

export interface HostingerSettings {
  token: string
  vmId: number | null
  domain: string
  firewallId: number | null
  profileId: string
}

const DEFAULTS: HostingerSettings = { token: '', vmId: null, domain: 'amberxai.com', firewallId: null, profileId: '' }
export const API = process.env.HOSTINGER_API_URL || 'https://developers.hostinger.com/api'

export function getHostinger(): HostingerSettings {
  const saved = getSetting<Partial<HostingerSettings>>('devHostinger', {})
  const s = { ...DEFAULTS, ...saved }
  if (!s.token && process.env.HOSTINGER_API_TOKEN) s.token = process.env.HOSTINGER_API_TOKEN
  return s
}

export function publicHostinger() {
  const s = getHostinger()
  const saved = getSetting<Partial<HostingerSettings>>('devHostinger', {})
  return { hasToken: !!s.token, tokenSource: saved.token ? 'settings' : process.env.HOSTINGER_API_TOKEN ? 'env' : 'none', tokenHint: s.token ? `…${s.token.slice(-4)}` : '', vmId: s.vmId, domain: s.domain, firewallId: s.firewallId, profileId: s.profileId }
}

export function saveHostinger(patch: Partial<HostingerSettings> & { clearToken?: boolean }): ReturnType<typeof publicHostinger> {
  const cur = { ...DEFAULTS, ...getSetting<Partial<HostingerSettings>>('devHostinger', {}) }
  if (typeof patch.token === 'string' && patch.token.trim()) cur.token = patch.token.trim().slice(0, 500)
  if (patch.clearToken) cur.token = ''
  if (patch.vmId !== undefined) cur.vmId = patch.vmId == null ? null : Number(patch.vmId) || null
  if (patch.firewallId !== undefined) cur.firewallId = patch.firewallId == null ? null : Number(patch.firewallId) || null
  if (typeof patch.domain === 'string' && /^[a-z0-9.-]+$/i.test(patch.domain.trim())) cur.domain = patch.domain.trim().toLowerCase()
  if (typeof patch.profileId === 'string') cur.profileId = patch.profileId.slice(0, 40)
  setSetting('devHostinger', cur)
  return publicHostinger()
}

/** Call the Hostinger API; errors carry Hostinger's message. */
export async function hapi<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const s = getHostinger()
  if (!s.token) throw new HttpError(400, 'No Hostinger API token saved (VPS manager → Settings). Create one in hPanel → Account → API.')
  const res = await fetch(`${API}${path.startsWith('/') ? path : `/${path}`}`, {
    method,
    headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  }).catch((e: Error) => {
    throw new HttpError(502, `Hostinger API unreachable: ${e.message}`)
  })
  const text = await res.text()
  let data: unknown = text
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const msg = typeof data === 'object' && data && 'message' in data ? String((data as { message: unknown }).message) : text.slice(0, 300)
    throw new HttpError(res.status === 401 ? 401 : 502, `Hostinger API ${res.status}: ${msg || res.statusText}`)
  }
  return data as T
}

export function vmPath(suffix = ''): string {
  const s = getHostinger()
  if (!s.vmId) throw new HttpError(400, 'Pick your VPS in VPS manager → Settings first')
  return `/vps/v1/virtual-machines/${s.vmId}${suffix}`
}
