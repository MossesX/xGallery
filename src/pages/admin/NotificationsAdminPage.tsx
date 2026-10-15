import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, Check, Images, Inbox, KeyRound, Search, ShieldAlert, Trash2, UserPlus } from 'lucide-react'
import { api } from '../../api/client'
import { useNotifications, useNotifUnread } from '../../api/hooks'
import type { Notification } from '../../api/types'
import { timeAgo } from '../../lib/media'
import { useUI } from '../../store/ui'
import { AlbumBrowserModal } from '../../components/AlbumBrowserModal'

const KINDS = [
  { id: '', label: 'All types' },
  { id: 'album.', label: 'New albums' },
  { id: 'inbox.account_request', label: 'Account requests' },
  { id: 'inbox.password_reset', label: 'Password resets' },
  { id: 'inbox.contact', label: 'Messages to the owner' },
  { id: 'member.', label: 'Member milestones' },
  { id: 'security.', label: 'Security' },
  { id: 'github.', label: 'GitHub (runs, PRs, issues, releases)' },
]

export function kindIcon(kind: string) {
  if (kind.startsWith('album')) return <Images size={14} />
  if (kind.startsWith('security')) return <ShieldAlert size={14} />
  if (kind === 'inbox.password_reset') return <KeyRound size={14} />
  if (kind === 'inbox.account_request') return <UserPlus size={14} />
  if (kind.startsWith('inbox')) return <Inbox size={14} />
  return <Bell size={14} />
}

/** Target page for a notification, when it has one. */
export function notificationLink(n: Notification): string | null {
  const d = n.data as Record<string, unknown>
  if (n.kind === 'album.new' && d.slug) return `/album/${d.slug}`
  if (n.kind.startsWith('inbox.')) return '/admin/inbox'
  if (n.kind === 'member.first_login' && d.userId) return `/admin/activity?userId=${d.userId}`
  if (n.kind.startsWith('security.')) return '/admin/activity?kind=auth'
  if (n.kind === 'message.new' && d.fromId) return `/me/messages/${d.fromId}`
  if ((n.kind === 'comment.media' || n.kind === 'media.like' || n.kind === 'media.reaction') && d.albumSlug) return `/album/${d.albumSlug}${d.mediaId ? `?m=${d.mediaId}` : ''}`
  if (n.kind === 'comment.album' && d.slug) return `/album/${d.slug}`
  if (n.kind === 'comment.pending') return d.albumSlug ? `/album/${d.albumSlug}${d.mediaId ? `?m=${d.mediaId}` : ''}` : d.slug ? `/album/${d.slug}` : null
  if (n.kind.startsWith('buddy.')) return '/me/buddies'
  if (n.kind === 'album.shared' && d.slug) return `/album/${d.slug}`
  return null
}

/** Owner only: every admin notification, sortable, filterable and searchable. */
export function NotificationsAdminPage() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const [kind, setKind] = useState('')
  const [unread, setUnread] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(0)
  const [browse, setBrowse] = useState<number | null>(null)
  const limit = 40
  const { data, isLoading } = useNotifications({ kind, unread, q, sort, offset: page * limit, limit }, true)
  const { data: counts } = useNotifUnread()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] })
    qc.invalidateQueries({ queryKey: ['notif-unread'] })
    qc.invalidateQueries({ queryKey: ['new-albums'] })
  }
  const markRead = useMutation({ mutationFn: (ids: number[] | 'all') => api.put('/api/notifications/admin/read', ids === 'all' ? { kind } : { ids }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/notifications/admin/${id}`), onSuccess: refresh, onError: (e: Error) => notify(e.message, 'error') })
  const total = data?.total ?? 0

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow">Owner only</div>
          <h1 style={{ margin: 0 }}>
            <Bell size={22} /> Notifications
          </h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Everything that needs your eyes: new albums, account and password requests, member milestones and security alerts.
          </p>
        </div>
        <div className="side-stats" style={{ minWidth: 300 }}>
          <div>
            <strong>{counts?.admin?.total ?? 0}</strong>
            <span>unread</span>
          </div>
          <div>
            <strong>{counts?.admin?.albums ?? 0}</strong>
            <span>albums</span>
          </div>
          <div>
            <strong>{counts?.admin?.requests ?? 0}</strong>
            <span>requests</span>
          </div>
          <div>
            <strong>{counts?.admin?.security ?? 0}</strong>
            <span>security</span>
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="feed-search" style={{ minWidth: 240 }}>
          <Search size={14} />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Search notifications" aria-label="Search notifications" />
        </label>
        <select className="select" value={kind} onChange={(e) => { setKind(e.target.value); setPage(0) }} style={{ width: 'auto' }} aria-label="Type filter">
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto' }} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="unread">Unread first</option>
          <option value="kind">By type</option>
        </select>
        <label className="checkbox">
          <input type="checkbox" checked={unread} onChange={(e) => { setUnread(e.target.checked); setPage(0) }} /> Unread only
        </label>
        <button className="btn sm" onClick={() => markRead.mutate('all')} disabled={!counts?.admin?.total}>
          <Check size={13} /> Mark {kind ? 'these' : 'all'} read
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {isLoading && !data ? (
          <div className="muted small" style={{ padding: 16 }}>
            Loading…
          </div>
        ) : !data?.items.length ? (
          <div className="empty" style={{ margin: 12 }}>
            <BellOff size={32} strokeWidth={1.2} />
            <p style={{ marginTop: 8 }}>Nothing here.</p>
          </div>
        ) : (
          <div className="notif-list">
            {data.items.map((n) => {
              const link = notificationLink(n)
              const albumId = n.kind === 'album.new' ? Number((n.data as { albumId?: number }).albumId) : null
              return (
                <div key={n.id} className={`notif-row ${n.readAt ? '' : 'is-unread'}`}>
                  <span className={`notif-icon kind-${n.kind.split('.')[0]}`}>{kindIcon(n.kind)}</span>
                  <div className="notif-main">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <strong>{n.title}</strong>
                      <span className="chip chip-tag" style={{ fontSize: '0.6rem' }}>
                        {n.kind}
                      </span>
                      <span className="muted small">{timeAgo(n.createdAt)}</span>
                    </div>
                    {n.body && <div className="small muted">{n.body}</div>}
                  </div>
                  <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                    {albumId && (
                      <button className="btn sm" onClick={() => { setBrowse(albumId); if (!n.readAt) markRead.mutate([n.id]) }}>
                        <Images size={13} /> Browse
                      </button>
                    )}
                    {link && (
                      <Link to={link} className="btn ghost sm" onClick={() => !n.readAt && markRead.mutate([n.id])}>
                        Open
                      </Link>
                    )}
                    {!n.readAt && (
                      <button className="btn ghost icon sm" title="Mark read" onClick={() => markRead.mutate([n.id])}>
                        <Check size={14} />
                      </button>
                    )}
                    <button className="btn ghost icon sm danger" title="Delete" onClick={() => remove.mutate(n.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {total > limit && (
          <div className="row between" style={{ padding: 12, borderTop: '1px solid var(--c-border)' }}>
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Newer
            </button>
            <span className="muted small">
              {page * limit + 1}–{Math.min(total, (page + 1) * limit)} of {total}
            </span>
            <button className="btn sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(page + 1)}>
              Older
            </button>
          </div>
        )}
      </div>
      <AlbumBrowserModal albumId={browse} onClose={() => setBrowse(null)} />
    </div>
  )
}
