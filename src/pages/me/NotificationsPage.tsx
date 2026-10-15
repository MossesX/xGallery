import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, Check, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import { useNotifications } from '../../api/hooks'
import { Avatar } from '../../components/Avatar'
import { notificationLink } from '../admin/NotificationsAdminPage'
import { timeAgo } from '../../lib/media'

const KINDS = [
  { id: '', label: 'Everything' },
  { id: 'media.', label: 'Likes & reactions' },
  { id: 'comment.', label: 'Comments' },
  { id: 'buddy.', label: 'Buddies' },
  { id: 'message.', label: 'Messages' },
  { id: 'album.', label: 'Shared albums' },
]

/** A member's notifications: likes, reactions, comments, buddies, messages, shared albums. */
export function NotificationsPage() {
  const qc = useQueryClient()
  const [kind, setKind] = useState('')
  const [unread, setUnread] = useState(false)
  const { data, isLoading } = useNotifications({ kind, unread, limit: 100 })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] })
    qc.invalidateQueries({ queryKey: ['notif-unread'] })
  }
  const markRead = useMutation({ mutationFn: (ids: number[] | 'all') => api.put('/api/notifications/read', ids === 'all' ? {} : { ids }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/notifications/${id}`), onSuccess: refresh })
  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 2)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow">Activity on your things</div>
          <h1 style={{ margin: 0 }}>
            <Bell size={22} /> Notifications
          </h1>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto' }} aria-label="Type">
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <label className="checkbox">
            <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /> Unread only
          </label>
          <button className="btn sm" onClick={() => markRead.mutate('all')}>
            <Check size={13} /> Mark all read
          </button>
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {isLoading ? null : !data?.items.length ? (
          <div className="empty" style={{ margin: 12 }}>
            <BellOff size={32} strokeWidth={1.2} />
            <p style={{ marginTop: 8 }}>You are all caught up.</p>
          </div>
        ) : (
          <div className="notif-list">
            {data.items.map((n) => {
              const link = notificationLink(n)
              return (
                <div key={n.id} className={`notif-row ${n.readAt ? '' : 'is-unread'}`}>
                  {n.actor ? <Avatar name={n.actor.displayName} size={32} /> : <span className="notif-icon"><Bell size={14} /></span>}
                  <div className="notif-main">
                    <strong>{n.title}</strong>
                    {n.body && <div className="small muted clamp-2">{n.body}</div>}
                    <div className="muted small">{timeAgo(n.createdAt)}</div>
                  </div>
                  <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                    {link && (
                      <Link to={link} className="btn sm" onClick={() => !n.readAt && markRead.mutate([n.id])}>
                        Open
                      </Link>
                    )}
                    {!n.readAt && (
                      <button className="btn ghost icon sm" title="Mark read" onClick={() => markRead.mutate([n.id])}>
                        <Check size={14} />
                      </button>
                    )}
                    <button className="btn ghost icon sm" title="Delete" onClick={() => remove.mutate(n.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
