import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { NextFunction, Request, Response } from 'express'
import { db, getSetting, now, setSetting } from './db.js'
import { hashPassword, newSalt, verifyPassword } from './auth.js'
import { HttpError, type IdRow } from './util.js'
import { logActivity } from './activity.js'
import { ensureWorkspace, isTextFile, listFiles, safePath, SOURCE_DIR, sourceVersion, WORKSPACE } from './ai/workspace.js'
import { DEFAULT_SETTINGS } from './brand.js'

/**
 * The developer panel's backbone.
 *
 * - A developer password (set by the owner) must be entered once per login session; the unlocked
 *   state is a `dev_sessions` row bound to the login session token and expires after inactivity.
 * - Every change made while unlocked is a `dev_events` row (file edits, config saves, AI turns,
 *   checkpoints, restores) and each session ends with a written summary.
 * - Nothing is ever lost: site design lives in settings and is snapshotted before every save
 *   (`dev_snapshots`), source edits happen in the git-backed workspace copy and are checkpointed
 *   before every change. Both can be restored with one click.
 */

/* ---------- developer password ---------- */

interface DevSettings {
  salt: string
  hash: string
  setAt: number | null
  setBy: number | null
  sessionMinutes: number
}

const DEFAULT_DEV: DevSettings = { salt: '', hash: '', setAt: null, setBy: null, sessionMinutes: 120 }

export function devSettings(): DevSettings {
  return { ...DEFAULT_DEV, ...getSetting<Partial<DevSettings>>('dev', {}) }
}

export function devPasswordSet(): boolean {
  return !!devSettings().hash
}

export function setDevPassword(password: string, byUserId: number): void {
  if (password.length < 8) throw new HttpError(400, 'The developer password must be at least 8 characters')
  const salt = newSalt()
  setSetting('dev', { ...devSettings(), salt, hash: hashPassword(password, salt), setAt: now(), setBy: byUserId })
}

export function setDevSessionMinutes(minutes: number): void {
  setSetting('dev', { ...devSettings(), sessionMinutes: Math.min(720, Math.max(10, Math.round(minutes))) })
}

export function verifyDevPassword(password: string): boolean {
  const s = devSettings()
  return !!s.hash && verifyPassword(password, s.salt, s.hash)
}

/* ---------- sessions ---------- */

export interface DevSession {
  id: number
  user_id: number
  login_token: string
  started_at: number
  last_active_at: number
  ended_at: number | null
  end_reason: string
  ip: string
  user_agent: string
  summary: string
  summary_source: string
  changes: number
}

declare module 'express-serve-static-core' {
  interface Request {
    devSession?: DevSession
  }
}

const throttle = new Map<string, number>()

function openSessionFor(token: string): DevSession | undefined {
  return db.prepare('SELECT * FROM dev_sessions WHERE login_token = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1').get(token) as unknown as DevSession | undefined
}

/** Attach the open developer session of this login session, expiring it when idle too long. */
export function attachDev(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role === 'owner' && req.sessionToken) {
    const s = openSessionFor(req.sessionToken)
    if (s) {
      const limit = devSettings().sessionMinutes * 60_000
      if (now() - s.last_active_at > limit) endSession(s.id, 'expired')
      else {
        req.devSession = s
        const last = throttle.get(req.sessionToken) ?? 0
        if (now() - last > 30_000) {
          throttle.set(req.sessionToken, now())
          db.prepare('UPDATE dev_sessions SET last_active_at = ? WHERE id = ?').run(now(), s.id)
        }
      }
    }
  }
  next()
}

/** The open developer session bound to a login token, or undefined when locked or expired. */
export function devSessionForToken(token: string): DevSession | undefined {
  const s = openSessionFor(token)
  if (!s) return undefined
  if (now() - s.last_active_at > devSettings().sessionMinutes * 60_000) {
    endSession(s.id, 'expired')
    return undefined
  }
  return s
}

export function requireDev(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in required' })
    return
  }
  if (req.sandbox) {
    res.status(403).json({ error: 'The developer panel is not available to a temporary owner: it changes the real server, source code and services', code: 'sandbox' })
    return
  }
  if (req.user.role !== 'owner') {
    res.status(403).json({ error: 'The developer panel is for the site owner' })
    return
  }
  if (!req.devSession) {
    res.status(403).json({ error: devPasswordSet() ? 'Enter the developer password to continue' : 'Set a developer password first', code: 'dev_locked' })
    return
  }
  next()
}

export function unlockDev(req: Request, password: string): DevSession {
  if (!req.user || !req.sessionToken) throw new HttpError(401, 'Sign in required')
  if (!devPasswordSet()) throw new HttpError(400, 'No developer password has been set yet')
  if (!verifyDevPassword(password)) {
    logActivity({ userId: req.user.id, kind: 'dev.unlock_failed', ip: req.ip ?? '' })
    throw new HttpError(401, 'Wrong developer password')
  }
  const open = openSessionFor(req.sessionToken)
  if (open) endSession(open.id, 'replaced')
  const info = db
    .prepare('INSERT INTO dev_sessions(user_id, login_token, started_at, last_active_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, req.sessionToken, now(), now(), req.ip ?? '', String(req.headers['user-agent'] ?? '').slice(0, 200))
  const s = db.prepare('SELECT * FROM dev_sessions WHERE id = ?').get(info.lastInsertRowid as number) as unknown as DevSession
  req.devSession = s
  recordEvent(s.id, 'session.unlock', { summary: `Developer session opened from ${req.ip ?? 'unknown'}` })
  logActivity({ userId: req.user.id, kind: 'dev.unlock', targetType: 'dev_session', targetId: s.id, ip: req.ip ?? '' })
  return s
}

export function endSession(id: number, reason: string): void {
  const s = db.prepare('SELECT * FROM dev_sessions WHERE id = ?').get(id) as unknown as DevSession | undefined
  if (!s || s.ended_at) return
  recordEvent(id, 'session.end', { summary: reason === 'lock' ? 'Developer session locked' : reason === 'expired' ? 'Developer session expired after inactivity' : `Developer session ended (${reason})` })
  const summary = buildSummary(id)
  db.prepare("UPDATE dev_sessions SET ended_at = ?, end_reason = ?, summary = ?, summary_source = 'auto' WHERE id = ?").run(now(), reason, summary, id)
}

/** Close developer sessions whose login session is gone (sign-out, expiry). */
export function endSessionsForLogin(token: string, reason = 'signout'): void {
  for (const s of db.prepare('SELECT id FROM dev_sessions WHERE login_token = ? AND ended_at IS NULL').all(token) as { id: number }[]) endSession(s.id, reason)
}

export function sweepDevSessions(): void {
  const limit = devSettings().sessionMinutes * 60_000
  for (const s of db.prepare('SELECT id, last_active_at FROM dev_sessions WHERE ended_at IS NULL').all() as { id: number; last_active_at: number }[]) if (now() - s.last_active_at > limit) endSession(s.id, 'expired')
}

/* ---------- events ---------- */

export const CHANGE_KINDS = new Set(['file.write', 'file.create', 'file.delete', 'file.restore', 'config.save', 'theme.save', 'theme.delete', 'theme.activate', 'snapshot.restore', 'checkpoint.restore', 'workspace.reset', 'ai.file_change'])

export function recordEvent(sessionId: number, kind: string, opts: { path?: string; detail?: unknown; summary?: string } = {}): void {
  db.prepare('INSERT INTO dev_events(session_id, ts, kind, path, detail, summary) VALUES (?, ?, ?, ?, ?, ?)').run(sessionId, now(), kind, opts.path ?? '', JSON.stringify(opts.detail ?? {}), (opts.summary ?? '').slice(0, 600))
  if (CHANGE_KINDS.has(kind)) db.prepare('UPDATE dev_sessions SET changes = changes + 1, last_active_at = ? WHERE id = ?').run(now(), sessionId)
}

/** Log an event on the request's developer session, when there is one (routes shared with the admin panel). */
export function devEvent(req: Request, kind: string, opts: { path?: string; detail?: unknown; summary?: string } = {}): void {
  if (req.devSession) recordEvent(req.devSession.id, kind, opts)
}

export function eventJson(r: IdRow) {
  let detail: unknown = {}
  try {
    detail = JSON.parse(r.detail as string)
  } catch {
    /* ignore */
  }
  return { id: r.id, sessionId: r.session_id, ts: r.ts, kind: r.kind, path: r.path, detail, summary: r.summary }
}

export function sessionJson(r: DevSession) {
  const events = (db.prepare('SELECT COUNT(*) c FROM dev_events WHERE session_id = ?').get(r.id) as { c: number }).c
  const files = (db.prepare("SELECT COUNT(DISTINCT path) c FROM dev_events WHERE session_id = ? AND path <> '' AND kind LIKE 'file.%' OR (session_id = ? AND kind = 'ai.file_change')").get(r.id, r.id) as { c: number }).c
  return { id: r.id, userId: r.user_id, startedAt: r.started_at, lastActiveAt: r.last_active_at, endedAt: r.ended_at, endReason: r.end_reason, ip: r.ip, userAgent: r.user_agent, summary: r.summary, summarySource: r.summary_source, changes: r.changes, events, files, open: !r.ended_at }
}

/** A plain-language account of a session built from its events. */
export function buildSummary(sessionId: number): string {
  const rows = db.prepare('SELECT * FROM dev_events WHERE session_id = ? ORDER BY id').all(sessionId) as IdRow[]
  const events = rows.map(eventJson)
  const s = db.prepare('SELECT * FROM dev_sessions WHERE id = ?').get(sessionId) as unknown as DevSession | undefined
  if (!s) return ''
  const minutes = Math.max(1, Math.round(((s.ended_at ?? now()) - s.started_at) / 60_000))
  const by = (prefix: string) => events.filter((e) => String(e.kind).startsWith(prefix))
  const files = new Map<string, { kinds: Set<string>; plus: number; minus: number }>()
  for (const e of events) {
    const k = String(e.kind)
    if (!(k.startsWith('file.') || k === 'ai.file_change') || !e.path) continue
    const f = files.get(String(e.path)) ?? { kinds: new Set(), plus: 0, minus: 0 }
    f.kinds.add(k.replace('ai.file_change', 'ai edit').replace('file.', ''))
    const d = e.detail as { added?: number; removed?: number }
    f.plus += d?.added ?? 0
    f.minus += d?.removed ?? 0
    files.set(String(e.path), f)
  }
  const lines: string[] = []
  lines.push(`Developer session of ${minutes} min with ${s.changes} change${s.changes === 1 ? '' : 's'}.`)
  if (files.size) {
    lines.push(`Source files touched (${files.size}):`)
    for (const [p, f] of [...files.entries()].slice(0, 40)) lines.push(`  • ${p} — ${[...f.kinds].join(', ')}${f.plus || f.minus ? ` (+${f.plus} / −${f.minus} lines)` : ''}`)
    if (files.size > 40) lines.push(`  … and ${files.size - 40} more`)
  }
  const ai = by('ai.turn')
  if (ai.length) {
    lines.push(`AI developer turns (${ai.length}):`)
    for (const e of ai.slice(0, 15)) lines.push(`  • ${String(e.summary).slice(0, 160)}`)
  }
  const cfg = events.filter((e) => ['config.save', 'theme.save', 'theme.delete', 'theme.activate'].includes(String(e.kind)))
  if (cfg.length) {
    lines.push(`Site design changes (${cfg.length}):`)
    for (const e of cfg.slice(0, 20)) lines.push(`  • ${String(e.summary)}`)
  }
  const restores = events.filter((e) => ['snapshot.restore', 'checkpoint.restore', 'workspace.reset'].includes(String(e.kind)))
  if (restores.length) {
    lines.push(`Restores (${restores.length}):`)
    for (const e of restores) lines.push(`  • ${String(e.summary)}`)
  }
  const cps = by('checkpoint.create').length + by('snapshot.create').length
  if (cps) lines.push(`${cps} checkpoint${cps === 1 ? '' : 's'}/snapshot${cps === 1 ? '' : 's'} taken.`)
  if (lines.length === 1) lines.push('No changes were made: the session only browsed.')
  return lines.join('\n')
}

/* ---------- site design config (the no-code builder's data) ---------- */

export type ShowTo = 'all' | 'members' | 'guests' | 'admins' | 'owner'

export interface UiLink {
  id: string
  label: string
  to: string
  icon: string
  show: ShowTo
  enabled: boolean
  newTab: boolean
}

export interface UiSection {
  id: string
  type: 'hero' | 'galleries' | 'albums' | 'people' | 'tags' | 'custom'
  enabled: boolean
  title: string
  html: string
}

export interface UiConfig {
  nav: { items: UiLink[] }
  toolbar: { clock: boolean; search: boolean; bell: boolean; newAlbums: boolean; adminBell: boolean; assistant: boolean; colorMode: boolean; signOut: boolean; buttons: UiLink[] }
  footer: { text: string; links: UiLink[]; poweredBy: boolean }
  home: { sections: UiSection[] }
  contextMenu: { openAlbum: boolean; togglePublic: boolean; privateLink: boolean; askSelection: boolean; askElement: boolean; explainPage: boolean; openAssistant: boolean; copySelection: boolean; openLink: boolean; copyPageLink: boolean; custom: UiLink[] }
  css: string
  flags: Record<string, boolean>
  banner: { brand: 'amberx' | 'text'; accent: string; sticky: boolean; dense: boolean; showProduct: boolean }
  layout: { density: 'comfortable' | 'compact'; fontScale: number; radius: number | null; maxWidth: number }
}

const link = (id: string, label: string, to: string, icon: string, show: ShowTo = 'all'): UiLink => ({ id, label, to, icon, show, enabled: true, newTab: false })

export const DEFAULT_UI: UiConfig = {
  nav: {
    items: [link('home', 'Home', '/', 'Home'), link('galleries', 'Galleries', '/galleries', 'Users', 'members'), link('explore', 'People', '/public', 'Users', 'guests'), link('photos', 'Photos', '/photos', 'LayoutGrid', 'members'), link('saved', 'Saved', '/favorites', 'Bookmark', 'members'), link('messages', 'Messages', '/me/messages', 'MessageCircle', 'members'), link('admin', 'Admin', '/admin', 'Settings2', 'admins')],
  },
  toolbar: { clock: true, search: true, bell: true, newAlbums: true, adminBell: true, assistant: true, colorMode: true, signOut: true, buttons: [] },
  footer: { text: '', links: [link('public', 'Public galleries', '/public', 'Globe'), link('me', 'My space', '/me', 'UserCircle2', 'members'), link('contact', 'Contact the owner', '/contact', 'Mail', 'members'), link('request', 'Request an account', '/request-account', 'UserPlus', 'guests'), link('login', 'Member sign in', '/login', 'LogIn', 'guests')], poweredBy: true },
  home: {
    sections: [
      { id: 'hero', type: 'hero', enabled: true, title: '', html: '' },
      { id: 'galleries', type: 'galleries', enabled: true, title: 'Galleries', html: '' },
      { id: 'albums', type: 'albums', enabled: true, title: 'All albums', html: '' },
    ],
  },
  contextMenu: { openAlbum: true, togglePublic: true, privateLink: true, askSelection: true, askElement: true, explainPage: true, openAssistant: true, copySelection: true, openLink: true, copyPageLink: true, custom: [] },
  css: '',
  flags: { reactions: true, favorites: true, comments: true, timeline: true, zipDownload: true, buddies: true, messaging: true, publicDirectory: true, requestAccount: true, forgotPassword: true, galleryThemes: true, shareLinks: true, collaborators: true },
  banner: { brand: 'amberx', accent: '#ff7a1a', sticky: true, dense: false, showProduct: true },
  layout: { density: 'comfortable', fontScale: 1, radius: null, maxWidth: 1400 },
}

export const FLAG_LABELS: Record<string, string> = {
  reactions: 'Emoji reactions on media',
  favorites: 'Saved / favorites',
  comments: 'Comments',
  timeline: 'Photos timeline page',
  zipDownload: 'Album ZIP download',
  buddies: 'Buddy lists',
  messaging: 'Private messages',
  publicDirectory: 'Public people directory',
  requestAccount: 'Request-an-account page',
  forgotPassword: 'Forgot-password link',
  galleryThemes: 'Per-gallery themes',
  shareLinks: 'Private share links',
  collaborators: 'Album collaborators',
}

const SHOW: ShowTo[] = ['all', 'members', 'guests', 'admins', 'owner']
const ICON_RE = /^[A-Za-z0-9]{0,40}$/

function cleanLinks(v: unknown, max = 24): UiLink[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: UiLink[] = []
  for (const raw of v.slice(0, max)) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    let id = String(o.id ?? '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || `item-${out.length + 1}`
    while (seen.has(id)) id += '2'
    seen.add(id)
    const to = String(o.to ?? '/').trim().slice(0, 300)
    const safeTo = /^(\/|https?:\/\/|mailto:)/i.test(to) ? to : '/'
    out.push({ id, label: String(o.label ?? '').slice(0, 40) || 'Link', to: safeTo, icon: ICON_RE.test(String(o.icon ?? '')) ? String(o.icon ?? '') : '', show: SHOW.includes(o.show as ShowTo) ? (o.show as ShowTo) : 'all', enabled: o.enabled !== false, newTab: o.newTab === true })
  }
  return out
}

export function sanitizeHtml(html: string): string {
  return html
    .slice(0, 20_000)
    .replace(/<\s*(script|iframe|object|embed|link|meta|style|base|form)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|link|meta|style|base|form)[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'>\s]*/gi, '$1=$2#')
}

export function sanitizeCss(css: string): string {
  return css
    .slice(0, 60_000)
    .replace(/<\s*\/?\s*style[^>]*>/gi, '')
    .replace(/@import[^;]*;?/gi, '/* import rule removed */')
    .replace(/expression\s*\(/gi, '/* expression */(')
    .replace(/javascript\s*:/gi, '')
    .replace(/-moz-binding\s*:/gi, '')
    .replace(/behavior\s*:/gi, '')
}

const hex = (v: unknown, fallback: string) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : fallback)

/** Merge a (possibly partial, possibly hostile) config onto the defaults. */
export function sanitizeUi(input: unknown, base: UiConfig = DEFAULT_UI): UiConfig {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, Record<string, unknown>>
  const b = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const tb = o.toolbar ?? {}
  const ft = o.footer ?? {}
  const cm = o.contextMenu ?? {}
  const bn = o.banner ?? {}
  const ly = o.layout ?? {}
  const sections: UiSection[] = []
  const rawSections = Array.isArray(o.home?.sections) ? (o.home!.sections as unknown[]) : base.home.sections
  const types: UiSection['type'][] = ['hero', 'galleries', 'albums', 'people', 'tags', 'custom']
  const seen = new Set<string>()
  for (const raw of rawSections.slice(0, 12)) {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const type = types.includes(s.type as UiSection['type']) ? (s.type as UiSection['type']) : 'custom'
    let id = String(s.id ?? '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || `${type}-${sections.length + 1}`
    while (seen.has(id)) id += '2'
    seen.add(id)
    sections.push({ id, type, enabled: s.enabled !== false, title: String(s.title ?? '').slice(0, 80), html: type === 'custom' ? sanitizeHtml(String(s.html ?? '')) : '' })
  }
  const flags: Record<string, boolean> = { ...base.flags }
  if (o.flags && typeof o.flags === 'object') for (const k of Object.keys(base.flags)) if (typeof o.flags[k] === 'boolean') flags[k] = o.flags[k] as boolean
  return {
    nav: { items: o.nav && Array.isArray(o.nav.items) ? cleanLinks(o.nav.items) : base.nav.items },
    toolbar: { clock: b(tb.clock, base.toolbar.clock), search: b(tb.search, base.toolbar.search), bell: b(tb.bell, base.toolbar.bell), newAlbums: b(tb.newAlbums, base.toolbar.newAlbums), adminBell: b(tb.adminBell, base.toolbar.adminBell), assistant: b(tb.assistant, base.toolbar.assistant), colorMode: b(tb.colorMode, base.toolbar.colorMode), signOut: b(tb.signOut, base.toolbar.signOut), buttons: Array.isArray(tb.buttons) ? cleanLinks(tb.buttons, 8) : base.toolbar.buttons },
    footer: { text: String(ft.text ?? base.footer.text).slice(0, 300), links: Array.isArray(ft.links) ? cleanLinks(ft.links) : base.footer.links, poweredBy: b(ft.poweredBy, base.footer.poweredBy) },
    home: { sections: sections.length ? sections : base.home.sections },
    contextMenu: {
      openAlbum: b(cm.openAlbum, base.contextMenu.openAlbum),
      togglePublic: b(cm.togglePublic, base.contextMenu.togglePublic),
      privateLink: b(cm.privateLink, base.contextMenu.privateLink),
      askSelection: b(cm.askSelection, base.contextMenu.askSelection),
      askElement: b(cm.askElement, base.contextMenu.askElement),
      explainPage: b(cm.explainPage, base.contextMenu.explainPage),
      openAssistant: b(cm.openAssistant, base.contextMenu.openAssistant),
      copySelection: b(cm.copySelection, base.contextMenu.copySelection),
      openLink: b(cm.openLink, base.contextMenu.openLink),
      copyPageLink: b(cm.copyPageLink, base.contextMenu.copyPageLink),
      custom: Array.isArray(cm.custom) ? cleanLinks(cm.custom, 10) : base.contextMenu.custom,
    },
    css: typeof o.css === 'string' ? sanitizeCss(o.css) : base.css,
    flags,
    banner: { brand: bn.brand === 'text' ? 'text' : 'amberx', accent: hex(bn.accent, base.banner.accent), sticky: b(bn.sticky, base.banner.sticky), dense: b(bn.dense, base.banner.dense), showProduct: b(bn.showProduct, base.banner.showProduct) },
    layout: {
      density: ly.density === 'compact' ? 'compact' : 'comfortable',
      fontScale: Math.min(1.3, Math.max(0.8, Number(ly.fontScale) || base.layout.fontScale)),
      radius: ly.radius == null ? null : Math.min(32, Math.max(0, Number(ly.radius) || 0)),
      maxWidth: Math.min(2400, Math.max(900, Number(ly.maxWidth) || base.layout.maxWidth)),
    },
  }
}

export function getUi(): UiConfig {
  return sanitizeUi(getSetting<unknown>('ui', {}))
}

export function saveUi(patch: unknown): { ui: UiConfig; changed: string[] } {
  const before = getUi()
  const next = sanitizeUi(patch, before)
  const changed = (Object.keys(next) as (keyof UiConfig)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]))
  setSetting('ui', next)
  return { ui: next, changed }
}

/* ---------- config snapshots (site design) ---------- */

interface SnapshotPayload {
  version: 1
  site: Record<string, unknown>
  ui: UiConfig
  themes: Record<string, unknown>[]
}

export function configPayload(): SnapshotPayload {
  return { version: 1, site: { ...DEFAULT_SETTINGS, ...getSetting<Record<string, unknown>>('site', {}) }, ui: getUi(), themes: db.prepare('SELECT * FROM themes ORDER BY id').all() as Record<string, unknown>[] }
}

export function takeSnapshot(sessionId: number | null, name: string, kind: 'auto' | 'manual' | 'restore' = 'auto'): number {
  const payload = configPayload()
  const info = db.prepare('INSERT INTO dev_snapshots(session_id, created_at, name, kind, payload) VALUES (?, ?, ?, ?, ?)').run(sessionId, now(), name.slice(0, 120), kind, JSON.stringify(payload))
  // Keep the automatic history bounded; manual snapshots are kept until deleted.
  db.prepare("DELETE FROM dev_snapshots WHERE kind = 'auto' AND id NOT IN (SELECT id FROM dev_snapshots WHERE kind = 'auto' ORDER BY id DESC LIMIT 150)").run()
  if (sessionId) recordEvent(sessionId, 'snapshot.create', { summary: `${kind === 'manual' ? 'Snapshot' : 'Automatic snapshot'}: ${name}`, detail: { snapshotId: info.lastInsertRowid, kind } })
  return info.lastInsertRowid as number
}

export function snapshotJson(r: IdRow) {
  const payload = JSON.parse(r.payload as string) as SnapshotPayload
  return { id: r.id, sessionId: r.session_id, createdAt: r.created_at, name: r.name, kind: r.kind, themes: payload.themes.length, activeThemeId: payload.site.activeThemeId ?? null, siteTitle: payload.site.siteTitle, bytes: (r.payload as string).length }
}

export function restoreSnapshot(id: number, sessionId: number | null): void {
  const row = db.prepare('SELECT * FROM dev_snapshots WHERE id = ?').get(id) as IdRow | undefined
  if (!row) throw new HttpError(404, 'Snapshot not found')
  const payload = JSON.parse(row.payload as string) as SnapshotPayload
  takeSnapshot(sessionId, `Before restoring “${row.name}”`, 'restore')
  const tx = db.prepare('BEGIN')
  tx.run()
  try {
    setSetting('site', payload.site)
    setSetting('ui', sanitizeUi(payload.ui))
    const upsert = db.prepare('INSERT OR REPLACE INTO themes(id, name, light, dark, font_display, font_body, radius, scale, built_in, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const t of payload.themes) upsert.run(t.id as number, t.name as string, t.light as string, t.dark as string, t.font_display as string, t.font_body as string, t.radius as number, t.scale as number, (t.built_in as number) ?? 0, t.created_at as number)
    db.prepare('COMMIT').run()
  } catch (e) {
    db.prepare('ROLLBACK').run()
    throw e
  }
  if (sessionId) recordEvent(sessionId, 'snapshot.restore', { summary: `Restored site design from snapshot “${row.name}” (${new Date(row.created_at as number).toLocaleString()})`, detail: { snapshotId: id } })
}

/** Factory reset of the site design: defaults for settings and the builder, themes untouched. */
export function factoryResetDesign(sessionId: number | null): void {
  takeSnapshot(sessionId, 'Before factory reset', 'restore')
  setSetting('site', { ...DEFAULT_SETTINGS })
  setSetting('ui', { ...DEFAULT_UI })
  if (sessionId) recordEvent(sessionId, 'snapshot.restore', { summary: 'Site design reset to factory defaults' })
}

/* ---------- source workspace: files and git checkpoints ---------- */

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'xGallery Developer', GIT_AUTHOR_EMAIL: 'developer@xgallery', GIT_COMMITTER_NAME: 'xGallery Developer', GIT_COMMITTER_EMAIL: 'developer@xgallery' }

function git(args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync('git', args, { cwd: WORKSPACE, encoding: 'utf8', env: GIT_ENV, maxBuffer: 30 * 1024 * 1024 })
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' }
}

export function gitAvailable(): boolean {
  return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0
}

export function workspace(): string {
  return ensureWorkspace()
}

/** Resolve a developer-supplied path inside the workspace; escapes are a client error, not a crash. */
function safeRel(rel: string): string {
  try {
    return safePath(workspace(), rel)
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
}

export interface Checkpoint {
  sha: string
  at: number
  label: string
}

export function listCheckpoints(limit = 100): Checkpoint[] {
  workspace()
  if (!gitAvailable()) return []
  const r = git(['log', `--format=%h%x1f%ct%x1f%s`, `-n`, String(limit)])
  if (!r.ok) return []
  return r.out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, ct, label] = l.split('\x1f')
      return { sha, at: Number(ct) * 1000, label }
    })
}

/** Commit the workspace as it stands. Returns the new commit, or null when nothing changed. */
export function checkpoint(label: string, sessionId: number | null = null): Checkpoint | null {
  workspace()
  if (!gitAvailable()) return null
  git(['add', '-A'])
  const st = git(['status', '--porcelain'])
  if (!st.out.trim()) return null
  const c = git(['commit', '-q', '-m', label.slice(0, 200), '--no-verify'])
  if (!c.ok) return null
  const sha = git(['rev-parse', '--short', 'HEAD']).out.trim()
  if (sessionId) recordEvent(sessionId, 'checkpoint.create', { summary: `Checkpoint ${sha}: ${label}`, detail: { sha } })
  return { sha, at: now(), label }
}

export function headSha(): string {
  workspace()
  return gitAvailable() ? git(['rev-parse', '--short', 'HEAD']).out.trim() : ''
}

/** Put the workspace back the way it was at a checkpoint (as a new checkpoint, so nothing is lost). */
export function restoreCheckpoint(sha: string, sessionId: number | null): Checkpoint {
  workspace()
  if (!gitAvailable()) throw new HttpError(500, 'git is not available in this container')
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) throw new HttpError(400, 'Bad checkpoint id')
  if (!git(['cat-file', '-e', `${sha}^{commit}`]).ok) throw new HttpError(404, 'Checkpoint not found')
  checkpoint(`Before restoring ${sha}`, sessionId)
  const added = git(['diff', '--name-only', '--diff-filter=A', sha, 'HEAD']).out.split('\n').filter(Boolean)
  git(['checkout', '-q', sha, '--', '.'])
  for (const rel of added) {
    try {
      unlinkSync(safePath(WORKSPACE, rel))
    } catch {
      /* already gone */
    }
  }
  git(['add', '-A'])
  git(['commit', '-q', '--allow-empty', '-m', `Restore to ${sha}`, '--no-verify'])
  const head = headSha()
  if (sessionId) recordEvent(sessionId, 'checkpoint.restore', { summary: `Source workspace restored to checkpoint ${sha} (now ${head})`, detail: { sha, head } })
  return { sha: head, at: now(), label: `Restore to ${sha}` }
}

export interface ChangedFile {
  path: string
  status: string
  added: number
  removed: number
}

/** Files that differ from the pristine source snapshot (the first commit), with line counts. */
export function changesSinceSnapshot(): ChangedFile[] {
  workspace()
  if (!gitAvailable()) return []
  const root = rootSha()
  if (!root) return []
  return diffFiles(root, true)
}

/** Files that differ between a commit and the working tree (ref = HEAD for uncommitted work). */
export function diffFiles(ref: string, includeWorkingTree = true): ChangedFile[] {
  git(['add', '-A', '-N'])
  const names = git(['diff', '--name-status', ref]).out.split('\n').filter(Boolean)
  const stats = new Map<string, { added: number; removed: number }>()
  for (const l of git(['diff', '--numstat', ref]).out.split('\n').filter(Boolean)) {
    const [a, r, p] = l.split('\t')
    stats.set(p, { added: Number(a) || 0, removed: Number(r) || 0 })
  }
  void includeWorkingTree
  return names.map((l) => {
    const [status, p] = l.split('\t')
    return { path: p, status: status[0], ...(stats.get(p) ?? { added: 0, removed: 0 }) }
  })
}

export function fileDiff(ref: string, rel: string): string {
  workspace()
  if (!gitAvailable()) return ''
  git(['add', '-A', '-N'])
  return git(['diff', ref, '--', rel.replace(/^[/\\]+/, '')]).out.slice(0, 200_000)
}

export function fullDiff(ref = 'HEAD'): string {
  workspace()
  if (!gitAvailable()) return ''
  git(['add', '-A', '-N'])
  return git(['diff', ref]).out
}

export function rootSha(): string {
  workspace()
  return gitAvailable() ? git(['rev-list', '--max-parents=0', '--abbrev-commit', 'HEAD']).out.trim().split('\n')[0] ?? '' : ''
}

export function workspaceTree(): { path: string; size: number }[] {
  const root = workspace()
  return listFiles(root, '.', 8).map((l) => {
    const m = /^(.*) \((\d+)b\)$/.exec(l)
    return { path: m ? m[1] : l, size: m ? Number(m[2]) : 0 }
  })
}

export function readWorkspaceFile(rel: string): { path: string; contents: string; size: number; text: boolean } {
  const abs = safeRel(rel)
  if (!existsSync(abs) || statSync(abs).isDirectory()) throw new HttpError(404, `No such file: ${rel}`)
  const size = statSync(abs).size
  if (!isTextFile(abs)) return { path: rel, contents: '', size, text: false }
  if (size > 400_000) throw new HttpError(413, 'File too large to edit here')
  return { path: rel, contents: readFileSync(abs, 'utf8'), size, text: true }
}

function lineDelta(before: string, after: string): { added: number; removed: number } {
  const a = before.split('\n')
  const b = after.split('\n')
  const counts = new Map<string, number>()
  for (const l of a) counts.set(l, (counts.get(l) ?? 0) + 1)
  let common = 0
  for (const l of b) {
    const c = counts.get(l) ?? 0
    if (c > 0) {
      common++
      counts.set(l, c - 1)
    }
  }
  return { added: b.length - common, removed: a.length - common }
}

export function writeWorkspaceFile(rel: string, contents: string, sessionId: number): { path: string; created: boolean; added: number; removed: number; checkpoint: string | null } {
  const abs = safeRel(rel)
  if (!isTextFile(abs)) throw new HttpError(400, 'Only text files can be edited here')
  if (Buffer.byteLength(contents) > 1_000_000) throw new HttpError(413, 'File too large')
  const created = !existsSync(abs)
  const before = created ? '' : readFileSync(abs, 'utf8')
  const cp = checkpoint(`Before editing ${rel}`, sessionId)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, contents)
  const d = lineDelta(before, contents)
  recordEvent(sessionId, created ? 'file.create' : 'file.write', { path: rel, detail: { ...d, bytes: Buffer.byteLength(contents), checkpoint: cp?.sha ?? null }, summary: `${created ? 'Created' : 'Edited'} ${rel} (+${d.added} / −${d.removed} lines)` })
  return { path: rel, created, ...d, checkpoint: cp?.sha ?? null }
}

export function deleteWorkspaceFile(rel: string, sessionId: number): void {
  const abs = safeRel(rel)
  if (!existsSync(abs) || statSync(abs).isDirectory()) throw new HttpError(404, `No such file: ${rel}`)
  const lines = isTextFile(abs) ? readFileSync(abs, 'utf8').split('\n').length : 0
  checkpoint(`Before deleting ${rel}`, sessionId)
  unlinkSync(abs)
  recordEvent(sessionId, 'file.delete', { path: rel, detail: { removed: lines }, summary: `Deleted ${rel}` })
}

/** Restore one file to how it is in the pristine source snapshot. */
export function restoreWorkspaceFile(rel: string, sessionId: number): void {
  workspace()
  const root = rootSha()
  if (!root) throw new HttpError(500, 'No source snapshot to restore from')
  const abs = safeRel(rel)
  const before = existsSync(abs) && isTextFile(abs) ? readFileSync(abs, 'utf8') : ''
  checkpoint(`Before restoring ${rel}`, sessionId)
  const r = git(['checkout', '-q', root, '--', rel.replace(/^[/\\]+/, '')])
  if (!r.ok) {
    // The file did not exist in the snapshot: restoring means removing it.
    if (existsSync(abs)) unlinkSync(abs)
  }
  const after = existsSync(abs) && isTextFile(abs) ? readFileSync(abs, 'utf8') : ''
  const d = lineDelta(before, after)
  recordEvent(sessionId, 'file.restore', { path: rel, detail: d, summary: `Restored ${rel} from the source snapshot` })
}

export function resetWorkspaceAll(sessionId: number | null): void {
  ensureWorkspace(true)
  if (sessionId) recordEvent(sessionId, 'workspace.reset', { summary: `Source workspace re-seeded from snapshot ${sourceVersion()} (all edits discarded)` })
}

/** Changes the AI made during one turn: compared against the checkpoint taken before it. */
export function recordAiFileChanges(sessionId: number, beforeSha: string, prompt: string): ChangedFile[] {
  const files = beforeSha ? diffFiles(beforeSha) : []
  for (const f of files) recordEvent(sessionId, 'ai.file_change', { path: f.path, detail: { added: f.added, removed: f.removed, status: f.status }, summary: `AI ${f.status === 'A' ? 'created' : f.status === 'D' ? 'deleted' : 'edited'} ${f.path} (+${f.added} / −${f.removed})` })
  if (files.length) checkpoint(`AI: ${prompt.replace(/\s+/g, ' ').slice(0, 80)}`, sessionId)
  return files
}

export function devStatus(req: Request) {
  const s = devSettings()
  return {
    passwordSet: !!s.hash,
    passwordSetAt: s.setAt,
    sessionMinutes: s.sessionMinutes,
    unlocked: !!req.devSession,
    session: req.devSession ? sessionJson(req.devSession) : null,
    sourceVersion: sourceVersion(),
    sourceDir: SOURCE_DIR,
    git: gitAvailable(),
  }
}
