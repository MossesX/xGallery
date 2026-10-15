/**
 * How a terminal tab reaches a shell.
 *
 * - WsTransport: the panel server opens the SSH connection (ssh2) and relays it over a WebSocket.
 *   Works in any browser, including the Android app's web view, while the site is reachable.
 * - NativeTransport: the Android app's own SSH client (sshj), exposed to the page as
 *   window.NativeSsh. Works even when the site is down, and keys live in the phone's keystore.
 */

export interface ConnectOptions {
  profileId?: string
  host: string
  port: number
  user: string
  auth: { method: 'key' | 'password' | 'pasted-key'; password?: string; privateKey?: string; passphrase?: string }
  cols: number
  rows: number
  command?: string
}

export interface TransportEvents {
  onData: (data: Uint8Array | string) => void
  onStatus: (text: string) => void
  onReady: (info: { host: string; user: string; port: number; hostKey?: string }) => void
  onError: (message: string) => void
  onExit: (reason: string) => void
}

export interface Transport {
  readonly kind: 'ws' | 'native'
  connect(opts: ConnectOptions): void
  send(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

export class WsTransport implements Transport {
  readonly kind = 'ws' as const
  private ws: WebSocket | null = null
  constructor(private ev: TransportEvents) {}
  connect(opts: ConnectOptions): void {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/dev/terminal/ws`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => ws.send(JSON.stringify({ type: 'connect', ...opts }))
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this.ev.onData(new Uint8Array(e.data))
        return
      }
      let msg: { type: string; message?: string; host?: string; user?: string; port?: number; hostKey?: string; reason?: string; code?: number | null }
      try {
        msg = JSON.parse(String(e.data))
      } catch {
        return
      }
      if (msg.type === 'status') this.ev.onStatus(msg.message ?? '')
      else if (msg.type === 'ready') this.ev.onReady({ host: msg.host ?? '', user: msg.user ?? '', port: msg.port ?? 22, hostKey: msg.hostKey })
      else if (msg.type === 'error') this.ev.onError(msg.message ?? 'Unknown error')
      else if (msg.type === 'exit') this.ev.onExit(msg.reason ?? (msg.code != null ? `exit code ${msg.code}` : 'closed'))
    }
    ws.onerror = () => this.ev.onError('The terminal connection to the panel server failed')
    ws.onclose = (e) => {
      if (e.code !== 1000 && e.code !== 1005) this.ev.onExit(`connection closed (${e.code})`)
      this.ws = null
    }
  }
  send(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'data', data }))
  }
  resize(cols: number, rows: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'resize', cols, rows }))
  }
  close(): void {
    if (!this.ws) return
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'disconnect' }))
    this.ws.close(1000)
    this.ws = null
    this.ev.onExit('disconnected')
  }
}

/* ---------- native bridge (Android app) ---------- */

interface NativeSshBridge {
  connect(id: string, optsJson: string): void
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  disconnect(id: string): void
  hasStoredKey(): boolean
  storeKey(privateKey: string, passphrase: string): string
  clearKey(): void
  publicKey(): string
  generateKey(): string
  openTermux(command: string): boolean
}

declare global {
  interface Window {
    NativeSsh?: NativeSshBridge
    __xgNativeSsh?: (id: string, kind: string, payload: string) => void
  }
}

const natives = new Map<string, NativeTransport>()
if (typeof window !== 'undefined') {
  window.__xgNativeSsh = (id, kind, payload) => natives.get(id)?.handle(kind, payload)
}

export function nativeAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.NativeSsh
}

export class NativeTransport implements Transport {
  readonly kind = 'native' as const
  readonly id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  constructor(private ev: TransportEvents) {
    natives.set(this.id, this)
  }
  connect(opts: ConnectOptions): void {
    if (!window.NativeSsh) {
      this.ev.onError('Native SSH is only available inside the Android app')
      return
    }
    this.ev.onStatus(`Connecting to ${opts.user}@${opts.host}:${opts.port} with the app's SSH client…`)
    window.NativeSsh.connect(this.id, JSON.stringify(opts))
  }
  /** Called by the app through window.__xgNativeSsh. */
  handle(kind: string, payload: string): void {
    if (kind === 'data') {
      const bin = atob(payload)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      this.ev.onData(bytes)
    } else if (kind === 'ready') {
      try {
        this.ev.onReady(JSON.parse(payload))
      } catch {
        this.ev.onReady({ host: '', user: '', port: 22 })
      }
    } else if (kind === 'status') this.ev.onStatus(payload)
    else if (kind === 'error') this.ev.onError(payload)
    else if (kind === 'exit') {
      this.ev.onExit(payload || 'closed')
      natives.delete(this.id)
    }
  }
  send(data: string): void {
    window.NativeSsh?.write(this.id, data)
  }
  resize(cols: number, rows: number): void {
    window.NativeSsh?.resize(this.id, cols, rows)
  }
  close(): void {
    window.NativeSsh?.disconnect(this.id)
    natives.delete(this.id)
  }
}
