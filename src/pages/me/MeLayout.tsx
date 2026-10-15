import { NavLink, Outlet } from 'react-router-dom'
import { Bell, FolderOpen, Images, MessageCircle, Settings2, Sparkles, UserCircle2, Users } from 'lucide-react'
import { useMe, useNotifUnread, useUnread } from '../../api/hooks'

/** Every member's control panel: account, gallery, albums, buddies and messages. */
export function MeLayout() {
  const { data: me } = useMe()
  const { data: unread } = useUnread(!!me)
  const { data: notif } = useNotifUnread(!!me)
  const links = [
    { to: '/me', label: 'Profile', icon: UserCircle2, end: true },
    { to: '/me/gallery', label: 'Gallery page', icon: Sparkles },
    { to: '/me/galleries', label: 'My galleries', icon: FolderOpen },
    { to: '/me/albums', label: 'Albums', icon: Images },
    { to: '/me/buddies', label: 'Buddies', icon: Users, badge: unread?.requests },
    { to: '/me/messages', label: 'Messages', icon: MessageCircle, badge: unread?.messages },
    { to: '/me/notifications', label: 'Notifications', icon: Bell, badge: notif?.unread },
  ]
  return (
    <main className="page">
      <div className="admin-layout">
        <nav className="admin-nav">
          <div className="eyebrow" style={{ padding: '0 12px 8px' }}>
            My space
          </div>
          {links.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={16} /> {label}
              {!!badge && <span className="nav-badge">{badge}</span>}
            </NavLink>
          ))}
          {(me?.role === 'admin' || me?.role === 'owner') && (
            <>
              <div className="eyebrow" style={{ padding: '16px 12px 8px' }}>
                Administration
              </div>
              <NavLink to="/admin">
                <Settings2 size={16} /> Admin panel
              </NavLink>
            </>
          )}
        </nav>
        <div className="grow" style={{ minWidth: 0 }}>
          <Outlet />
        </div>
      </div>
    </main>
  )
}
