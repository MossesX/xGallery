import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { ClipboardPaste, KeyRound, Maximize2, Minimize2, Plug, Plus, Sparkles, Trash2, Unplug, X, ZoomIn, ZoomOut } from 'lucide-react'
import { api } from '../../../api/client'
import { useOps, type ShellProfile } from '../../../api/ops'
import { useUI } from '../../../store/ui'
import { nativeAvailable, NativeTransport, WsTransport, type Transport } from '../../../terminal/transport'
import { CommandBlock } from './CommandBlock'
import { SnippetDeck } from '../commander/SnippetDeck'

interface SshInfo {
  hasKey: boolean
  publicKey: string
  createdAt: number | null
  fingerprint: string
  knownHosts: Record<string, string>
}

interface Tab {
  id: string
  title: string
  status: 'connecting' | 'open' | 'closed' | 'error'
  note: string
}

type AuthMode = 'key' | 'password' | 'native'

const QUICK: { label: string; cmd: (o: { deployDir: string; container: string; project: string; composeFile: string; domain: string }) => string; icon?: 'claude' }[] = [
  { label: 'Claude Code (VPS)', cmd: (o) => `cd ${o.deployDir} && claude`, icon: 'claude' },
  { label: 'Claude Code in the app container', cmd: (o) => `docker exec -it ${o.container} sh -lc 'cd /data/ai-workspace 2>/dev/null || cd /app/source; claude'`, icon: 'claude' },
  { label: 'App logs', cmd: (o) => `docker logs --tail 100 -f ${o.container}` },
  { label: 'Deploy dir', cmd: (o) => `cd ${o.deployDir} && git status --short | head -20; git log --oneline -3` },
  { label: 'Redeploy', cmd: (o) => `cd ${o.deployDir} && SITE_DOMAIN=${o.domain} docker compose -p ${o.project} -f ${o.composeFile} up -d --build --remove-orphans` },
  { label: 'Containers', cmd: () => `docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'` },
  { label: 'Resources', cmd: () => `uptime; free -h | head -2; df -h / | tail -1; top -bn1 | head -12` },
  { label: 'Shell in container', cmd: (o) => `docker exec -it ${o.container} sh` },
]

const SOFT_KEYS: [string, string][] = [
  ['Esc', '\x1b'],
  ['Tab', '\t'],
  ['Ctrl-C', '\x03'],
  ['Ctrl-D', '\x04'],
  ['Ctrl-Z', '\x1a'],
  ['Ctrl-L', '\x0c'],
  ['↑', '\x1b[A'],
  ['↓', '\x1b[B'],
  ['←', '\x1b[D'],
  ['→', '\x1b[C'],
  ['Home', '\x1b[H'],
  ['End', '\x1b[F'],
]

/** Key kept inside the Android app (encrypted preferences) for the app's own SSH client. */
function NativeKeyCard() {
  const notify = useUI((s) => s.notify)
  const [, tick] = useState(0)
  const [pem, setPem] = useState('')
  const [phrase, setPhrase] = useState('')
  const bridge = window.NativeSsh!
  const pub = bridge.publicKey()
  const install = pub ? `mkdir -p ~/.ssh && chmod 700 ~/.ssh\necho '${pub}' >> ~/.ssh/authorized_keys\nchmod 600 ~/.ssh/authorized_keys` : ''
  return (
    <div className="card stack term-keycard" style={{ gap: 10 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>App key (this phone)</strong>
          <div className="muted small">{bridge.hasStoredKey() ? 'A key is stored in the phone’s encrypted storage; it is used by “App SSH client” connections and never leaves the device.' : 'No key on this phone yet. Generate one or paste a private key; then add the public key to the VPS.'}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => { const r = bridge.generateKey(); notify(r.startsWith('error') ? r : 'Key generated on the phone', r.startsWith('error') ? 'error' : 'success'); tick((n) => n + 1) }}>
            <KeyRound size={13} /> Generate on phone
          </button>
          {bridge.hasStoredKey() && (
            <button className="btn ghost sm danger" onClick={() => { if (confirm('Remove the key from this phone?')) { bridge.clearKey(); tick((n) => n + 1) } }}>
              <Trash2 size={13} /> Remove
            </button>
          )}
        </div>
      </div>
      {pub && <CommandBlock title="Install the phone's public key on the VPS" code={install} filename="install-phone-key.sh" />}
      <details>
        <summary className="muted small">Paste a private key into the phone</summary>
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          <textarea className="textarea mono" value={pem} onChange={(e) => setPem(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" style={{ minHeight: 100 }} spellCheck={false} />
          <div className="row" style={{ gap: 6 }}>
            <input className="input sm" type="password" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="passphrase (if any)" style={{ width: 200 }} />
            <button className="btn sm" onClick={() => { const r = bridge.storeKey(pem, phrase); notify(r === 'ok' ? 'Key stored on the phone' : r, r === 'ok' ? 'success' : 'error'); if (r === 'ok') { setPem(''); setPhrase(''); tick((n) => n + 1) } }} disabled={!pem.trim()}>
              Store on phone
            </button>
          </div>
        </div>
      </details>
    </div>
  )
}

/** A real SSH terminal: the panel server (or the Android app's own client) opens the shell; xterm renders it. */
export function TerminalPage() {
  const notify = useUI((s) => s.notify)
  const qc = useQueryClient()
  const { data: opsData } = useOps()
  const ssh = useQuery({ queryKey: ['dev-ssh'], queryFn: () => api.get<{ ssh: SshInfo }>('/api/dev/ssh').then((r) => r.ssh) })
  const ops = opsData?.ops
  const profiles = ops?.shell.profiles ?? []
  const [profileId, setProfileId] = useState('')
  const [auth, setAuth] = useState<AuthMode>('key')
  const [password, setPassword] = useState('')
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [full, setFull] = useState(false)
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('xg-term-font') || 13))
  const [showKey, setShowKey] = useState(false)
  const [pasteKey, setPasteKey] = useState('')
  const [pastePhrase, setPastePhrase] = useState('')
  const hostRef = useRef<HTMLDivElement>(null)
  const terms = useRef(new Map<string, { term: Terminal; fit: FitAddon; transport: Transport; el: HTMLDivElement }>())
  const native = nativeAvailable()
  useEffect(() => {
    if (!profileId && profiles.length) setProfileId(ops?.shell.defaultProfile && profiles.some((p) => p.id === ops.shell.defaultProfile) ? ops.shell.defaultProfile : profiles[0].id)
  }, [profiles, profileId, ops])
  useEffect(() => localStorage.setItem('xg-term-font', String(fontSize)), [fontSize])
  const profile: ShellProfile | undefined = profiles.find((p) => p.id === profileId)

  const patch = useCallback((id: string, p: Partial<Tab>) => setTabs((t) => t.map((x) => (x.id === id ? { ...x, ...p } : x))), [])

  const fitActive = useCallback(() => {
    if (!active) return
    const t = terms.current.get(active)
    if (!t) return
    try {
      t.fit.fit()
      t.transport.resize(t.term.cols, t.term.rows)
    } catch {
      /* not attached yet */
    }
  }, [active])

  // Show the active terminal's element, hide the others, refit.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    for (const [id, t] of terms.current) {
      t.el.style.display = id === active ? 'block' : 'none'
      if (id === active && !t.el.parentElement) host.appendChild(t.el)
    }
    const r = requestAnimationFrame(() => {
      fitActive()
      if (active) terms.current.get(active)?.term.focus()
    })
    return () => cancelAnimationFrame(r)
  }, [active, full, fontSize, fitActive])
  useEffect(() => {
    const onResize = () => fitActive()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fitActive])
  useEffect(() => {
    for (const t of terms.current.values()) t.term.options.fontSize = fontSize
    fitActive()
  }, [fontSize, fitActive])
  useEffect(() => () => { for (const t of terms.current.values()) { t.transport.close(); t.term.dispose() } }, [])

  const connect = (command?: string) => {
    if (!profile) return notify('Pick a server profile first', 'error')
    if (auth === 'password' && !password) return notify('Type the password for this session', 'error')
    if (auth === 'key' && !ssh.data?.hasKey) return notify('Generate or paste the panel SSH key first (Key button)', 'error')
    const id = `t${Date.now().toString(36)}`
    const term = new Terminal({ fontSize, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', cursorBlink: true, scrollback: 5000, theme: { background: '#0f0c09', foreground: '#f3ede4', cursor: '#ff7a1a', selectionBackground: '#ff7a1a55' }, allowProposedApi: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    const el = document.createElement('div')
    el.className = 'term-surface'
    const events = {
      onData: (d: Uint8Array | string) => term.write(d),
      onStatus: (s: string) => patch(id, { note: s }),
      onReady: (info: { host: string; user: string; port: number; hostKey?: string }) => {
        patch(id, { status: 'open', note: info.hostKey ? `host key ${info.hostKey}` : '' })
        setTimeout(() => {
          try {
            fit.fit()
            term.refresh(0, term.rows - 1)
          } catch {
            /* ignore */
          }
        }, 80)
      },
      onError: (m: string) => {
        patch(id, { status: 'error', note: m })
        term.write(`\r\n\x1b[31m${m}\x1b[0m\r\n`)
      },
      onExit: (r: string) => {
        patch(id, { status: 'closed', note: r })
        term.write(`\r\n\x1b[33m[${r}]\x1b[0m\r\n`)
      },
    }
    const transport: Transport = auth === 'native' ? new NativeTransport(events) : new WsTransport(events)
    term.onData((d) => transport.send(d))
    term.onResize(({ cols, rows }) => transport.resize(cols, rows))
    terms.current.set(id, { term, fit, transport, el })
    setTabs((t) => [...t, { id, title: `${profile.user}@${profile.host}`, status: 'connecting', note: 'Connecting…' }])
    setActive(id)
    // Open into the host right away (it is mounted) so xterm measures real dimensions before the first bytes arrive.
    const host = hostRef.current
    if (host) {
      for (const [, t] of terms.current) t.el.style.display = 'none'
      el.style.display = 'block'
      host.appendChild(el)
      term.open(el)
      try {
        fit.fit()
      } catch {
        /* measured again on the next frame */
      }
    }
    transport.connect({ profileId: profile.id, host: profile.host, port: profile.port, user: profile.user, auth: auth === 'password' ? { method: 'password', password } : { method: 'key' }, cols: term.cols, rows: term.rows, command })
    requestAnimationFrame(() => {
      if (!el.parentElement && hostRef.current) {
        hostRef.current.appendChild(el)
        term.open(el)
      }
      try {
        fit.fit()
        term.refresh(0, term.rows - 1)
      } catch {
        /* ignore */
      }
      term.focus()
    })
  }
  const closeTab = (id: string) => {
    const t = terms.current.get(id)
    if (t) {
      t.transport.close()
      t.term.dispose()
      t.el.remove()
      terms.current.delete(id)
    }
    setTabs((ts) => {
      const rest = ts.filter((x) => x.id !== id)
      if (active === id) setActive(rest[rest.length - 1]?.id ?? null)
      return rest
    })
  }
  const sendRaw = (data: string) => {
    if (!active) return
    const t = terms.current.get(active)
    hostRef.current?.scrollIntoView({ block: 'start' })
    t?.transport.send(data)
    t?.term.focus()
  }
  const run = (cmd: string) => {
    const t = active ? terms.current.get(active) : null
    const tab = tabs.find((x) => x.id === active)
    // xterm pauses painting while off-screen, so bring the terminal back into view when a snippet below it runs.
    hostRef.current?.scrollIntoView({ block: 'start' })
    if (t && tab?.status === 'open') sendRaw(`${cmd}\n`)
    else connect(cmd)
  }
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) sendRaw(text)
    } catch {
      notify('Clipboard access was refused by the browser', 'error')
    }
  }

  const gen = useMutation({ mutationFn: () => api.post<{ ssh: SshInfo }>('/api/dev/ssh/generate', {}), onSuccess: (r) => { qc.setQueryData(['dev-ssh'], r.ssh); notify('Panel key generated: add the public key to the VPS', 'success') }, onError: (e: Error) => notify(e.message, 'error') })
  const put = useMutation({ mutationFn: () => api.put<{ ssh: SshInfo }>('/api/dev/ssh', { privateKey: pasteKey, passphrase: pastePhrase }), onSuccess: (r) => { qc.setQueryData(['dev-ssh'], r.ssh); setPasteKey(''); setPastePhrase(''); notify('Panel key stored', 'success') }, onError: (e: Error) => notify(e.message, 'error') })
  const del = useMutation({ mutationFn: () => api.del<{ ssh: SshInfo }>('/api/dev/ssh'), onSuccess: (r) => { qc.setQueryData(['dev-ssh'], r.ssh); notify('Panel key removed', 'info') } })
  const forget = useMutation({ mutationFn: (host: string) => api.del<{ ssh: SshInfo }>(`/api/dev/ssh/known-hosts/${encodeURIComponent(host)}`), onSuccess: (r) => qc.setQueryData(['dev-ssh'], r.ssh) })

  const quickCtx = useMemo(() => ({ deployDir: ops?.deployDir ?? '/opt/xgallery', container: ops?.container ?? 'xgallery-app', project: ops?.project ?? 'xgallery', composeFile: ops?.composeFile ?? 'docker-compose.traefik.yml', domain: ops?.domain ?? 'xgallery.amberxai.com' }), [ops])
  const activeTab = tabs.find((t) => t.id === active)
  const installCmd = ssh.data?.publicKey ? `mkdir -p ~/.ssh && chmod 700 ~/.ssh\necho '${ssh.data.publicKey}' >> ~/.ssh/authorized_keys\nchmod 600 ~/.ssh/authorized_keys` : ''

  return (
    <div className={`term-page ${full ? 'full' : ''}`} data-terminal-page="">
      <div className="term-topbar">
        <strong className="row" style={{ gap: 6 }}>
          <Plug size={15} /> Terminal
        </strong>
        <select className="select sm" value={profileId} onChange={(e) => setProfileId(e.target.value)} aria-label="Server profile" style={{ width: 'auto' }}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.user}@{p.host}
            </option>
          ))}
        </select>
        <select className="select sm" value={auth} onChange={(e) => setAuth(e.target.value as AuthMode)} aria-label="Authentication" style={{ width: 'auto' }}>
          <option value="key">Panel key{ssh.data?.hasKey ? '' : ' (none yet)'}</option>
          <option value="password">Password (this session only)</option>
          {native && <option value="native">App SSH client (works when the site is down)</option>}
        </select>
        {auth === 'password' && <input className="input sm" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" aria-label="SSH password" autoComplete="off" style={{ width: 160 }} />}
        <button className="btn primary sm" onClick={() => connect()} data-connect="">
          <Plus size={13} /> Connect
        </button>
        <button className={`btn sm ${showKey ? 'active' : ''}`} onClick={() => setShowKey((v) => !v)} title="Panel SSH key">
          <KeyRound size={13} /> Key{ssh.data?.hasKey ? ' ✓' : ''}
        </button>
        <span className="grow" />
        <button className="btn ghost icon sm" onClick={() => setFontSize((f) => Math.max(9, f - 1))} title="Smaller text">
          <ZoomOut size={13} />
        </button>
        <button className="btn ghost icon sm" onClick={() => setFontSize((f) => Math.min(24, f + 1))} title="Larger text">
          <ZoomIn size={13} />
        </button>
        <button className="btn ghost icon sm" onClick={() => setFull((v) => !v)} title={full ? 'Exit full screen' : 'Full screen'}>
          {full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>

      {showKey && (
        <div className="card stack term-keycard" style={{ gap: 10 }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong>Panel SSH key</strong>
              <div className="muted small">{ssh.data?.hasKey ? `${ssh.data.fingerprint} · created ${ssh.data.createdAt ? new Date(ssh.data.createdAt).toLocaleString() : ''}` : 'No key yet. Generate one here (it never leaves the panel server) or paste an existing private key.'}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => (ssh.data?.hasKey ? confirm('Replace the current panel key? The old public key stops working on every server.') : true) && gen.mutate()} disabled={gen.isPending}>
                <KeyRound size={13} /> {ssh.data?.hasKey ? 'Regenerate' : 'Generate key'}
              </button>
              {ssh.data?.hasKey && (
                <button className="btn ghost sm danger" onClick={() => confirm('Remove the panel key?') && del.mutate()}>
                  <Trash2 size={13} /> Remove
                </button>
              )}
            </div>
          </div>
          {ssh.data?.hasKey && <CommandBlock title="Install the public key on the VPS (run once, as the user you connect as)" hint="paste into an existing ssh session, or use the command wizard" code={installCmd} filename="install-panel-key.sh" />}
          <details>
            <summary className="muted small">Paste a private key instead</summary>
            <div className="stack" style={{ gap: 6, marginTop: 6 }}>
              <textarea className="textarea mono" value={pasteKey} onChange={(e) => setPasteKey(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" style={{ minHeight: 110 }} spellCheck={false} aria-label="Private key" />
              <div className="row" style={{ gap: 6 }}>
                <input className="input sm" type="password" value={pastePhrase} onChange={(e) => setPastePhrase(e.target.value)} placeholder="passphrase (if any)" aria-label="Key passphrase" style={{ width: 200 }} />
                <button className="btn sm" onClick={() => put.mutate()} disabled={!pasteKey.trim() || put.isPending}>
                  Store key
                </button>
              </div>
            </div>
          </details>
          {ssh.data && Object.keys(ssh.data.knownHosts).length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="eyebrow">Pinned host keys</span>
              {Object.entries(ssh.data.knownHosts).map(([h, fp]) => (
                <div key={h} className="row" style={{ gap: 8, fontSize: '0.8rem' }}>
                  <code>{h}</code> <span className="muted">{fp}</span>
                  <button className="btn ghost sm" onClick={() => forget.mutate(h)}>
                    forget
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {native && showKey && <NativeKeyCard />}

      <div className="term-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`term-tab ${t.id === active ? 'active' : ''} st-${t.status}`} onClick={() => setActive(t.id)} title={t.note} data-term-tab={t.id}>
            <span className="dot" /> {t.title}
            <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(t.id) }} role="button" aria-label="Close terminal">
              <X size={11} />
            </span>
          </button>
        ))}
        {tabs.length === 0 && <span className="muted small" style={{ padding: '4px 8px' }}>No terminal yet. Pick a profile and Connect, or press a quick action.</span>}
        <span className="grow" />
        {activeTab && <span className="muted small clamp-1" data-term-note="">{activeTab.note}</span>}
        {activeTab && activeTab.status === 'open' && (
          <button className="btn ghost icon sm" title="Disconnect" onClick={() => terms.current.get(activeTab.id)?.transport.close()}>
            <Unplug size={13} />
          </button>
        )}
      </div>

      <div className="term-host" ref={hostRef} data-term-host="" />

      <SnippetDeck profile={profileId} mode="terminal" onRun={(line) => run(line)} onPaste={(line) => sendRaw(line)} defaultOpen={false} />
      <div className="term-quick">
        {QUICK.map((q) => (
          <button key={q.label} className={`btn sm ${q.icon === 'claude' ? 'primary' : ''}`} onClick={() => run(q.cmd(quickCtx))} title={q.cmd(quickCtx)}>
            {q.icon === 'claude' && <Sparkles size={12} />} {q.label}
          </button>
        ))}
        <button className="btn sm" onClick={paste} title="Paste from the clipboard">
          <ClipboardPaste size={12} /> Paste
        </button>
        {native && profile && (
          <button
            className="btn sm"
            title="Open a mosh session in Termux (needs Termux with allow-external-apps; otherwise the command is copied and Termux opened)"
            onClick={() => {
              const ok = window.NativeSsh?.openTermux(`mosh --ssh='ssh -p ${profile.port}' --predict=${profile.predict} -p ${profile.udpFrom}:${profile.udpTo} ${profile.user}@${profile.host}${profile.tmux ? ` -- tmux new -A -s ${profile.tmux}` : ''}`)
              notify(ok ? 'Handed over to Termux' : 'Termux is not installed (get it from F-Droid)', ok ? 'success' : 'error')
            }}
          >
            mosh in Termux
          </button>
        )}
      </div>
      <div className="term-softkeys">
        {SOFT_KEYS.map(([label, seq]) => (
          <button key={label} className="btn ghost sm" onClick={() => sendRaw(seq)}>
            {label}
          </button>
        ))}
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>
        Connections are opened by the panel server with the panel key (or a password typed for this session only), pinned to the server's host key on first use, and logged on your developer session. Claude Code runs on the VPS when installed there (command wizard → Deploy & app), or inside the app container, where it is already installed.
      </p>
    </div>
  )
}
