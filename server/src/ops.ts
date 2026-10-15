import { getSetting, setSetting } from './db.js'

/**
 * Operations profile for the developer panel's command wizard and remote-shell tab.
 * Only non-secret connection facts live here (host, user, paths, repo); passwords, tokens and
 * keys are typed in the browser and never sent to the server.
 */

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

export const DEFAULT_OPS: OpsProfile = {
  host: '31.97.13.252',
  user: 'root',
  port: 22,
  keyPath: '~/.ssh/xgallery_deploy',
  repo: 'MossesX/xGallery',
  domain: 'xgallery.amberxai.com',
  deployDir: '/opt/xgallery',
  project: 'xgallery',
  composeFile: 'docker-compose.traefik.yml',
  container: 'xgallery-app',
  volume: 'xgallery_data',
  image: 'ghcr.io/mossesx/xgallery',
  backupDir: '/root/backups',
  coolifyUrl: '',
  shell: {
    profiles: [{ id: 'vps', name: 'xGallery VPS', host: '31.97.13.252', user: 'root', port: 22, keyPath: '~/.ssh/xgallery_deploy', moshServer: '/usr/bin/mosh-server', udpFrom: 60000, udpTo: 61000, predict: 'adaptive', locale: 'en_US.UTF-8', tmux: 'main', sshOptions: '', notes: '' }],
    defaultProfile: 'vps',
    termuxSetup: true,
  },
}

const s = (v: unknown, fallback: string, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) || fallback : fallback)
const n = (v: unknown, fallback: number, min: number, max: number) => {
  const x = Number(v)
  return Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : fallback
}
const HOST_RE = /^[a-z0-9.-]+$/i
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/i

export function sanitizeOps(input: unknown): OpsProfile {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const d = DEFAULT_OPS
  const shell = (o.shell && typeof o.shell === 'object' ? o.shell : {}) as Record<string, unknown>
  const profiles: ShellProfile[] = []
  const seen = new Set<string>()
  for (const raw of (Array.isArray(shell.profiles) ? shell.profiles : d.shell.profiles).slice(0, 20)) {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    let id = s(p.id, '', 40).replace(/[^a-z0-9_-]/gi, '') || `p${profiles.length + 1}`
    while (seen.has(id)) id += '2'
    seen.add(id)
    const host = s(p.host, d.host, 253)
    const user = s(p.user, d.user, 32)
    profiles.push({
      id,
      name: s(p.name, 'Server', 60),
      host: HOST_RE.test(host) ? host : d.host,
      user: USER_RE.test(user) ? user : d.user,
      port: n(p.port, 22, 1, 65535),
      keyPath: s(p.keyPath, '', 300),
      moshServer: s(p.moshServer, '/usr/bin/mosh-server', 300),
      udpFrom: n(p.udpFrom, 60000, 1024, 65535),
      udpTo: n(p.udpTo, 61000, 1024, 65535),
      predict: ['adaptive', 'always', 'never', 'experimental'].includes(String(p.predict)) ? (p.predict as ShellProfile['predict']) : 'adaptive',
      locale: s(p.locale, 'en_US.UTF-8', 40),
      tmux: s(p.tmux, '', 40).replace(/[^a-z0-9_-]/gi, ''),
      sshOptions: s(p.sshOptions, '', 300),
      notes: s(p.notes, '', 500),
    })
  }
  const host = s(o.host, d.host, 253)
  const user = s(o.user, d.user, 32)
  return {
    host: HOST_RE.test(host) ? host : d.host,
    user: USER_RE.test(user) ? user : d.user,
    port: n(o.port, d.port, 1, 65535),
    keyPath: s(o.keyPath, d.keyPath, 300),
    repo: /^[\w.-]+\/[\w.-]+$/.test(s(o.repo, d.repo, 120)) ? s(o.repo, d.repo, 120) : d.repo,
    domain: HOST_RE.test(s(o.domain, d.domain, 253)) ? s(o.domain, d.domain, 253) : d.domain,
    deployDir: s(o.deployDir, d.deployDir, 300),
    project: s(o.project, d.project, 60).replace(/[^a-z0-9_-]/gi, '') || d.project,
    composeFile: s(o.composeFile, d.composeFile, 120),
    container: s(o.container, d.container, 80).replace(/[^a-z0-9_.-]/gi, '') || d.container,
    volume: s(o.volume, d.volume, 80).replace(/[^a-z0-9_.-]/gi, '') || d.volume,
    image: s(o.image, d.image, 200),
    backupDir: s(o.backupDir, d.backupDir, 300),
    coolifyUrl: s(o.coolifyUrl, '', 300),
    shell: { profiles: profiles.length ? profiles : d.shell.profiles, defaultProfile: s(shell.defaultProfile, profiles[0]?.id ?? 'vps', 40), termuxSetup: shell.termuxSetup !== false },
  }
}

export function getOps(): OpsProfile {
  return sanitizeOps(getSetting<unknown>('devOps', {}))
}

export function saveOps(input: unknown): OpsProfile {
  const v = sanitizeOps(input)
  setSetting('devOps', v)
  return v
}
