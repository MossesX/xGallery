import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { api } from './client'

/** Client for the VPS manager (/api/dev/vps). Every read is keyed by its path so tabs can invalidate each other. */
export const VPS = '/api/dev/vps'

export interface VpsSettings {
  hostinger: { hasToken: boolean; tokenSource: 'settings' | 'env' | 'none'; tokenHint: string; vmId: number | null; domain: string; firewallId: number | null; profileId: string }
  profiles: { id: string; name: string; host: string; user: string; port: number }[]
  defaultProfile: string
  sitesDir: string
  exportDir: string
}

export interface ExecOut {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  ms: number
}

export interface SystemInfo {
  host: string[]
  uptime: string
  load: number[]
  cpu: { cores: number; model: string }
  mem: { totalMb: number; usedMb: number; availableMb: number; swapTotalMb: number; swapUsedMb: number }
  disks: { mount: string; sizeKb: number; usedKb: number; availKb: number; pct: number }[]
  docker: { version: string; running: number; total: number }
  ufw: string
  fail2ban: string
  updates: number
  rebootRequired: boolean
  ports: { proto: string; addr: string; proc: string }[]
  top: string[]
  tools: Record<string, string>
  tz: string[]
  ip: string
}

export interface Container {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string
  created: string
  size: string
  project: string
  service: string
  host: string
  cpu: string
  mem: string
  memPct: string
  net: string
  block: string
  pids: string
}

export interface ContainerTest {
  id: string
  name: string
  image: string
  state: string
  startedAt: string
  ok: boolean
  checks: { name: string; ok: boolean; detail: string }[]
}

export interface Site {
  sub: string
  domain: string
  kind: 'static' | 'proxy' | 'image'
  image?: string
  port?: number
  target?: number
  createdAt: number
  dir: string
  host: string
  container: { state: string; status: string } | null
}

export interface FileEntry {
  name: string
  type: 'dir' | 'file' | 'link'
  size: number
  mtime: number
  mode: string
}

export interface DnsZoneRecord {
  name: string
  type: string
  ttl: number
  records: { content: string; is_disabled?: boolean }[]
}

export const withProfile = (path: string, profile: string) => (profile ? `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}` : path)

/** A GET on the VPS manager; `path` starts with "/" and may carry a query string. */
export function useVps<T>(path: string | null, opts: Partial<Pick<UseQueryOptions<T>, 'refetchInterval' | 'staleTime' | 'retry'>> & { enabled?: boolean } = {}) {
  return useQuery<T>({ queryKey: ['vps', path], queryFn: () => api.get<T>(`${VPS}${path}`), enabled: path != null && opts.enabled !== false, retry: opts.retry ?? false, refetchInterval: opts.refetchInterval, staleTime: opts.staleTime ?? 10_000 })
}

export function useVpsSettings() {
  return useVps<VpsSettings>('/settings', { staleTime: 60_000 })
}

export interface VpsCall {
  method?: 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  /** Query paths (prefixes) to refetch afterwards. */
  invalidate?: string[]
}

/** One mutation for every VPS action: {method, path, body}. Invalidates the given query prefixes on success. */
export function useVpsCall<T = ExecOut>() {
  const qc = useQueryClient()
  return useMutation<T, Error, VpsCall>({
    mutationFn: ({ method = 'POST', path, body }) => (method === 'POST' ? api.post<T>(`${VPS}${path}`, body) : method === 'PUT' ? api.put<T>(`${VPS}${path}`, body) : api.del<T>(`${VPS}${path}`, body)),
    onSuccess: (_r, v) => {
      for (const p of v.invalidate ?? []) qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'vps' && typeof q.queryKey[1] === 'string' && q.queryKey[1].startsWith(p) })
    },
  })
}

export function useInvalidateVps() {
  const qc = useQueryClient()
  return (prefix = '') => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'vps' && (prefix === '' || (typeof q.queryKey[1] === 'string' && q.queryKey[1].startsWith(prefix))) })
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`)
export const fmtKb = (kb: number) => fmtBytes(kb * 1024)
export const fmtMb = (mb: number) => fmtBytes(mb * 1024 * 1024)
