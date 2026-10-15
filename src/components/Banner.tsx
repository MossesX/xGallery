import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, Eye, Images, LogIn, LogOut, Search, Settings2, Sparkles, UserPlus } from 'lucide-react'
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
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  useEffect(() => setQ(params.get('q') ?? ''), [params])
  const s = data?.settings
  const tb = ui.toolbar

  const search = (e: FormEvent) => {
    e.preventDefault()
    navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : '/')
  }
  const navItems = ui.nav.items.filter((l) => l.enabled && visibleTo(l.show, user))

  return (
    <header className={`banner ${ui.banner.dense ? 'dense' : ''}`}>
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
