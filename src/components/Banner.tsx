import { useEffect, useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, Bookmark, Eye, Images, LayoutGrid, LogIn, LogOut, MessageCircle, Search, Settings2, Sparkles, UserPlus } from 'lucide-react'
import { useAiStatus, useLogout, useMe, useNotifUnread, useSession, useSettings, useUnread } from '../api/hooks'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { ColorModeToggle } from './ColorModeToggle'
import { useUI } from '../store/ui'
import { AmberMark } from '../brand/Logo'
import { Avatar } from './Avatar'

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

/** The AmberX toolbar shared by every page: mark, wordmark, navigation, live clock, theme and sign-in. */
export function Banner() {
  const { data: user } = useMe()
  const { data: unread } = useUnread(!!user)
  const { data: ai } = useAiStatus(!!user)
  const { data: session } = useSession(!!user)
  const { data: notif } = useNotifUnread(!!user)
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

  const search = (e: FormEvent) => {
    e.preventDefault()
    navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : '/')
  }

  return (
    <header className="banner">
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
            <AmberMark size={30} accent="#ff7a1a" />
          </span>
          <span className="banner-word">
            <span className="banner-amberx">
              Amber<span className="x">X</span>
            </span>
            <span className="banner-product">{s?.siteTitle ?? 'xGallery'}</span>
          </span>
        </Link>
        <nav className="banner-nav">
          <NavLink to="/" end>
            {user ? 'Home' : 'Explore'}
          </NavLink>
          <NavLink to={user ? '/galleries' : '/public'}>{user ? 'Galleries' : 'People'}</NavLink>
          {user && (
            <NavLink to="/photos">
              <LayoutGrid size={13} /> Photos
            </NavLink>
          )}
          {user && (
            <NavLink to="/favorites">
              <Bookmark size={13} /> Saved
            </NavLink>
          )}
          {user && (
            <NavLink to="/me/messages" className="banner-msgs">
              <MessageCircle size={13} /> Messages
              {!!unread?.messages && <span className="nav-badge">{unread.messages}</span>}
            </NavLink>
          )}
          {(user?.role === 'admin' || user?.role === 'owner') && (
            <NavLink to="/admin">
              <Settings2 size={13} /> Admin
            </NavLink>
          )}
        </nav>
        {user && (
          <form className="search banner-search" onSubmit={search} role="search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search albums, tags…" aria-label="Search" />
          </form>
        )}
        <div className="banner-right">
          <Clock />
          {user && (
            <NavLink to="/me/notifications" className="btn ghost icon sm banner-bell" title="Notifications" aria-label="Notifications">
              <Bell size={16} />
              {!!notif?.unread && <span className="nav-badge bell-badge">{notif.unread}</span>}
            </NavLink>
          )}
          {user?.role === 'owner' && (
            <NavLink to="/admin/new-albums" className="btn ghost icon sm banner-bell" title="New albums" aria-label="New albums">
              <Images size={16} />
              {!!notif?.admin?.albums && <span className="nav-badge bell-badge">{notif.admin.albums}</span>}
            </NavLink>
          )}
          {user?.role === 'owner' && (
            <NavLink to="/admin/notifications" className="btn ghost icon sm banner-bell" title="Admin notifications" aria-label="Admin notifications">
              <Settings2 size={16} />
              {!!notif?.admin?.total && <span className="nav-badge bell-badge">{notif.admin.total}</span>}
            </NavLink>
          )}
          {user && ai?.allowed && (
            <button className="btn sm banner-ai" onClick={() => openAssistant({ context: { url: location.pathname, title: document.title } })} title={`${ai.assistantName} · Ctrl/⌘ J`}>
              <Sparkles size={14} /> {ai.assistantName}
            </button>
          )}
          <ColorModeToggle />
          {user ? (
            <>
              <NavLink to="/me" className="banner-user" title={`${user.display_name} · My space`}>
                <Avatar name={user.display_name} size={28} src={user.avatarUrl} />
                <span className="banner-username">{user.display_name.split(' ')[0]}</span>
              </NavLink>
              <button className="btn sm" onClick={() => logout.mutateAsync().then(() => navigate('/'))} title="Sign out">
                <LogOut size={13} /> Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/request-account" className="btn sm banner-request" title="Request an account">
                <UserPlus size={13} /> Request account
              </Link>
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
  const s = data?.settings
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span className="row" style={{ gap: 8 }}>
          <AmberMark size={16} accent="#ff7a1a" /> {s?.siteTitle ?? 'xGallery'} · {s?.tagline}
        </span>
        <span className="row" style={{ gap: 14 }}>
          <Link to="/public">Public galleries</Link>
          {user ? (
            <>
              <Link to="/me">My space</Link>
              <Link to="/contact">Contact the owner</Link>
            </>
          ) : (
            <>
              <Link to="/request-account">Request an account</Link>
              <Link to="/login">Member sign in</Link>
            </>
          )}
          <span className="muted">Powered by {s?.brandName ?? 'AmberX'}</span>
        </span>
      </div>
    </footer>
  )
}
