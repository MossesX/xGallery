import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, Code2, Eye, FlaskConical, Images, ListTodo, LogIn, LogOut, Menu as MenuIcon, Palette, Search, Settings, Settings2, ShieldCheck, Sparkles, UserCog, UserPlus, Users, X } from 'lucide-react'
import { useAiStatus, useLogout, useMe, useNotifUnread, useSession, useSettings, useUnread } from '../api/hooks'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { ColorModeToggle } from './ColorModeToggle'
import { useUI } from '../store/ui'
import { AmberMark } from '../brand/Logo'
import { Avatar } from './Avatar'
import { UiIcon, useUiConfig, visibleTo } from '../ui/config'
import type { UiLink } from '../api/dev'

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="clock" aria-live="off" title={now.toLocaleString()}>
      <span className="clock-date">{now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
      <span className="clock-time">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
    </div>
  )
}

const external = (to: string) => /^(https?:)?\/\//i.test(to) || to.startsWith('mailto:')

/** Where the settings gear leads: the owner console for owners and admins, plus the account's own settings. */
export function settingsEntries(role: string | undefined): { to: string; label: string; icon: React.ReactNode }[] {
  if (role === 'owner') {
    return [
      { to: '/admin', label: 'Owner console', icon: <Settings size={15} /> },
      { to: '/admin/users', label: 'Members & roles', icon: <Users size={15} /> },
      { to: '/admin/policies', label: 'Policies & switches', icon: <ShieldCheck size={15} /> },
      { to: '/admin/assistant', label: 'Assistant settings', icon: <Sparkles size={15} /> },
      { to: '/dev/themes', label: 'Themes & appearance', icon: <Palette size={15} /> },
      { to: '/dev', label: 'Developer panel', icon: <Code2 size={15} /> },
      { to: '/dev/tasks/workspace', label: 'Tasks & notes', icon: <ListTodo size={15} /> },
      { to: '/me', label: 'My account', icon: <UserCog size={15} /> },
    ]
  }
  if (role === 'admin') {
    return [
      { to: '/admin', label: 'Admin console', icon: <Settings size={15} /> },
      { to: '/admin/users', label: 'Members', icon: <Users size={15} /> },
      { to: '/me/gallery', label: 'My gallery settings', icon: <Palette size={15} /> },
      { to: '/me', label: 'My account', icon: <UserCog size={15} /> },
    ]
  }
  return []
}

/** The settings gear in the toolbar (owner and admins): a small menu of every settings page. */
function SettingsGear({ role }: { role: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 64, left: 12 })
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()
  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const entries = settingsEntries(role)
  if (!entries.length) return null
  return (
    <div className="settings-gear" ref={ref} data-settings-gear={open ? 'open' : 'closed'}>
      <button
        className={`btn ghost icon sm banner-bell ${open ? 'active' : ''}`}
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setPos({ top: Math.round(r.bottom) + 8, left: Math.max(12, Math.min(Math.round(r.right) - 260, window.innerWidth - 272)) })
          setOpen((o) => !o)
        }}
        data-settings-gear-btn=""
      >
        <Settings size={16} />
      </button>
      {open && (
        <div className="banner-menu-panel settings-menu-panel" role="menu" style={{ top: pos.top, left: pos.left }} data-settings-menu="">
          <div className="banner-menu-section">
            <div className="eyebrow">Settings</div>
            {entries.map((e) => (
              <NavLink key={e.to} to={e.to} className="banner-menu-item" end={e.to === '/admin' || e.to === '/me' || e.to === '/dev'} onClick={() => setOpen(false)}>
                {e.icon} {e.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** A configured link: router link for paths, plain anchor for URLs. */
export function UiLinkEl({ link, className, children }: { link: UiLink; className?: string; children?: React.ReactNode }) {
  const content = children ?? (
    <>
      <UiIcon name={link.icon} /> {link.label}
    </>
  )
  if (external(link.to) || link.newTab) {
    return (
      <a href={link.to} className={className} target={link.newTab ? '_blank' : undefined} rel={link.newTab ? 'noopener noreferrer' : undefined}>
        {content}
      </a>
    )
  }
  return (
    <NavLink to={link.to} className={className} end={link.to === '/'}>
      {content}
    </NavLink>
  )
}

/** The AmberX toolbar shared by every page: brand, navigation, clock, toolbar controls and account — all configurable from the developer panel. */
export function Banner() {
  const { data: user } = useMe()
  const { data: unread } = useUnread(!!user)
  const { data: ai } = useAiStatus(!!user)
  const { data: session } = useSession(!!user)
  const { data: notif } = useNotifUnread(!!user)
  const ui = useUiConfig()
  const qc = useQueryClient()
  const returnToOwner = () => api.post('/api/auth/return', {}).then(() => { qc.clear(); window.location.assign('/admin/users') })
  const openAssistant = useUI((s) => s.openAssistant)
  const { data } = useSettings()
  const logout = useLogout()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  useEffect(() => setQ(params.get('q') ?? ''), [params])
  const s = data?.settings
  const tb = ui.toolbar
  const [menu, setMenu] = useState(false)
  const [menuTop, setMenuTop] = useState(64)
  const menuRef = useRef<HTMLDivElement>(null)
  const toggleMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    // The panel is fixed to the viewport (the banner wraps on phones), just under the button that opened it.
    setMenuTop(Math.round(e.currentTarget.getBoundingClientRect().bottom) + 8)
    setMenu((m) => !m)
  }
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])
  useEffect(() => setMenu(false), [location.pathname])

  const search = (e: FormEvent) => {
    e.preventDefault()
    navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : '/')
  }
  const navItems = ui.nav.items.filter((l) => l.enabled && visibleTo(l.show, user))

  return (
    <header className={`banner ${ui.banner.dense ? 'dense' : ''}`}>
      {session?.sandbox && user && (
        <div className="viewing-bar sandbox-bar" data-sandbox-bar="">
          <FlaskConical size={13} /> <strong>Sandbox</strong> · you have full owner control here, but only you see what you change; the live site stays as it is{session.sandbox.createdAt ? ` (copy taken ${new Date(session.sandbox.createdAt).toLocaleString()})` : ''}.
          <button className="btn sm" onClick={() => { if (window.confirm('Throw away everything you changed in this sandbox and start again from the live site?')) api.post('/api/auth/sandbox/reset', {}).then(() => { qc.clear(); window.location.assign('/') }) }} data-sandbox-reset="">
            Reset to the live site
          </button>
        </div>
      )}
      {session?.viewingAs && user && (
        <div className="viewing-bar">
          <Eye size={13} /> Viewing as <strong>{user.display_name}</strong> (@{user.username}) · what they see is what you see
          <button className="btn sm" onClick={returnToOwner}>
            Return to {session.viewingAs.owner.displayName}
          </button>
        </div>
      )}
      <div className="banner-inner">
        <Link to="/" className="banner-brand" aria-label={s?.brandName ?? 'AmberX'}>
          <span className="banner-logo">
            <AmberMark size={30} accent={ui.banner.accent} />
          </span>
          <span className="banner-word">
            {ui.banner.brand === 'amberx' ? (
              <span className="banner-amberx">
                Amber<span className="x" style={{ color: ui.banner.accent }}>X</span>
              </span>
            ) : (
              <span className="banner-amberx">{s?.siteTitle ?? 'xGallery'}</span>
            )}
            {ui.banner.showProduct && ui.banner.brand === 'amberx' && <span className="banner-product">{s?.siteTitle ?? 'xGallery'}</span>}
          </span>
        </Link>
        <nav className="banner-nav">
          {navItems.map((l) => (
            <UiLinkEl key={l.id} link={l} className={l.to === '/me/messages' ? 'banner-msgs' : undefined}>
              <UiIcon name={l.icon} /> {l.label}
              {l.to === '/me/messages' && !!unread?.messages && <span className="nav-badge">{unread.messages}</span>}
              {l.to === '/admin' && !!notif?.admin?.total && user?.role === 'owner' && <span className="nav-badge">{notif.admin.total}</span>}
            </UiLinkEl>
          ))}
        </nav>
        {user && tb.search && (
          <form className="search banner-search" onSubmit={search} role="search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search albums, tags…" aria-label="Search" />
          </form>
        )}
        <div className="banner-right">
          {tb.clock && <Clock />}
          {tb.buttons.filter((b) => b.enabled && visibleTo(b.show, user)).map((b) => (
            <UiLinkEl key={b.id} link={b} className="btn sm banner-custom" />
          ))}
          {user && tb.bell && (
            <NavLink to="/me/notifications" className="btn ghost icon sm banner-bell" title="Notifications" aria-label="Notifications">
              <Bell size={16} />
              {!!notif?.unread && <span className="nav-badge bell-badge">{notif.unread}</span>}
            </NavLink>
          )}
          {user?.role === 'owner' && tb.newAlbums && (
            <NavLink to="/admin/new-albums" className="btn ghost icon sm banner-bell" title="New albums" aria-label="New albums">
              <Images size={16} />
              {!!notif?.admin?.albums && <span className="nav-badge bell-badge">{notif.admin.albums}</span>}
            </NavLink>
          )}
          {user?.role === 'owner' && tb.adminBell && (
            <NavLink to="/admin/notifications" className="btn ghost icon sm banner-bell" title="Admin notifications" aria-label="Admin notifications">
              <Settings2 size={16} />
              {!!notif?.admin?.total && <span className="nav-badge bell-badge">{notif.admin.total}</span>}
            </NavLink>
          )}
          {user && (user.role === 'owner' || user.role === 'admin') && tb.settings && <SettingsGear role={user.role} />}
          {user && ai?.allowed && tb.assistant && (
            <button className="btn sm banner-ai" onClick={() => openAssistant({ context: { url: location.pathname, title: document.title } })} title={`${ai.assistantName} · Ctrl/⌘ J`}>
              <Sparkles size={14} /> {ai.assistantName}
            </button>
          )}
          {tb.colorMode && <ColorModeToggle />}
          {user ? (
            <>
              <NavLink to="/me" className="banner-user" title={`${user.display_name} · My space`}>
                <Avatar name={user.display_name} size={28} src={user.avatarUrl} />
                <span className="banner-username">{user.display_name.split(' ')[0]}</span>
              </NavLink>
              {tb.signOut && (
                <button className="btn sm" onClick={() => logout.mutateAsync().then(() => navigate('/'))} title="Sign out">
                  <LogOut size={13} /> Sign out
                </button>
              )}
            </>
          ) : (
            <>
              {ui.flags.requestAccount !== false && (
                <Link to="/request-account" className="btn sm banner-request" title="Request an account">
                  <UserPlus size={13} /> Request account
                </Link>
              )}
              <Link to="/login" className="btn primary sm banner-login">
                <LogIn size={13} /> Sign in
              </Link>
            </>
          )}
        </div>
        <div className="banner-menu" ref={menuRef} data-banner-menu={menu ? 'open' : 'closed'}>
          <button className="btn ghost icon sm banner-menu-btn" onClick={toggleMenu} aria-label="Menu" aria-expanded={menu} title="Menu" data-banner-menu-btn="">
            {menu ? <X size={18} /> : <MenuIcon size={18} />}
            {!menu && !!(unread?.messages || notif?.unread || (user?.role === 'owner' && notif?.admin?.total)) && <span className="nav-badge bell-badge" />}
          </button>
          {menu && (
            <div className="banner-menu-panel" role="menu" style={{ top: menuTop, maxHeight: `calc(100vh - ${menuTop + 12}px)` }} data-banner-menu-panel="">
              {navItems.length > 0 && (
                <div className="banner-menu-section">
                  <div className="eyebrow">Go to</div>
                  {navItems.map((l) => (
                    <UiLinkEl key={l.id} link={l} className="banner-menu-item">
                      <UiIcon name={l.icon} /> {l.label}
                      {l.to === '/me/messages' && !!unread?.messages && <span className="nav-badge">{unread.messages}</span>}
                      {l.to === '/admin' && !!notif?.admin?.total && user?.role === 'owner' && <span className="nav-badge">{notif.admin.total}</span>}
                    </UiLinkEl>
                  ))}
                </div>
              )}
              {user && (tb.bell || (user.role === 'owner' && (tb.newAlbums || tb.adminBell)) || (ai?.allowed && tb.assistant) || tb.buttons.some((b) => b.enabled && visibleTo(b.show, user))) && (
                <div className="banner-menu-section">
                  <div className="eyebrow">Tools</div>
                  {tb.bell && (
                    <NavLink to="/me/notifications" className="banner-menu-item">
                      <Bell size={15} /> Notifications {!!notif?.unread && <span className="nav-badge">{notif.unread}</span>}
                    </NavLink>
                  )}
                  {user.role === 'owner' && tb.newAlbums && (
                    <NavLink to="/admin/new-albums" className="banner-menu-item">
                      <Images size={15} /> New albums {!!notif?.admin?.albums && <span className="nav-badge">{notif.admin.albums}</span>}
                    </NavLink>
                  )}
                  {user.role === 'owner' && tb.adminBell && (
                    <NavLink to="/admin/notifications" className="banner-menu-item">
                      <Settings2 size={15} /> Admin notifications {!!notif?.admin?.total && <span className="nav-badge">{notif.admin.total}</span>}
                    </NavLink>
                  )}
                  {ai?.allowed && tb.assistant && (
                    <button className="banner-menu-item" onClick={() => { setMenu(false); openAssistant({ context: { url: location.pathname, title: document.title } }) }}>
                      <Sparkles size={15} /> {ai.assistantName}
                    </button>
                  )}
                  {tb.buttons.filter((b) => b.enabled && visibleTo(b.show, user)).map((b) => (
                    <UiLinkEl key={b.id} link={b} className="banner-menu-item" />
                  ))}
                </div>
              )}
              {user && tb.settings && settingsEntries(user.role).length > 0 && (
                <div className="banner-menu-section" data-banner-menu-settings="">
                  <div className="eyebrow">Settings</div>
                  {settingsEntries(user.role).map((e) => (
                    <NavLink key={e.to} to={e.to} className="banner-menu-item" end={e.to === '/admin' || e.to === '/me' || e.to === '/dev'}>
                      {e.icon} {e.label}
                    </NavLink>
                  ))}
                </div>
              )}
              <div className="banner-menu-section">
                <div className="eyebrow">Account</div>
                {user ? (
                  <>
                    <NavLink to="/me" className="banner-menu-item">
                      <Avatar name={user.display_name} size={20} src={user.avatarUrl} /> {user.display_name}
                    </NavLink>
                    {tb.colorMode && (
                      <div className="banner-menu-item static">
                        <ColorModeToggle /> <span>Light / dark</span>
                      </div>
                    )}
                    {tb.signOut && (
                      <button className="banner-menu-item" onClick={() => logout.mutateAsync().then(() => navigate('/'))}>
                        <LogOut size={15} /> Sign out
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {tb.colorMode && (
                      <div className="banner-menu-item static">
                        <ColorModeToggle /> <span>Light / dark</span>
                      </div>
                    )}
                    {ui.flags.requestAccount !== false && (
                      <Link to="/request-account" className="banner-menu-item">
                        <UserPlus size={15} /> Request account
                      </Link>
                    )}
                    <Link to="/login" className="banner-menu-item">
                      <LogIn size={15} /> Sign in
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

export function Footer() {
  const { data: user } = useMe()
  const { data } = useSettings()
  const ui = useUiConfig()
  const s = data?.settings
  const links = ui.footer.links.filter((l) => l.enabled && visibleTo(l.show, user))
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span className="row" style={{ gap: 8 }}>
          <AmberMark size={16} accent={ui.banner.accent} /> {ui.footer.text || `${s?.siteTitle ?? 'xGallery'} · ${s?.tagline ?? ''}`}
        </span>
        <span className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          {links.map((l) => (
            <UiLinkEl key={l.id} link={l}>
              {l.label}
            </UiLinkEl>
          ))}
          {ui.footer.poweredBy && <span className="muted">Powered by {s?.brandName ?? 'AmberX'}</span>}
        </span>
      </div>
    </footer>
  )
}
