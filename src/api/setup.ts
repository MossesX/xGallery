import { useQuery } from '@tanstack/react-query'
import { api } from './client'

/** Client for the one-click setup (/api/dev/setup): what is configured, and the steps the wizard runs. */
export const SETUP = '/api/dev/setup'

export interface VpsProbe {
  reachable: boolean
  user: string
  host: string
  mosh: boolean
  claude: boolean
  node: string | null
  docker: boolean
  containers: number
  ufw: string
  udpOpen: boolean
  authorizedKeys: number
  phoneKeyInstalled: boolean | null
  termuxKeyInstalled: boolean | null
  privilege: string
}

export interface SetupStatus {
  panelKey: boolean
  panelPublicKey: string
  profile: { id: string; name: string; host: string; user: string; port: number }
  domain: string
  hostinger: boolean
  hostingerVm: boolean
  github: boolean
  githubRepo: string
  claudeToken: boolean
  termuxKey: { enrolledAt: number; installed: boolean; fingerprint: string } | null
  completedAt: number | null
  vps: VpsProbe | null
  vpsError: string | null
}

export interface StepResult {
  ok: boolean
  code?: number | null
  out?: string
  installed?: string[]
  keys?: string[]
  publicKey?: string
  created?: boolean
}

export const setupKeys = { status: (phonePub: string) => ['dev-setup-status', phonePub] as const }

/** The server's view of the setup; `phonePub` lets the probe check whether this phone's key is on the VPS. */
export function useSetupStatus(enabled: boolean, phonePub = '', refetchInterval?: number | false) {
  return useQuery({
    queryKey: setupKeys.status(phonePub),
    queryFn: () => api.get<SetupStatus>(`${SETUP}/status${phonePub ? `?phonePub=${encodeURIComponent(phonePub)}` : ''}`),
    enabled,
    staleTime: 20_000,
    retry: false,
    refetchInterval,
  })
}

export const setupApi = {
  status: (phonePub = '') => api.get<SetupStatus>(`${SETUP}/status${phonePub ? `?phonePub=${encodeURIComponent(phonePub)}` : ''}`),
  run: (body: { step: string; profile?: string; password?: string; phonePub?: string; timeout?: number }) => api.post<StepResult>(`${SETUP}/run`, body),
  enrol: (body: { origin?: string; profile?: string }) => api.post<{ token: string; script: string; expiresAt: number }>(`${SETUP}/enrol`, body),
  complete: () => api.post<{ ok: boolean }>(`${SETUP}/complete`, {}),
  forgetTermux: () => api.del<{ ok: boolean }>(`${SETUP}/termux-key`),
}

/** The phone's public key when the page runs inside the Android app (empty elsewhere). */
export function phonePublicKey(): string {
  try {
    const b = window.NativeSsh
    if (!b || !b.hasStoredKey()) return ''
    return (b.publicKey() || '').trim()
  } catch {
    return ''
  }
}
