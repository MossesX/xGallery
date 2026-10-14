import { NavLink, Outlet } from 'react-router-dom'
import { Inbox, LayoutDashboard, Palette, SlidersHorizontal, Sparkles, UserCircle2, Users } from 'lucide-react'
import { useInboxUnread } from '../../api/hooks'
import { useMe } from '../../api/hooks'

const LINKS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Members', icon: Users },
  { to: '/admin/inbox', label: 'Inbox', icon: Inbox, ownerOnly: true, badge: 'inbox' },
  { to: '/admin/assistant', label: 'Assistant', icon: Sparkles, ownerOnly: true },
  { to: '/admin/themes', label: 'Themes', icon: Palette, ownerOnly: true },
  { to: '/admin/appearance', label: 'Site appearance', icon: SlidersHorizontal, ownerOnly: true },
]

export function AdminLayout() {
  const { data: me } = useMe()
  const { data: inbox } = useInboxUnread(me?.role === 'owner')
  return (
    <main className="page">
      <div className="admin-layout">
        <nav className="admin-nav">
          <div className="eyebrow" style={{ padding: '0 12px 8px' }}>
            {me?.role === 'owner' ? 'Owner console' : 'Administration'}
          </div>
          {LINKS.filter((l) => !l.ownerOnly || me?.role === 'owner').map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={16} /> {label}
              {badge === 'inbox' && !!inbox?.open && <span className="nav-badge">{inbox.open}</span>}
            </NavLink>
          ))}
          <div className="eyebrow" style={{ padding: '16px 12px 8px' }}>
            Personal
          </div>
          <NavLink to="/me">
            <UserCircle2 size={16} /> My space
          </NavLink>
        </nav>
        <div className="grow" style={{ minWidth: 0 }}>
          <Outlet />
        </div>
      </div>
    </main>
  )
}
