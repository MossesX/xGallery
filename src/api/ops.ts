import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface ShellProfile {
  id: string
  name: string
  host: string
  user: string
  port: number
  keyPath: string
  moshServer: string
  udpFrom: number
  udpTo: number
  predict: 'adaptive' | 'always' | 'never' | 'experimental'
  locale: string
  tmux: string
  sshOptions: string
  notes: string
}

export interface OpsProfile {
  host: string
  user: string
  port: number
  keyPath: string
  repo: string
  domain: string
  deployDir: string
  project: string
  composeFile: string
  container: string
  volume: string
  image: string
  backupDir: string
  coolifyUrl: string
  shell: { profiles: ShellProfile[]; defaultProfile: string; termuxSetup: boolean }
}

export function useOps(enabled = true) {
  return useQuery({ queryKey: ['dev-ops'], queryFn: () => api.get<{ ops: OpsProfile; defaults: OpsProfile }>('/api/dev/ops'), enabled })
}

export function useSaveOps() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (ops: OpsProfile) => api.put<{ ops: OpsProfile }>('/api/dev/ops', { ops }), onSuccess: (r) => qc.setQueryData(['dev-ops'], (old: { ops: OpsProfile; defaults: OpsProfile } | undefined) => (old ? { ...old, ops: r.ops } : old)) })
}
