import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

/* ---------- types mirrored from server/src/dev.ts ---------- */

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
  toolbar: { clock: boolean; search: boolean; bell: boolean; newAlbums: boolean; adminBell: boolean; settings: boolean; assistant: boolean; colorMode: boolean; signOut: boolean; buttons: UiLink[] }
  footer: { text: string; links: UiLink[]; poweredBy: boolean }
  home: { sections: UiSection[] }
  contextMenu: { openAlbum: boolean; togglePublic: boolean; privateLink: boolean; askSelection: boolean; askElement: boolean; explainPage: boolean; openAssistant: boolean; settings: boolean; copySelection: boolean; openLink: boolean; copyPageLink: boolean; custom: UiLink[] }
  css: string
  flags: Record<string, boolean>
  banner: { brand: 'amberx' | 'text'; accent: string; sticky: boolean; dense: boolean; showProduct: boolean }
  layout: { density: 'comfortable' | 'compact'; fontScale: number; radius: number | null; maxWidth: number }
}

export interface DevSessionInfo {
  id: number
  userId: number
  startedAt: number
  lastActiveAt: number
  endedAt: number | null
  endReason: string
  ip: string
  userAgent: string
  summary: string
  summarySource: string
  changes: number
  events: number
  files: number
  open: boolean
}

export interface DevStatus {
  passwordSet: boolean
  passwordSetAt: number | null
  sessionMinutes: number
  unlocked: boolean
  session: DevSessionInfo | null
  sourceVersion: string
  sourceDir: string
  git: boolean
}

export interface DevEvent {
  id: number
  sessionId: number
  ts: number
  kind: string
  path: string
  detail: Record<string, unknown>
  summary: string
}

export interface DevSnapshot {
  id: number
  sessionId: number | null
  createdAt: number
  name: string
  kind: 'auto' | 'manual' | 'restore'
  themes: number
  activeThemeId: number | null
  siteTitle: string
  bytes: number
}

export interface Checkpoint {
  sha: string
  at: number
  label: string
}

export interface ChangedFile {
  path: string
  status: string
  added: number
  removed: number
}

export interface DevOverview {
  status: DevStatus
  counts: { sessions: number; events: number; snapshots: number; themes: number }
  recentSessions: DevSessionInfo[]
  workspace: { head: string; root: string; changedFiles: number; added: number; removed: number; checkpoints: number }
  ai: { subscription: boolean; api: boolean; model: string; assistantName: string; chatCodeChanges: boolean }
  site: { title: string }
}

/* ---------- hooks ---------- */

export const devKeys = {
  status: ['dev-status'] as const,
  overview: ['dev-overview'] as const,
  sessions: ['dev-sessions'] as const,
  session: (id: number | null) => ['dev-session', id] as const,
  events: (p: Record<string, string>) => ['dev-events', p] as const,
  ui: ['dev-ui'] as const,
  snapshots: ['dev-snapshots'] as const,
  checkpoints: ['dev-checkpoints'] as const,
  changes: ['dev-changes'] as const,
  files: ['dev-files'] as const,
  file: (path: string | null) => ['dev-file', path] as const,
}

export function useDevStatus(enabled = true) {
  return useQuery({ queryKey: devKeys.status, queryFn: () => api.get<DevStatus>('/api/dev/status'), enabled, staleTime: 15_000 })
}

export function useDevOverview(enabled = true) {
  return useQuery({ queryKey: devKeys.overview, queryFn: () => api.get<DevOverview>('/api/dev/overview'), enabled })
}

export function useDevSessions(enabled = true) {
  return useQuery({ queryKey: devKeys.sessions, queryFn: () => api.get<{ sessions: DevSessionInfo[] }>('/api/dev/sessions?limit=100').then((r) => r.sessions), enabled })
}

export function useDevSession(id: number | null) {
  return useQuery({ queryKey: devKeys.session(id), queryFn: () => api.get<{ session: DevSessionInfo; events: DevEvent[]; liveSummary: string }>(`/api/dev/sessions/${id}`), enabled: id != null })
}

export function useDevEvents(p: { kind?: string; q?: string; sessionId?: string; limit?: string } = {}, enabled = true) {
  const params = Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Record<string, string>
  const qs = new URLSearchParams(params).toString()
  return useQuery({ queryKey: devKeys.events(params), queryFn: () => api.get<{ events: DevEvent[]; kinds: string[]; nextBefore: number | null }>(`/api/dev/events${qs ? `?${qs}` : ''}`), enabled, placeholderData: (prev) => prev })
}

export function useDevUi(enabled = true) {
  return useQuery({ queryKey: devKeys.ui, queryFn: () => api.get<{ ui: UiConfig; defaults: UiConfig; flagLabels: Record<string, string> }>('/api/dev/ui'), enabled })
}

export function useSaveUi() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { ui: Partial<UiConfig>; label?: string }) => api.put<{ ui: UiConfig }>('/api/dev/ui', v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devKeys.ui })
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: devKeys.snapshots })
      qc.invalidateQueries({ queryKey: devKeys.overview })
    },
  })
}

export function useSnapshots(enabled = true) {
  return useQuery({ queryKey: devKeys.snapshots, queryFn: () => api.get<{ snapshots: DevSnapshot[] }>('/api/dev/snapshots').then((r) => r.snapshots), enabled })
}

export function useCheckpoints(enabled = true) {
  return useQuery({ queryKey: devKeys.checkpoints, queryFn: () => api.get<{ checkpoints: Checkpoint[]; head: string; root: string }>('/api/dev/checkpoints'), enabled })
}

export function useChanges(enabled = true) {
  return useQuery({ queryKey: devKeys.changes, queryFn: () => api.get<{ files: ChangedFile[]; head: string; root: string; sourceVersion: string }>('/api/dev/changes'), enabled })
}

export function useDevFiles(enabled = true) {
  return useQuery({ queryKey: devKeys.files, queryFn: () => api.get<{ files: { path: string; size: number }[]; head: string; sourceVersion: string }>('/api/dev/files'), enabled, staleTime: 30_000 })
}

export function useDevFile(path: string | null) {
  return useQuery({ queryKey: devKeys.file(path), queryFn: () => api.get<{ file: { path: string; contents: string; size: number; text: boolean }; diff: string }>(`/api/dev/file?path=${encodeURIComponent(path!)}`), enabled: !!path })
}

/** Invalidate everything the workspace pages show after a change to the source copy. */
export function useInvalidateWorkspace() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: devKeys.changes })
    qc.invalidateQueries({ queryKey: devKeys.checkpoints })
    qc.invalidateQueries({ queryKey: devKeys.files })
    qc.invalidateQueries({ queryKey: ['dev-file'] })
    qc.invalidateQueries({ queryKey: devKeys.overview })
    qc.invalidateQueries({ queryKey: devKeys.status })
    qc.invalidateQueries({ queryKey: devKeys.sessions })
  }
}

export const KIND_LABELS: Record<string, string> = {
  'session.unlock': 'Session opened',
  'session.end': 'Session ended',
  'session.summarize': 'AI summary',
  'settings.save': 'Developer settings',
  'settings.password': 'Password changed',
  'file.write': 'File edited',
  'file.create': 'File created',
  'file.delete': 'File deleted',
  'file.restore': 'File restored',
  'ai.turn': 'AI turn',
  'ai.file_change': 'AI changed file',
  'config.save': 'Design saved',
  'theme.save': 'Theme saved',
  'theme.delete': 'Theme deleted',
  'theme.activate': 'Theme activated',
  'snapshot.create': 'Snapshot',
  'snapshot.restore': 'Design restored',
  'checkpoint.create': 'Checkpoint',
  'checkpoint.restore': 'Code restored',
  'workspace.reset': 'Workspace reset',
  'workspace.export': 'Patch exported',
}
