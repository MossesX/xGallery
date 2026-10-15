import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eraser, FolderTree, Maximize2, Minimize2, Plug, Plus, ScrollText, TerminalSquare, Unplug, X, ZoomIn, ZoomOut } from 'lucide-react'
import { api } from '../../../api/client'
import { useOps } from '../../../api/ops'
import { useUI } from '../../../store/ui'
import { CATALOG, defaultsOf, fromCustom, type Command, type CustomSnippet, type Vals } from './catalog'
import { Customize } from './Customize'
import { FtpPane, type FtpHandle } from './FtpPane'
import { Library } from './Library'
import { TermPane, type TermHandle, type TermStatus } from './TermPane'

/**
 * Filesystem commander: a no-code way to drive the server. The library on the left holds every
 * command; the customize pane on the right turns options into the exact line; the middle is a
 * nested tab group — SSH terminals and FTP (SFTP) clients, each with its own tabs — that the
 * snippets act on.
 */

interface CommanderData {
  favorites: string[]
  customs: CustomSnippet[]
  history: { cmd: string; at: number; where: string }[]
  prefs: Record<string, unknown>
}
interface SshTab { id: string; title: string; status: TermStatus; note: string }
interface FtpTab { id: string; path: string }
interface LogLine { at: number; where: string; text: string; ok: boolean }

export function CommanderPage() {
  const notify = useUI((s) => s.notify)
  const { data: opsData } = useOps()
  const profiles = opsData?.ops.shell.profiles ?? []
  const [profileId, setProfileId] = useState('')
  const [auth, setAuth] = useState<'key' | 'password' | 'native'>('key')
  const [password, setPassword] = useState('')
  useEffect(() => {
    if (!profileId && profiles.length) setProfileId(opsData?.ops.shell.defaultProfile && profiles.some((p) => p.id === opsData.ops.shell.defaultProfile) ? opsData.ops.shell.defaultProfile : profiles[0].id)
  }, [profiles, profileId, opsData])
  const profile = profiles.find((p) => p.id === profileId)

  // persisted data (favourites, custom snippets, history)
  const saved = useQuery({ queryKey: ['dev-commander'], queryFn: () => api.get<{ data: CommanderData }>('/api/dev/commander').then((r) => r.data) })
  const [data, setData] = useState<CommanderData>({ favorites: [], customs: [], history: [], prefs: {} })
  const loaded = useRef(false)
  useEffect(() => {
    if (saved.data && !loaded.current) {
      setData(saved.data)
      loaded.current = true
    }
  }, [saved.data])
  const persist = useRef<ReturnType<typeof setTimeout> | null>(null)
  const update = useCallback((patch: Partial<CommanderData>) => {
    setData((d) => {
      const next = { ...d, ...patch }
      if (persist.current) clearTimeout(persist.current)
      persist.current = setTimeout(() => api.put('/api/dev/commander', { data: next }).catch((e: Error) => notify(e.message, 'error')), 600)
      return next
    })
  }, [notify])
  const commands = useMemo(() => [...CATALOG, ...data.customs.map(fromCustom)], [data.customs])
  const favorites = useMemo(() => new Set(data.favorites), [data.favorites])
  const recent = useMemo(() => [...new Set(data.history.map((h) => h.where.startsWith('cmd:') ? h.where.slice(4) : '').filter(Boolean))].slice(0, 10), [data.history])

  // selection + options
  const [selected, setSelected] = useState<Command | null>(null)
  const [vals, setVals] = useState<Vals>({})
  const select = (c: Command) => {
    setSelected(c)
    setVals(defaultsOf(c))
  }

  // nested tab groups
  const [mode, setMode] = useState<'ssh' | 'ftp'>('ssh')
  const [sshTabs, setSshTabs] = useState<SshTab[]>([])
  const [activeSsh, setActiveSsh] = useState<string | null>(null)
  const [ftpTabs, setFtpTabs] = useState<FtpTab[]>([])
  const [activeFtp, setActiveFtp] = useState<string | null>(null)
  const terms = useRef(new Map<string, TermHandle | null>())
  const ftps = useRef(new Map<string, FtpHandle | null>())
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('xg-term-font') || 13))
  const [full, setFull] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const [showLog, setShowLog] = useState(true)
  const addLog = useCallback((where: string, text: string, ok = true) => setLog((l) => [{ at: Date.now(), where, text, ok }, ...l].slice(0, 200)), [])

  const newSsh = useCallback(() => {
    const id = `s${Date.now().toString(36)}`
    setSshTabs((t) => [...t, { id, title: profile ? `${profile.user}@${profile.host}` : 'terminal', status: 'idle', note: '' }])
    setActiveSsh(id)
    setMode('ssh')
    return id
  }, [profile])
  const newFtp = useCallback((path = '/opt/xgallery') => {
    const id = `f${Date.now().toString(36)}`
    setFtpTabs((t) => [...t, { id, path }])
    setActiveFtp(id)
    setMode('ftp')
    return id
  }, [])
  useEffect(() => {
    if (profile && !sshTabs.length) newSsh()
    if (profile && !ftpTabs.length) newFtp()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])
  const closeSsh = (id: string) => {
    terms.current.get(id)?.disconnect()
    terms.current.delete(id)
    setSshTabs((t) => { const rest = t.filter((x) => x.id !== id); if (activeSsh === id) setActiveSsh(rest[rest.length - 1]?.id ?? null); return rest })
  }
  const closeFtp = (id: string) => {
    ftps.current.delete(id)
    setFtpTabs((t) => { const rest = t.filter((x) => x.id !== id); if (activeFtp === id) setActiveFtp(rest[rest.length - 1]?.id ?? null); return rest })
  }

  // running things
  const remember = (cmd: Command | null, line: string, where: string) => update({ history: [{ cmd: line, at: Date.now(), where: cmd ? `cmd:${cmd.id}` : where }, ...data.history].slice(0, 200) })
  const runLine = (line: string, cmd: Command | null = selected) => {
    if (cmd?.ftp) {
      let id = activeFtp
      if (!id) id = newFtp()
      setMode('ftp')
      const h = ftps.current.get(id)
      const o: Record<string, string> = {}
      for (const k of ['path', 'dir', 'mode', 'src', 'dst']) if (vals[k] != null && vals[k] !== '') o[k] = String(vals[k])
      requestAnimationFrame(() => (h ?? ftps.current.get(id!))?.act(cmd.ftp!, o))
      remember(cmd, `ftp:${cmd.ftp} ${JSON.stringify(o)}`, 'ftp')
      return
    }
    if (cmd?.risk === 'danger' && !window.confirm(`This is marked dangerous:\n\n${line}\n\nRun it?`)) return
    let id = activeSsh
    if (!id) id = newSsh()
    setMode('ssh')
    const h = terms.current.get(id)
    requestAnimationFrame(() => (h ?? terms.current.get(id!))?.run(line))
    addLog('ssh', line, true)
    remember(cmd, line, 'ssh')
  }
  const pasteLine = (line: string) => {
    let id = activeSsh
    if (!id) id = newSsh()
    setMode('ssh')
    requestAnimationFrame(() => terms.current.get(id!)?.paste(line))
  }
  const toggleFavorite = (id: string) => update({ favorites: favorites.has(id) ? data.favorites.filter((x) => x !== id) : [...data.favorites, id] })
  const saveCustom = (cs: CustomSnippet) => {
    update({ customs: [...data.customs.filter((c) => c.id !== cs.id), cs] })
    notify(`Snippet “${cs.name}” saved`, 'success')
    select(fromCustom(cs))
  }
  const deleteCustom = (id: string) => {
    update({ customs: data.customs.filter((c) => c.id !== id) })
    setSelected(null)
  }
  useEffect(() => localStorage.setItem('xg-term-font', String(fontSize)), [fontSize])
  const activeSshTab = sshTabs.find((t) => t.id === activeSsh)

  return (
    <div className={`cmdr ${full ? 'full' : ''}`} data-commander="">
      <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">Operations</div>
          <h1 style={{ margin: 0 }}>
            <FolderTree size={22} /> Filesystem commander
          </h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Pick a command, set its options by clicking, and it runs in the terminal or the FTP client. Nothing to type unless you want to.</p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <select className="select sm" value={profileId} onChange={(e) => setProfileId(e.target.value)} aria-label="Server profile">
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.user}@{p.host}
              </option>
            ))}
          </select>
          <select className="select sm" value={auth} onChange={(e) => setAuth(e.target.value as typeof auth)} aria-label="Authentication">
            <option value="key">panel key</option>
            <option value="password">password</option>
            <option value="native">phone's key</option>
          </select>
          {auth === 'password' && <input className="input sm" type="password" placeholder="password (this session)" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="SSH password" autoComplete="off" />}
          <button className="btn ghost icon sm" onClick={() => setFontSize((f) => Math.max(9, f - 1))} title="Smaller text">
            <ZoomOut size={13} />
          </button>
          <button className="btn ghost icon sm" onClick={() => setFontSize((f) => Math.min(24, f + 1))} title="Larger text">
            <ZoomIn size={13} />
          </button>
          <button className="btn ghost icon sm" onClick={() => setFull(!full)} title={full ? 'Exit full screen' : 'Full screen'}>
            {full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      <div className="cmdr-layout">
        <Library commands={commands} favorites={favorites} recent={recent} selectedId={selected?.id ?? null} onSelect={select} onRun={(c) => { select(c); runLine(c.build(defaultsOf(c)), c) }} onFavorite={toggleFavorite} />

        <div className="cmdr-center">
          <div className="cmdr-modes" role="tablist">
            <button role="tab" aria-selected={mode === 'ssh'} className={`vps-tab ${mode === 'ssh' ? 'active' : ''}`} onClick={() => setMode('ssh')} data-mode="ssh">
              <TerminalSquare size={14} /> SSH terminals <span className="muted small">{sshTabs.length}</span>
            </button>
            <button role="tab" aria-selected={mode === 'ftp'} className={`vps-tab ${mode === 'ftp' ? 'active' : ''}`} onClick={() => setMode('ftp')} data-mode="ftp">
              <FolderTree size={14} /> FTP clients <span className="muted small">{ftpTabs.length}</span>
            </button>
            <span className="grow" />
            <button className={`btn ghost sm ${showLog ? 'active' : ''}`} onClick={() => setShowLog(!showLog)} title="Activity log">
              <ScrollText size={12} /> log
            </button>
          </div>

          {mode === 'ssh' && (
            <>
              <div className="term-tabs">
                {sshTabs.map((t) => (
                  <button key={t.id} className={`term-tab st-${t.status} ${t.id === activeSsh ? 'active' : ''}`} onClick={() => setActiveSsh(t.id)} title={t.note} data-ssh-tab={t.id}>
                    <span className="dot" /> {t.title}
                    <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeSsh(t.id) }} role="button" aria-label="Close tab">
                      <X size={11} />
                    </span>
                  </button>
                ))}
                <button className="btn ghost icon sm" onClick={newSsh} title="New terminal tab" data-ssh-new="">
                  <Plus size={13} />
                </button>
                <span className="grow" />
                {activeSshTab && (activeSshTab.status === 'open' || activeSshTab.status === 'connecting' ? (
                  <button className="btn ghost sm" onClick={() => terms.current.get(activeSshTab.id)?.disconnect()}>
                    <Unplug size={12} /> Disconnect
                  </button>
                ) : (
                  <button className="btn primary sm" onClick={() => terms.current.get(activeSshTab.id)?.connect()} data-ssh-connect="">
                    <Plug size={12} /> Connect
                  </button>
                ))}
                {activeSshTab && (
                  <button className="btn ghost icon sm" onClick={() => terms.current.get(activeSshTab.id)?.clear()} title="Clear">
                    <Eraser size={12} />
                  </button>
                )}
                <span className="muted small" data-ssh-note="">{activeSshTab?.note}</span>
              </div>
              <div className="cmdr-term-host">
                {sshTabs.map((t) => (
                  <div key={t.id} className="cmdr-term-wrap" style={{ display: t.id === activeSsh ? 'block' : 'none' }}>
                    <TermPane ref={(h) => { terms.current.set(t.id, h) }} profile={profile} auth={auth} password={password} fontSize={fontSize} visible={mode === 'ssh' && t.id === activeSsh} onStatus={(s, note) => setSshTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, status: s, note } : x)))} />
                  </div>
                ))}
                {!sshTabs.length && <div className="card muted small">No terminal yet. Press + to open one.</div>}
              </div>
            </>
          )}

          {mode === 'ftp' && (
            <>
              <div className="term-tabs">
                {ftpTabs.map((t) => (
                  <button key={t.id} className={`term-tab st-open ${t.id === activeFtp ? 'active' : ''}`} onClick={() => setActiveFtp(t.id)} data-ftp-tab={t.id}>
                    <span className="dot" /> {t.path.split('/').filter(Boolean).pop() || '/'}
                    <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeFtp(t.id) }} role="button" aria-label="Close tab">
                      <X size={11} />
                    </span>
                  </button>
                ))}
                <button className="btn ghost icon sm" onClick={() => newFtp(ftpTabs.find((t) => t.id === activeFtp)?.path ?? '/')} title="New FTP tab" data-ftp-new="">
                  <Plus size={13} />
                </button>
                <span className="grow" />
                <button className="btn ghost sm" onClick={() => { const p = ftpTabs.find((t) => t.id === activeFtp)?.path; if (p) runLine(`cd ${p.includes(' ') ? `'${p}'` : p} && ls -la`, null) }} title="Open a terminal in this folder">
                  <TerminalSquare size={12} /> terminal here
                </button>
              </div>
              <div className="cmdr-term-host">
                {ftpTabs.map((t) => (
                  <FtpPane key={t.id} ref={(h) => { ftps.current.set(t.id, h) }} profile={profileId} initialPath={t.path} visible={t.id === activeFtp} onPath={(p) => setFtpTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, path: p } : x)))} onLog={(line, ok) => addLog('ftp', line, ok)} />
                ))}
                {!ftpTabs.length && <div className="card muted small">No FTP tab yet. Press + to open one.</div>}
              </div>
            </>
          )}

          {showLog && (
            <div className="cmdr-log" data-cmdr-log="">
              {log.length ? log.slice(0, 40).map((l, i) => (
                <div key={i} className={l.ok ? '' : 'fail'}>
                  <span className="muted">{new Date(l.at).toLocaleTimeString()}</span> <span className="chip">{l.where}</span> <code>{l.text}</code>
                </div>
              )) : <span className="muted small">Everything you run shows up here.</span>}
            </div>
          )}
        </div>

        <Customize cmd={selected} vals={vals} setVals={setVals} profile={profileId} favorite={!!selected && favorites.has(selected.id)} onFavorite={() => selected && toggleFavorite(selected.id)} onRun={(line) => runLine(line)} onPaste={pasteLine} onSaveCustom={saveCustom} onDeleteCustom={deleteCustom} customs={data.customs} />
      </div>
    </div>
  )
}
