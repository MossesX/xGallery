import type { Server } from 'node:http'
import { createHash } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import ssh2 from 'ssh2'
import type { Client as SshClient } from 'ssh2'

const { Client, utils } = ssh2
import { db, getSetting, now, setSetting } from './db.js'
import { COOKIE, parseCookies } from './auth.js'
import { devSessionForToken, recordEvent } from './dev.js'
import { logActivity } from './activity.js'
import { getOps } from './ops.js'

/**
 * A real SSH terminal for the developer panel.
 *
 * The browser (or the Android app's web view) opens a WebSocket at /api/dev/terminal/ws; the
 * server opens an SSH shell to the chosen profile's host with the stored panel key or a
 * password typed for that session only, and relays bytes both ways. Host keys are trusted on
 * first use and pinned afterwards. Only the owner with an unlocked developer session can connect,
 * and every connection is logged on that session.
 */

interface SshConfig {
  privateKey: string
  passphrase: string
  publicKey: string
  createdAt: number | null
  knownHosts: Record<string, string>
}

const DEFAULT_SSH: SshConfig = { privateKey: '', passphrase: '', publicKey: '', createdAt: null, knownHosts: {} }

export function getSshConfig(): SshConfig {
  return { ...DEFAULT_SSH, ...getSetting<Partial<SshConfig>>('devSsh', {}) }
}

export function publicSshConfig() {
  const c = getSshConfig()
  return { hasKey: !!c.privateKey, publicKey: c.publicKey, createdAt: c.createdAt, fingerprint: c.publicKey ? fingerprintOfPublicKey(c.publicKey) : '', knownHosts: c.knownHosts }
}

function fingerprintOfPublicKey(pub: string): string {
  try {
    const parsed = utils.parseKey(pub)
    if (parsed instanceof Error || Array.isArray(parsed)) return ''
    return 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
  } catch {
    return ''
  }
}

/** Store a pasted private key (validated), deriving its public half. */
export function saveSshKey(privateKey: string, passphrase: string): ReturnType<typeof publicSshConfig> {
  const parsed = utils.parseKey(privateKey, passphrase || undefined)
  if (parsed instanceof Error) throw new Error(`That key could not be read: ${parsed.message}`)
  const key = Array.isArray(parsed) ? parsed[0] : parsed
  const pub = `${key.type} ${key.getPublicSSH().toString('base64')} xgallery-panel`
  const cur = getSshConfig()
  setSetting('devSsh', { ...cur, privateKey, passphrase, publicKey: pub, createdAt: now() })
  return publicSshConfig()
}

/** Create a fresh ed25519 key pair on the server; the owner installs the public half on the VPS. */
export function generateSshKey(): ReturnType<typeof publicSshConfig> {
  const pair = utils.generateKeyPairSync('ed25519', { comment: 'xgallery-panel' })
  const cur = getSshConfig()
  setSetting('devSsh', { ...cur, privateKey: pair.private, passphrase: '', publicKey: pair.public.trim(), createdAt: now() })
  return publicSshConfig()
}

export function clearSshKey(): void {
  const cur = getSshConfig()
  setSetting('devSsh', { ...cur, privateKey: '', passphrase: '', publicKey: '', createdAt: null })
}

export function forgetHost(host: string): void {
  const cur = getSshConfig()
  const knownHosts = { ...cur.knownHosts }
  delete knownHosts[host]
  setSetting('devSsh', { ...cur, knownHosts })
}

function hostKeyCheck(host: string, key: Buffer): { ok: boolean; reason?: string; first?: boolean } {
  const fp = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  const cur = getSshConfig()
  const known = cur.knownHosts[host]
  if (!known) {
    setSetting('devSsh', { ...cur, knownHosts: { ...cur.knownHosts, [host]: fp } })
    return { ok: true, first: true }
  }
  if (known !== fp) return { ok: false, reason: `Host key for ${host} changed (known ${known}, offered ${fp}). If the server was reinstalled, forget the host in the terminal settings and connect again.` }
  return { ok: true }
}

interface ConnectMsg {
  type: 'connect'
  profileId?: string
  host?: string
  port?: number
  user?: string
  auth: { method: 'key' | 'password' | 'pasted-key'; password?: string; privateKey?: string; passphrase?: string }
  cols?: number
  rows?: number
  command?: string
}

function userForToken(token: string): { id: number; role: string; display_name: string } | undefined {
  return db.prepare('SELECT u.id, u.role, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND u.disabled = 0').get(token, now()) as { id: number; role: string; display_name: string } | undefined
}

export function attachTerminal(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/api/dev/terminal/ws')) {
      socket.destroy()
      return
    }
    const token = parseCookies(req.headers.cookie)[COOKIE]
    const user = token ? userForToken(token) : undefined
    const dev = token ? devSessionForToken(token) : undefined
    if (!user || user.role !== 'owner' || !dev) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => session(ws, user, dev.id, req.socket.remoteAddress ?? ''))
  })
}

function session(ws: WebSocket, user: { id: number; display_name: string }, devSessionId: number, ip: string): void {
  let client: SshClient | null = null
  let stream: import('ssh2').ClientChannel | null = null
  let started = 0
  let bytesIn = 0
  let bytesOut = 0
  let label = ''
  const send = (msg: Record<string, unknown>) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg))
  const close = (reason: string) => {
    if (stream) {
      stream.end()
      stream = null
    }
    if (client) {
      client.end()
      client = null
    }
    if (started) {
      recordEvent(devSessionId, 'terminal.close', { path: label, summary: `Terminal to ${label} closed after ${Math.round((now() - started) / 1000)}s (${reason}; ${bytesIn} bytes typed, ${bytesOut} bytes received)`, detail: { seconds: Math.round((now() - started) / 1000), bytesIn, bytesOut, reason } })
      started = 0
    }
  }

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      if (stream) {
        bytesIn += (raw as Buffer).length
        stream.write(raw as Buffer)
      }
      return
    }
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type === 'data' && typeof msg.data === 'string') {
      if (stream) {
        bytesIn += msg.data.length
        stream.write(msg.data)
      }
      return
    }
    if (msg.type === 'resize' && stream) {
      stream.setWindow(Math.max(2, Number(msg.rows) || 24), Math.max(10, Number(msg.cols) || 80), 0, 0)
      return
    }
    if (msg.type === 'disconnect') {
      close('closed by you')
      send({ type: 'exit', reason: 'disconnected' })
      return
    }
    if (msg.type !== 'connect' || client) return
    const m = msg as unknown as ConnectMsg
    const ops = getOps()
    const profile = m.profileId ? ops.shell.profiles.find((p) => p.id === m.profileId) : undefined
    const host = String(profile?.host ?? m.host ?? '').trim()
    const port = Number(profile?.port ?? m.port ?? 22)
    const username = String(profile?.user ?? m.user ?? 'root').trim()
    if (!/^[a-z0-9.-]+$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-z_][a-z0-9_-]{0,31}$/i.test(username)) {
      send({ type: 'error', message: 'Invalid host, port or user' })
      return
    }
    label = `${username}@${host}:${port}`
    const cfg = getSshConfig()
    const auth = m.auth ?? { method: 'key' }
    const connectOpts: import('ssh2').ConnectConfig = { host, port, username, readyTimeout: 25_000, keepaliveInterval: 15_000, keepaliveCountMax: 4, hostVerifier: (key: Buffer) => hostKeyCheck(host, key).ok }
    if (auth.method === 'password') {
      if (!auth.password) {
        send({ type: 'error', message: 'A password is needed for this connection' })
        return
      }
      connectOpts.password = auth.password
    } else if (auth.method === 'pasted-key') {
      if (!auth.privateKey) {
        send({ type: 'error', message: 'Paste a private key first' })
        return
      }
      connectOpts.privateKey = auth.privateKey
      if (auth.passphrase) connectOpts.passphrase = auth.passphrase
    } else {
      if (!cfg.privateKey) {
        send({ type: 'error', message: 'No panel SSH key is stored yet: generate or paste one in Terminal → Key, and add its public half to the VPS' })
        return
      }
      connectOpts.privateKey = cfg.privateKey
      if (cfg.passphrase) connectOpts.passphrase = cfg.passphrase
    }
    const c = new Client()
    client = c
    send({ type: 'status', message: `Connecting to ${label}…` })
    c.on('ready', () => {
      c.shell({ term: 'xterm-256color', cols: Math.max(10, Number(m.cols) || 80), rows: Math.max(2, Number(m.rows) || 24) }, (err, s) => {
        if (err || !s) {
          send({ type: 'error', message: `Could not open a shell: ${err?.message ?? 'unknown error'}` })
          close('shell failed')
          return
        }
        stream = s
        started = now()
        const known = getSshConfig().knownHosts[host]
        send({ type: 'ready', host, user: username, port, hostKey: known ?? '' })
        recordEvent(devSessionId, 'terminal.connect', { path: label, summary: `SSH terminal opened to ${label} (${auth.method === 'password' ? 'password' : 'key'})`, detail: { host, port, user: username, auth: auth.method, ip } })
        logActivity({ userId: user.id, kind: 'dev.terminal', targetLabel: label, ip })
        s.on('data', (d: Buffer) => {
          bytesOut += d.length
          if (ws.readyState === ws.OPEN) ws.send(d, { binary: true })
        })
        s.stderr.on('data', (d: Buffer) => {
          bytesOut += d.length
          if (ws.readyState === ws.OPEN) ws.send(d, { binary: true })
        })
        s.on('close', (code: number | null) => {
          send({ type: 'exit', code: code ?? null, reason: 'shell ended' })
          close(`shell ended${code != null ? ` with code ${code}` : ''}`)
        })
        if (m.command) s.write(`${m.command}\n`)
      })
    })
    c.on('error', (e) => {
      const check = /Host key/i.test(e.message) ? e.message : null
      send({ type: 'error', message: check ?? `SSH error: ${e.message}` })
      close(`error: ${e.message}`)
    })
    c.on('end', () => close('connection ended'))
    try {
      c.connect(connectOpts)
    } catch (e) {
      send({ type: 'error', message: (e as Error).message })
      close('connect failed')
    }
  })
  ws.on('close', () => close('socket closed'))
  ws.on('error', () => close('socket error'))
}
