import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import type sodiumType from 'libsodium-wrappers'
import { getSetting, setSetting } from '../db.js'
import { getOps } from '../ops.js'
import { HttpError } from '../util.js'

/**
 * GitHub REST client for the developer panel. The token lives in the panel's settings (or the
 * GITHUB_TOKEN environment variable) and never reaches the browser; the panel and the Android app
 * only ever talk to this server, which talks to GitHub.
 */

export interface GithubSettings {
  token: string
  owner: string
  repo: string
  webhookSecret: string
  pollMinutes: number
  notify: boolean
}

export const API = process.env.GITHUB_API_URL || 'https://api.github.com'
// libsodium-wrappers ships a broken ESM entry; the CommonJS build loads fine.
const sodium = createRequire(import.meta.url)('libsodium-wrappers') as typeof sodiumType

function defaults(): GithubSettings {
  const [owner = '', repo = ''] = (getOps().repo || '').split('/')
  return { token: '', owner, repo, webhookSecret: '', pollMinutes: 3, notify: true }
}

export function getGithub(): GithubSettings {
  const saved = getSetting<Partial<GithubSettings>>('devGithub', {})
  const s = { ...defaults(), ...saved }
  if (!s.token) s.token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
  if (!s.webhookSecret) {
    s.webhookSecret = randomBytes(24).toString('hex')
    setSetting('devGithub', { ...saved, webhookSecret: s.webhookSecret })
  }
  return s
}

export function publicGithub() {
  const s = getGithub()
  const saved = getSetting<Partial<GithubSettings>>('devGithub', {})
  return { hasToken: !!s.token, tokenSource: saved.token ? 'settings' : s.token ? 'env' : 'none', tokenHint: s.token ? `…${s.token.slice(-4)}` : '', owner: s.owner, repo: s.repo, full: `${s.owner}/${s.repo}`, pollMinutes: s.pollMinutes, notify: s.notify, rate: rate() }
}

export function saveGithub(patch: Partial<GithubSettings> & { clearToken?: boolean; rotateWebhookSecret?: boolean }): ReturnType<typeof publicGithub> {
  const cur = { ...defaults(), ...getSetting<Partial<GithubSettings>>('devGithub', {}) }
  if (typeof patch.token === 'string' && patch.token.trim()) cur.token = patch.token.trim().slice(0, 300)
  if (patch.clearToken) cur.token = ''
  if (typeof patch.owner === 'string' && /^[\w.-]{1,100}$/.test(patch.owner.trim())) cur.owner = patch.owner.trim()
  if (typeof patch.repo === 'string' && /^[\w.-]{1,100}$/.test(patch.repo.trim())) cur.repo = patch.repo.trim()
  if (patch.pollMinutes !== undefined) cur.pollMinutes = Math.min(60, Math.max(0, Number(patch.pollMinutes) || 0))
  if (typeof patch.notify === 'boolean') cur.notify = patch.notify
  if (patch.rotateWebhookSecret || !cur.webhookSecret) cur.webhookSecret = randomBytes(24).toString('hex')
  setSetting('devGithub', cur)
  return publicGithub()
}

/* ---------- requests ---------- */

const rateState = { limit: 0, remaining: 0, reset: 0, used: 0 }
export const rate = () => ({ ...rateState })

export interface GhResponse<T> {
  data: T
  status: number
  headers: Headers
  /** Next page number when GitHub's Link header says there is one. */
  next: number | null
}

export async function ghRaw<T = unknown>(method: string, path: string, body?: unknown, opts: { accept?: string; text?: boolean; noAuth?: boolean; timeoutMs?: number; token?: string } = {}): Promise<GhResponse<T>> {
  const s = getGithub()
  const token = opts.token ?? s.token
  if (!token && !opts.noAuth) throw new HttpError(400, 'No GitHub token saved (GitHub manager → Settings). Create a fine-grained or classic token at github.com/settings/tokens.')
  const url = path.startsWith('http') ? path : `${API}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(url, {
    method,
    headers: {
      ...(opts.noAuth ? {} : { Authorization: `Bearer ${token}` }),
      Accept: opts.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'xgallery-dev-panel',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  }).catch((e: Error) => {
    throw new HttpError(502, `GitHub unreachable: ${e.message}`)
  })
  const lim = Number(res.headers.get('x-ratelimit-limit'))
  if (lim) Object.assign(rateState, { limit: lim, remaining: Number(res.headers.get('x-ratelimit-remaining')) || 0, reset: Number(res.headers.get('x-ratelimit-reset')) * 1000 || 0, used: Number(res.headers.get('x-ratelimit-used')) || 0 })
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    // Signed blob URLs (logs, artifacts, assets): follow without our token.
    const loc = res.headers.get('location')!
    const r2 = await fetch(loc, { headers: { 'User-Agent': 'xgallery-dev-panel', Accept: opts.accept ?? '*/*' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) })
    const t = opts.text ? await r2.text() : await r2.arrayBuffer()
    return { data: t as T, status: r2.status, headers: r2.headers, next: null }
  }
  const text = await res.text()
  let data: unknown = text
  if (!opts.text) {
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* keep the text */
    }
  }
  if (!res.ok) {
    const d = data as { message?: string; errors?: { message?: string; field?: string; code?: string }[] } | string
    const msg = typeof d === 'object' && d ? [d.message, ...(d.errors ?? []).map((e) => e.message ?? `${e.field ?? ''} ${e.code ?? ''}`.trim())].filter(Boolean).join(' · ') : String(d).slice(0, 300)
    const status = res.status === 401 ? 401 : res.status === 403 && rateState.remaining === 0 ? 429 : res.status === 404 ? 404 : res.status === 422 ? 400 : res.status === 409 ? 409 : 502
    throw new HttpError(status, `GitHub ${res.status}: ${msg || res.statusText}`)
  }
  const link = res.headers.get('link') ?? ''
  const next = link.includes('rel="next"') ? Number(link.match(/[?&]page=(\d+)[^>]*>;\s*rel="next"/)?.[1]) || null : null
  return { data: data as T, status: res.status, headers: res.headers, next }
}

export async function gh<T = unknown>(method: string, path: string, body?: unknown, opts: Parameters<typeof ghRaw>[3] = {}): Promise<T> {
  return (await ghRaw<T>(method, path, body, opts)).data
}

export function repoPath(suffix = ''): string {
  const s = getGithub()
  if (!s.owner || !s.repo) throw new HttpError(400, 'Pick a repository in GitHub manager → Settings first')
  return `/repos/${s.owner}/${s.repo}${suffix}`
}

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return p.length ? `?${p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}` : ''
}

/* ---------- repository secrets (libsodium sealed boxes, as GitHub requires) ---------- */

export async function sealForRepo(value: string, scope: 'actions' | 'dependabot' = 'actions'): Promise<{ encrypted_value: string; key_id: string }> {
  await sodium.ready
  const key = await gh<{ key_id: string; key: string }>('GET', repoPath(`/${scope}/secrets/public-key`))
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL))
  return { encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id: key.key_id }
}

export const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]{0,199}$/
