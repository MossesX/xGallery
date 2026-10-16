import { NavLink, Outlet } from 'react-router-dom'
import { Activity, Bell, Code2, FolderTree, Images, Inbox, LayoutDashboard, ListTodo, ShieldCheck, Sparkles, UserCircle2, Users } from 'lucide-react'
import { useInboxUnread, useNotifUnread } from '../../api/hooks'
import { useMe } from '../../api/hooks'

const LINKS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Members', icon: Users },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell, ownerOnly: true, badge: 'notif' },
  { to: '/admin/new-albums', label: 'New albums', icon: Images, ownerOnly: true, badge: 'albums' },
  { to: '/admin/tree', label: 'Gallery browser', icon: FolderTree, ownerOnly: true },
  { to: '/admin/policies', label: 'Policies', icon: ShieldCheck, ownerOnly: true },
  { to: '/admin/inbox', label: 'Inbox', icon: Inbox, ownerOnly: true, badge: 'inbox' },
  { to: '/admin/assistant', label: 'Assistant', icon: Sparkles, ownerOnly: true },
  { to: '/admin/activity', label: 'Activity', icon: Activity, ownerOnly: true },
  { to: '/dev/tasks/workspace', label: 'Tasks & notes', icon: ListTodo, ownerOnly: true },
]

export function AdminLayout() {
  const { data: me } = useMe()
  const { data: inbox } = useInboxUnread(me?.role === 'owner')
  const { data: notif } = useNotifUnread(me?.role === 'owner')
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
              {badge === 'notif' && !!notif?.admin?.total && <span className="nav-badge">{notif.admin.total}</span>}
              {badge === 'albums' && !!notif?.admin?.albums && <span className="nav-badge">{notif.admin.albums}</span>}
            </NavLink>
          ))}
          {me?.role === 'owner' && (
            <>
              <div className="eyebrow" style={{ padding: '16px 12px 8px' }}>
                Build
              </div>
              <NavLink to="/dev">
                <Code2 size={16} /> Developer panel
              </NavLink>
            </>
          )}
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
