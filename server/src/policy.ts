import { db, getSetting, setSetting } from './db.js'

/**
 * Layered policy: site defaults ← groups (by priority, highest last) ← per-account overrides.
 * Every layer stores only the keys it sets; `null`/missing means "inherit".
 */

export interface Perms {
  canUpload: boolean
  canPublish: boolean
  canComment: boolean
  canReact: boolean
  canMessage: boolean
  canBuddies: boolean
  canShareLinks: boolean
  canCreateGalleries: boolean
  canChangeProfile: boolean
  canDownload: boolean
  canUseAssistant: boolean
}

export interface Limits {
  maxGalleries: number
  maxAlbums: number
  maxMediaPerAlbum: number
  maxUploadMb: number
  storageQuotaMb: number
  maxPrivateLinks: number
  messagesPerHour: number
}

export const PERM_KEYS: (keyof Perms)[] = ['canUpload', 'canPublish', 'canComment', 'canReact', 'canMessage', 'canBuddies', 'canShareLinks', 'canCreateGalleries', 'canChangeProfile', 'canDownload', 'canUseAssistant']
export const LIMIT_KEYS: (keyof Limits)[] = ['maxGalleries', 'maxAlbums', 'maxMediaPerAlbum', 'maxUploadMb', 'storageQuotaMb', 'maxPrivateLinks', 'messagesPerHour']

export const PERM_LABELS: Record<keyof Perms, string> = {
  canUpload: 'create albums and upload media',
  canPublish: 'make albums public',
  canComment: 'comment',
  canReact: 'like, react and save albums',
  canMessage: 'send private messages',
  canBuddies: 'send buddy requests',
  canShareLinks: 'create private links',
  canCreateGalleries: 'create extra galleries',
  canChangeProfile: 'change their own profile and picture',
  canDownload: 'download originals',
  canUseAssistant: 'use the AI assistant',
}

export const LIMIT_LABELS: Record<keyof Limits, string> = {
  maxGalleries: 'galleries per account',
  maxAlbums: 'albums per account (0 = unlimited)',
  maxMediaPerAlbum: 'items per album (0 = unlimited)',
  maxUploadMb: 'largest single upload, MB',
  storageQuotaMb: 'total storage per account, MB (0 = unlimited)',
  maxPrivateLinks: 'private links per album (0 = unlimited)',
  messagesPerHour: 'private messages per hour (0 = unlimited)',
}

export interface SitePolicy {
  perms: Perms
  limits: Limits
  /** Who may message whom. */
  messaging: 'anyone' | 'buddies' | 'off'
  /** New accounts must change their password on first sign-in. */
  forcePasswordChange: boolean
  minPasswordLength: number
  /** Accept account requests from visitors. */
  acceptRequests: boolean
  /** Allowed upload MIME prefixes/types. */
  allowedTypes: string[]
  /** Comments from members are held until the album owner approves. */
  moderateComments: boolean
  /** Visitors (no login) may view public albums. */
  publicBrowsing: boolean
  /** Login throttle: attempts per 15 minutes per IP and per username. */
  loginAttempts: number
  sessionDays: number
  /** Default visibility for new albums. */
  defaultVisibility: 'draft' | 'published' | 'public'
  /** New members are added to these groups. */
  defaultGroupIds: number[]
}

export const DEFAULT_POLICY: SitePolicy = {
  perms: { canUpload: true, canPublish: true, canComment: true, canReact: true, canMessage: true, canBuddies: true, canShareLinks: true, canCreateGalleries: true, canChangeProfile: true, canDownload: true, canUseAssistant: false },
  limits: { maxGalleries: 1, maxAlbums: 0, maxMediaPerAlbum: 0, maxUploadMb: 2048, storageQuotaMb: 0, maxPrivateLinks: 0, messagesPerHour: 0 },
  messaging: 'anyone',
  forcePasswordChange: true,
  minPasswordLength: 8,
  acceptRequests: true,
  allowedTypes: ['image/', 'video/'],
  moderateComments: false,
  publicBrowsing: true,
  loginAttempts: 10,
  sessionDays: 30,
  defaultVisibility: 'draft',
  defaultGroupIds: [],
}

export function getPolicy(): SitePolicy {
  const saved = getSetting<Partial<SitePolicy>>('policy', {})
  return { ...DEFAULT_POLICY, ...saved, perms: { ...DEFAULT_POLICY.perms, ...(saved.perms ?? {}) }, limits: { ...DEFAULT_POLICY.limits, ...(saved.limits ?? {}) } }
}

export function savePolicy(patch: Partial<SitePolicy>): SitePolicy {
  const cur = getPolicy()
  const next: SitePolicy = { ...cur }
  if (patch.perms) for (const k of PERM_KEYS) if (typeof patch.perms[k] === 'boolean') next.perms = { ...next.perms, [k]: patch.perms[k] }
  if (patch.limits) for (const k of LIMIT_KEYS) if (typeof patch.limits[k] === 'number' && Number.isFinite(patch.limits[k])) next.limits = { ...next.limits, [k]: Math.max(0, Math.floor(patch.limits[k] as number)) }
  if (patch.messaging === 'anyone' || patch.messaging === 'buddies' || patch.messaging === 'off') next.messaging = patch.messaging
  if (typeof patch.forcePasswordChange === 'boolean') next.forcePasswordChange = patch.forcePasswordChange
  if (typeof patch.minPasswordLength === 'number') next.minPasswordLength = Math.min(64, Math.max(6, Math.floor(patch.minPasswordLength)))
  if (typeof patch.acceptRequests === 'boolean') next.acceptRequests = patch.acceptRequests
  if (Array.isArray(patch.allowedTypes)) next.allowedTypes = patch.allowedTypes.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 40)
  if (typeof patch.moderateComments === 'boolean') next.moderateComments = patch.moderateComments
  if (typeof patch.publicBrowsing === 'boolean') next.publicBrowsing = patch.publicBrowsing
  if (typeof patch.loginAttempts === 'number') next.loginAttempts = Math.min(1000, Math.max(3, Math.floor(patch.loginAttempts)))
  if (typeof patch.sessionDays === 'number') next.sessionDays = Math.min(365, Math.max(1, Math.floor(patch.sessionDays)))
  if (patch.defaultVisibility === 'draft' || patch.defaultVisibility === 'published' || patch.defaultVisibility === 'public') next.defaultVisibility = patch.defaultVisibility
  if (Array.isArray(patch.defaultGroupIds)) next.defaultGroupIds = patch.defaultGroupIds.map(Number).filter((n) => Number.isFinite(n))
  setSetting('policy', next)
  return next
}

/** Parse a stored override object: only keys explicitly set to a boolean/number survive. */
export function parsePermOverrides(v: unknown): Partial<Perms> {
  let o: Record<string, unknown> = {}
  if (typeof v === 'string') {
    try {
      o = JSON.parse(v) as Record<string, unknown>
    } catch {
      o = {}
    }
  } else if (v && typeof v === 'object') o = v as Record<string, unknown>
  const out: Partial<Perms> = {}
  for (const k of PERM_KEYS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean
  return out
}

export function parseLimitOverrides(v: unknown): Partial<Limits> {
  let o: Record<string, unknown> = {}
  if (typeof v === 'string') {
    try {
      o = JSON.parse(v) as Record<string, unknown>
    } catch {
      o = {}
    }
  } else if (v && typeof v === 'object') o = v as Record<string, unknown>
  const out: Partial<Limits> = {}
  for (const k of LIMIT_KEYS) if (typeof o[k] === 'number' && Number.isFinite(o[k])) out[k] = Math.max(0, Math.floor(o[k] as number))
  return out
}

export interface GroupRow {
  id: number
  name: string
  description: string
  perms: string
  limits: string
  priority: number
  created_at: number
}

export function groupsOf(userId: number): GroupRow[] {
  return db.prepare('SELECT g.* FROM groups g JOIN group_members m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY g.priority, g.id').all(userId) as unknown as GroupRow[]
}

export interface Effective {
  perms: Perms
  limits: Limits
  /** Where each value came from, for the owner's UI. */
  permSources: Record<keyof Perms, 'default' | 'group' | 'user'>
  limitSources: Record<keyof Limits, 'default' | 'group' | 'user'>
  groups: { id: number; name: string }[]
}

/** Resolve the effective permissions and limits for an account. The owner has everything. */
export function resolveEffective(userRow: { id: number; role: string; perms?: unknown; limits?: unknown; ai_enabled?: unknown }): Effective {
  const policy = getPolicy()
  const perms: Perms = { ...policy.perms }
  const limits: Limits = { ...policy.limits }
  const permSources = Object.fromEntries(PERM_KEYS.map((k) => [k, 'default'])) as Record<keyof Perms, 'default' | 'group' | 'user'>
  const limitSources = Object.fromEntries(LIMIT_KEYS.map((k) => [k, 'default'])) as Record<keyof Limits, 'default' | 'group' | 'user'>
  const groups = groupsOf(userRow.id)
  for (const g of groups) {
    const gp = parsePermOverrides(g.perms)
    for (const k of Object.keys(gp) as (keyof Perms)[]) {
      perms[k] = gp[k] as boolean
      permSources[k] = 'group'
    }
    const gl = parseLimitOverrides(g.limits)
    for (const k of Object.keys(gl) as (keyof Limits)[]) {
      limits[k] = gl[k] as number
      limitSources[k] = 'group'
    }
  }
  const up = parsePermOverrides(userRow.perms)
  for (const k of Object.keys(up) as (keyof Perms)[]) {
    perms[k] = up[k] as boolean
    permSources[k] = 'user'
  }
  // Legacy per-account assistant flag counts as an explicit "allow".
  if (userRow.ai_enabled && up.canUseAssistant === undefined) {
    perms.canUseAssistant = true
    permSources.canUseAssistant = 'user'
  }
  const ul = parseLimitOverrides(userRow.limits)
  for (const k of Object.keys(ul) as (keyof Limits)[]) {
    limits[k] = ul[k] as number
    limitSources[k] = 'user'
  }
  if (userRow.role === 'owner') {
    for (const k of PERM_KEYS) perms[k] = true
    for (const k of LIMIT_KEYS) limits[k] = k === 'maxUploadMb' ? Math.max(limits[k], 4096) : 0
  }
  return { perms, limits, permSources, limitSources, groups: groups.map((g) => ({ id: g.id, name: g.name })) }
}
