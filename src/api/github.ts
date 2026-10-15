import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { api } from './client'

/** Client for the GitHub manager (/api/dev/github). Reads are keyed by path; writes invalidate by prefix. */
export const GH = '/api/dev/github'

export interface GhSettings {
  github: { hasToken: boolean; tokenSource: 'settings' | 'env' | 'none'; tokenHint: string; owner: string; repo: string; full: string; pollMinutes: number; notify: boolean; rate: Rate }
  webhookUrl: string
  snapshotVersion: number
}
export interface Rate { limit: number; remaining: number; reset: number; used: number }
export interface RunSummary { id: number; name: string; status: string; conclusion: string | null; branch: string; sha: string; event: string; created_at: string; updated_at: string; url: string; title: string; actor: string; run_number: number }
export interface GhEvent { id: number; ts: number; event: string; action: string; summary: string; actor: string; url: string; sha?: string }
export interface Overview {
  fetchedAt: number
  repo: { full_name: string; description: string; default_branch: string; private: boolean; stars: number; forks: number; open_issues: number; size: number; pushed_at: string; url: string; language: string; license: string; visibility: string } | null
  headSha: string
  headCommit: { sha: string; message: string; author: string; date: string } | null
  commits: { sha: string; message: string; author: string; date: string; url: string }[]
  runs: RunSummary[]
  pulls: { number: number; title: string; state: string; draft: boolean; author: string; head: string; base: string; updated_at: string; url: string }[]
  issues: { number: number; title: string; state: string; author: string; labels: string[]; comments: number; updated_at: string; url: string }[]
  release: { tag: string; name: string; published_at: string; url: string; prerelease: boolean; draft: boolean } | null
  branches: number
  live: { version: string; upToDate: boolean | null; deploying: boolean; lastDeploy: RunSummary | null }
  error: string | null
  events: GhEvent[]
  rate: Rate
  version: number
  webhookUrl: string
}
export interface Commit { sha: string; message: string; author: string; login: string; date: string; url: string; verified: boolean }
export interface FileDiff { filename: string; status: string; additions: number; deletions: number; patch: string }
export interface Pull { number: number; title: string; body: string; state: string; draft: boolean; merged: boolean; mergeable: boolean | null; mergeable_state: string; author: string; head: string; headSha: string; base: string; created_at: string; updated_at: string; merged_at: string | null; url: string; labels: string[]; comments: number; review_comments: number; commits: number; additions: number; deletions: number; changed_files: number; requested_reviewers: string[] }
export interface Issue { number: number; title: string; body: string; state: string; state_reason: string | null; author: string; labels: { name: string; color: string }[]; assignees: string[]; milestone: string | null; comments: number; created_at: string; updated_at: string; closed_at: string | null; url: string; isPull: boolean }
export interface Comment { id: number; author: string; body: string; created_at: string; url: string }
export interface Run { id: number; name: string; run_number: number; attempt: number; status: string; conclusion: string | null; branch: string; sha: string; event: string; title: string; actor: string; created_at: string; updated_at: string; run_started_at: string; url: string; workflow_id: number }
export interface Job { id: number; name: string; status: string; conclusion: string | null; started_at: string; completed_at: string | null; url: string; runner: string; steps: { name: string; status: string; conclusion: string | null; number: number; started_at: string; completed_at: string | null }[] }
export interface Release { id: number; tag: string; name: string; body: string; draft: boolean; prerelease: boolean; author: string; created_at: string; published_at: string | null; url: string; target: string; assets: { id: number; name: string; size: number; downloads: number; url: string }[] }

export function useGh<T>(path: string | null, opts: Partial<Pick<UseQueryOptions<T>, 'refetchInterval' | 'staleTime' | 'retry'>> & { enabled?: boolean } = {}) {
  return useQuery<T>({ queryKey: ['gh', path], queryFn: () => api.get<T>(`${GH}${path}`), enabled: path != null && opts.enabled !== false, retry: opts.retry ?? false, refetchInterval: opts.refetchInterval, staleTime: opts.staleTime ?? 15_000 })
}
export const useGhSettings = () => useGh<GhSettings>('/settings', { staleTime: 60_000 })

export interface GhCall { method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: unknown; invalidate?: string[] }
export function useGhCall<T = Record<string, unknown>>() {
  const qc = useQueryClient()
  return useMutation<T, Error, GhCall>({
    mutationFn: ({ method = 'POST', path, body }) => {
      const url = `${GH}${path}`
      if (method === 'POST') return api.post<T>(url, body)
      if (method === 'PUT') return api.put<T>(url, body)
      if (method === 'DELETE') return api.del<T>(url, body)
      return api.patch<T>(url, body)
    },
    onSuccess: (_r, v) => {
      for (const p of v.invalidate ?? ['/overview']) qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'gh' && typeof q.queryKey[1] === 'string' && q.queryKey[1].startsWith(p) })
    },
  })
}
export function useInvalidateGh() {
  const qc = useQueryClient()
  return (prefix = '') => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'gh' && (prefix === '' || (typeof q.queryKey[1] === 'string' && q.queryKey[1].startsWith(prefix))) })
}

export const ago = (iso: string | number | null | undefined) => {
  if (!iso) return ''
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  const d = Date.now() - t
  if (d < 60_000) return 'just now'
  if (d < 3600_000) return `${Math.round(d / 60_000)} min ago`
  if (d < 86400_000) return `${Math.round(d / 3600_000)} h ago`
  if (d < 30 * 86400_000) return `${Math.round(d / 86400_000)} d ago`
  return new Date(t).toLocaleDateString()
}
export const short = (sha: string) => (sha ?? '').slice(0, 7)
