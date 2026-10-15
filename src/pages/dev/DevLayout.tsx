import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Braces, Code2, Gauge, FolderGit2, History, KeyRound, LayoutTemplate, LifeBuoy, ListTodo, Lock, Menu, MousePointerClick, Palette, PanelBottom, PanelTop, Plug, Ruler, ScrollText, Server, Settings2, ShieldAlert, SlidersHorizontal, Smartphone, Sparkles, TerminalSquare, ToggleLeft, Unlock, Wand2, WifiOff } from 'lucide-react'
import { offlineState } from '../../api/client'

/** "You are offline" / "showing cached data" bar for the panel (the service worker serves the last good copy). */
function OfflineBar() {
  const [online, setOnline] = useState(navigator.onLine)
  const [cachedAt, setCachedAt] = useState(offlineState.cachedAt)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    const l = () => setCachedAt(offlineState.cachedAt)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    offlineState.listeners.add(l)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      offlineState.listeners.delete(l)
    }
  }, [])
  if (online && !cachedAt) return null
  return (
    <div className="offline-bar" data-offline-bar="">
      <WifiOff size={14} /> {online ? 'The server did not answer: ' : 'You are offline: '}
      showing cached panel data{cachedAt ? ` from ${new Date(cachedAt).toLocaleString()}` : ''}. Changes are disabled until the connection is back.
    </div>
  )
}
import { api } from '../../api/client'
import { useMe } from '../../api/hooks'
import { devKeys, useDevStatus } from '../../api/dev'
import { PageLoader } from '../../components/Skeleton'
import { useUI } from '../../store/ui'
import { isSafeMode } from '../../ui/config'

const LINKS = [
  { to: '/dev', label: 'Overview', icon: Gauge, end: true },
  { to: '/dev/assistant', label: 'Developer AI', icon: Sparkles },
  { to: '/dev/code', label: 'Code editor', icon: Code2 },
  { to: '/dev/restore', label: 'Checkpoints & restore', icon: History },
  { to: '/dev/sessions', label: 'Session log', icon: ScrollText },
  { to: '/dev/tasks', label: 'Task manager', icon: ListTodo },
]
const OPS = [
  { to: '/dev/vps', label: 'VPS manager', icon: Server },
  { to: '/dev/github', label: 'GitHub manager', icon: FolderGit2 },
  { to: '/dev/terminal', label: 'Terminal · SSH', icon: Plug },
  { to: '/dev/ops', label: 'Command wizard', icon: Wand2 },
  { to: '/dev/shell', label: 'Remote shell · mosh', icon: TerminalSquare },
  { to: '/dev/android', label: 'Android app', icon: Smartphone },
]
const DESIGN = [
  { to: '/dev/themes', label: 'Themes', icon: Palette },
  { to: '/dev/appearance', label: 'Appearance & layouts', icon: SlidersHorizontal },
  { to: '/dev/navigation', label: 'Navigation menu', icon: Menu },
  { to: '/dev/toolbar', label: 'Toolbar', icon: PanelTop },
  { to: '/dev/footer', label: 'Footer', icon: PanelBottom },
  { to: '/dev/home', label: 'Home page builder', icon: LayoutTemplate },
  { to: '/dev/context-menu', label: 'Context menu', icon: MousePointerClick },
  { to: '/dev/layout', label: 'Layout & density', icon: Ruler },
  { to: '/dev/css', label: 'Custom CSS', icon: Braces },
  { to: '/dev/features', label: 'Feature switches', icon: ToggleLeft },
]

/** Owner-only developer panel: every page behind it needs the developer password once per login session. */
export function DevLayout() {
  const { data: me, isLoading } = useMe()
  const { data: status, isLoading: statusLoading } = useDevStatus(me?.role === 'owner')
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const designMode = useUI((s) => s.designMode)
  const setDesignMode = useUI((s) => s.setDesignMode)
  const setPreviewUi = useUI((s) => s.setPreviewUi)
  const location = useLocation()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  // Leaving the panel drops any unsaved live preview.
  useEffect(() => () => setPreviewUi(null), [setPreviewUi])

  const lock = useMutation({
    mutationFn: () => api.post('/api/dev/lock', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devKeys.status })
      qc.invalidateQueries({ queryKey: devKeys.sessions })
      setPreviewUi(null)
      setDesignMode(false)
      notify('Developer panel locked', 'info')
    },
  })

  if (isLoading || (me?.role === 'owner' && statusLoading)) return <PageLoader />
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (me.role !== 'owner') return <Navigate to="/admin" replace />
  if (!status) return <PageLoader />
  if (!status.passwordSet) return <SetPasswordScreen />
  if (!status.unlocked) return <UnlockScreen />

  const remaining = status.session ? Math.max(0, Math.round((status.session.lastActiveAt + status.sessionMinutes * 60_000 - Date.now()) / 60_000)) : 0

  const wide = location.pathname.startsWith('/dev/tasks/workspace')
  return (
    <main className={`page dev-page ${wide ? 'dev-wide-page' : ''}`}>
      <OfflineBar />
      <div className={`admin-layout ${wide ? 'dev-wide' : ''}`}>
        <nav className="admin-nav dev-nav">
          <div className="eyebrow" style={{ padding: '0 12px 8px' }}>
            Developer
          </div>
          {LINKS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={16} /> {label}
            </NavLink>
          ))}
          <div className="eyebrow" style={{ padding: '16px 12px 8px' }}>
            Site builder
          </div>
          {DESIGN.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}>
              <Icon size={16} /> {label}
            </NavLink>
          ))}
          <div className="eyebrow" style={{ padding: '16px 12px 8px' }}>
            Operations
          </div>
          {OPS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}>
              <Icon size={16} /> {label}
            </NavLink>
          ))}
          <div className="eyebrow" style={{ padding: '16px 12px 8px' }}>
            Session
          </div>
          <NavLink to="/dev/settings">
            <Settings2 size={16} /> Developer settings
          </NavLink>
          <button className={`dev-nav-btn ${designMode ? 'active' : ''}`} onClick={() => setDesignMode(!designMode)} title="Show edit handles on every page">
            <Wand2 size={16} /> Design mode {designMode ? 'on' : 'off'}
          </button>
          <button className="dev-nav-btn" onClick={() => lock.mutate()} disabled={lock.isPending}>
            <Lock size={16} /> Lock panel
          </button>
          <div className="dev-session-chip">
            <Unlock size={12} /> Session #{status.session?.id} · {status.session?.changes ?? 0} change{status.session?.changes === 1 ? '' : 's'} · locks in {remaining} min
          </div>
          {isSafeMode() && (
            <div className="dev-session-chip warn">
              <LifeBuoy size={12} /> Safe mode: custom design off · <a href="?safe=0">turn on</a>
            </div>
          )}
        </nav>
        <div className="grow" style={{ minWidth: 0 }}>
          <Outlet />
        </div>
      </div>
    </main>
  )
}

function SetPasswordScreen() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const [account, setAccount] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const create = useMutation({
    mutationFn: () => {
      if (pw !== confirm) throw new Error('The two developer passwords do not match')
      return api.post('/api/dev/password', { accountPassword: account, password: pw })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devKeys.status })
      notify('Developer password set. Unlock the panel with it.', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  return (
    <main className="page narrow">
      <form className="login-card request-card dev-gate" onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate() }}>
        <div className="stack" style={{ gap: 12 }}>
          <div>
            <div className="eyebrow">
              <ShieldAlert size={11} /> Developer panel
            </div>
            <h1 style={{ margin: 0 }}>Create the developer password</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              The developer panel edits the site's design and source workspace. It is separate from your account password and must be entered once in every sign-in session that opens the panel. Everything done inside is logged.
            </p>
          </div>
          <div className="field">
            <label htmlFor="dev-account">Your account password</label>
            <input id="dev-account" className="input" type="password" autoComplete="current-password" value={account} onChange={(e) => setAccount(e.target.value)} required autoFocus />
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field grow">
              <label htmlFor="dev-new">New developer password</label>
              <input id="dev-new" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} />
            </div>
            <div className="field grow">
              <label htmlFor="dev-confirm">Confirm</label>
              <input id="dev-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
          </div>
          <button className="btn primary lg" disabled={create.isPending || !account || pw.length < 8 || !confirm}>
            <KeyRound size={15} /> Set developer password
          </button>
          <p className="muted small" style={{ margin: 0 }}>
            <Link to="/admin">Back to the owner console</Link>
          </p>
        </div>
      </form>
    </main>
  )
}

function UnlockScreen() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const [pw, setPw] = useState('')
  const unlock = useMutation({
    mutationFn: () => api.post('/api/dev/unlock', { password: pw }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devKeys.status })
      qc.invalidateQueries({ queryKey: devKeys.sessions })
      notify('Developer session opened', 'success')
    },
    onError: (e: Error) => {
      setPw('')
      notify(e.message, 'error')
    },
  })
  return (
    <main className="page narrow">
      <form className="login-card request-card dev-gate" onSubmit={(e: FormEvent) => { e.preventDefault(); unlock.mutate() }}>
        <div className="stack" style={{ gap: 12 }}>
          <div>
            <div className="eyebrow">
              <Lock size={11} /> Developer panel
            </div>
            <h1 style={{ margin: 0 }}>Enter the developer password</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>Required once per sign-in session. This session, every file change and every design save will be logged and summarised.</p>
          </div>
          <div className="field">
            <label htmlFor="dev-pw">Developer password</label>
            <input id="dev-pw" className="input" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
          </div>
          <button className="btn primary lg" disabled={unlock.isPending || !pw}>
            <Unlock size={15} /> Unlock developer panel
          </button>
          <p className="muted small" style={{ margin: 0 }}>
            Forgot it? Reset it from <Link to="/dev/settings?reset=1">developer settings</Link> with your account password · <Link to="/admin">owner console</Link>
          </p>
        </div>
      </form>
    </main>
  )
}
