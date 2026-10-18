import { useQuery } from '@tanstack/react-query'
import { api } from './client'

/** Client for the new-project wizard (/api/dev/new-project). */
export const NEW_PROJECT = '/api/dev/new-project'

export type NpStepId = 'generate' | 'repo' | 'secrets' | 'dns' | 'claude-app' | 'push-main' | 'deploy-site' | 'push-panel' | 'deploy-panel' | 'finish'

export interface NpProject {
  slug: string
  name: string
  domain: string
  repo: string
  purpose: string
  private: boolean
  createdAt: number
  updatedAt: number
  steps: Partial<Record<NpStepId, { ok: boolean; at: number; note: string }>>
  sha?: string
  repoUrl?: string
}

export interface NpStatus {
  github: { hasToken: boolean; login: string; scopes: string[] | null; error: string | null }
  hostinger: { hasToken: boolean; zone: string }
  vps: { host: string; user: string; panelKey: boolean }
  source: string
  claudeAppUrl: string
  steps: NpStepId[]
  projects: NpProject[]
}

export interface NpDraft { name: string; slug?: string; domain?: string; repo?: string; purpose?: string; private?: boolean }

export interface NpCheck {
  plan: Required<NpDraft>
  problems: string[]
  warnings: string[]
  repo: 'free' | 'empty' | 'exists' | 'unknown'
  dnsManaged: boolean
  zone: string
}

export interface NpResult {
  ok: boolean
  note?: string
  out?: string
  project: NpProject | null
  needs?: { kind: 'password' | 'link' | 'confirm-dns'; message: string; url?: string }
  adminPassword?: string
  run?: { id: number; status: string; conclusion: string | null; url: string } | null
  health?: number
  firstSession?: string
}

export function useNewProjectStatus() {
  return useQuery({ queryKey: ['dev-new-project'], queryFn: () => api.get<NpStatus>(`${NEW_PROJECT}/status`), staleTime: 15_000, retry: false })
}

export const newProjectApi = {
  check: (d: NpDraft) => api.post<NpCheck>(`${NEW_PROJECT}/check`, d),
  run: (step: NpStepId, body: Record<string, unknown>) => api.post<NpResult>(`${NEW_PROJECT}/run`, { ...body, step }),
  forget: (slug: string) => api.del<{ ok: boolean }>(`${NEW_PROJECT}/projects/${slug}`),
  removeFiles: (slug: string) => api.del<{ ok: boolean }>(`${NEW_PROJECT}/projects/${slug}/files`),
}
