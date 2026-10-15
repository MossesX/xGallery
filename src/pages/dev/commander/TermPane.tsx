import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { ShellProfile } from '../../../api/ops'
import { nativeAvailable, NativeTransport, WsTransport, type Transport } from '../../../terminal/transport'

/**
 * One SSH terminal inside the commander: xterm wired to the panel's SSH relay (or the Android
 * app's own client). The parent drives it through the ref: run a snippet, paste text, reconnect.
 */

export type TermStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'
export interface TermHandle {
  /** Type a command and press Enter (connects first when needed). */
  run: (cmd: string) => void
  /** Put text at the prompt without pressing Enter. */
  paste: (text: string) => void
  /** Raw bytes (control sequences). */
  send: (data: string) => void
  connect: () => void
  disconnect: () => void
  focus: () => void
  fit: () => void
  clear: () => void
}
interface Props {
  profile: ShellProfile | undefined
  auth: 'key' | 'password' | 'native'
  password?: string
  fontSize: number
  visible: boolean
  autoConnect?: boolean
  onStatus?: (s: TermStatus, note: string) => void
}

export const TermPane = forwardRef<TermHandle, Props>(function TermPane({ profile, auth, password, fontSize, visible, autoConnect, onStatus }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const transport = useRef<Transport | null>(null)
  const [status, setStatus] = useState<TermStatus>('idle')
  const statusRef = useRef<TermStatus>('idle')
  const pending = useRef<string | null>(null)
  const set = (s: TermStatus, note = '') => {
    statusRef.current = s
    setStatus(s)
    onStatus?.(s, note)
  }

  useEffect(() => {
    const t = new Terminal({ fontSize, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', cursorBlink: true, scrollback: 8000, theme: { background: '#0f0c09', foreground: '#f3ede4', cursor: '#ff7a1a', selectionBackground: '#ff7a1a55' }, allowProposedApi: true })
    const f = new FitAddon()
    t.loadAddon(f)
    t.loadAddon(new WebLinksAddon())
    t.open(host.current!)
    f.fit()
    t.onData((d) => transport.current?.send(d))
    t.onResize(({ cols, rows }) => transport.current?.resize(cols, rows))
    term.current = t
    fit.current = f
    t.writeln('\x1b[2m[commander] pick a snippet on the left, or press Connect]\x1b[0m')
    return () => {
      transport.current?.close()
      t.dispose()
      term.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (term.current) term.current.options.fontSize = fontSize
    doFit()
  }, [fontSize])
  useEffect(() => {
    if (visible) {
      const r = requestAnimationFrame(() => {
        doFit()
        term.current?.focus()
      })
      return () => cancelAnimationFrame(r)
    }
  }, [visible])
  useEffect(() => {
    const onResize = () => visible && doFit()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [visible])
  useEffect(() => {
    if (autoConnect && profile && statusRef.current === 'idle') connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, profile?.id])

  const doFit = () => {
    try {
      fit.current?.fit()
      if (term.current) transport.current?.resize(term.current.cols, term.current.rows)
    } catch {
      /* not visible */
    }
  }
  const connect = (command?: string) => {
    const t = term.current
    if (!t || !profile) {
      set('error', 'No server profile')
      return
    }
    if (statusRef.current === 'connecting' || statusRef.current === 'open') return
    transport.current?.close()
    const events = {
      onData: (d: Uint8Array | string) => t.write(d),
      onStatus: (s: string) => set('connecting', s),
      onReady: () => {
        set('open', `${profile.user}@${profile.host}`)
        if (pending.current) {
          const c = pending.current
          pending.current = null
          setTimeout(() => transport.current?.send(`${c}\n`), 300)
        }
      },
      onError: (m: string) => {
        set('error', m)
        t.write(`\r\n\x1b[31m${m}\x1b[0m\r\n`)
      },
      onExit: (r: string) => {
        if (statusRef.current !== 'error') set('closed', r)
        t.write(`\r\n\x1b[33m[${r}]\x1b[0m\r\n`)
      },
    }
    const tr: Transport = auth === 'native' && nativeAvailable() ? new NativeTransport(events) : new WsTransport(events)
    transport.current = tr
    pending.current = command ?? null
    set('connecting', 'Connecting…')
    t.writeln(`\x1b[2mConnecting to ${profile.user}@${profile.host}:${profile.port}…\x1b[0m`)
    tr.connect({ profileId: profile.id, host: profile.host, port: profile.port, user: profile.user, auth: auth === 'password' ? { method: 'password', password: password ?? '' } : { method: 'key' }, cols: t.cols, rows: t.rows })
  }
  useImperativeHandle(ref, () => ({
    run: (cmd) => {
      if (statusRef.current === 'open') {
        transport.current?.send(`${cmd}\n`)
        term.current?.focus()
      } else connect(cmd)
    },
    paste: (text) => {
      if (statusRef.current === 'open') {
        transport.current?.send(text)
        term.current?.focus()
      } else connect(text.replace(/\n$/, ''))
    },
    send: (data) => transport.current?.send(data),
    connect: () => connect(),
    disconnect: () => {
      transport.current?.close()
      transport.current = null
    },
    focus: () => term.current?.focus(),
    fit: doFit,
    clear: () => term.current?.clear(),
  }))
  return <div ref={host} className="cmdr-term" data-term-status={status} data-term-host="" />
})
