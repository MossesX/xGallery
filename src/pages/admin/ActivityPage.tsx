import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Database, Download, Search, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import { useActivity, useActivityKinds, useActivityPartitions } from '../../api/hooks'
import type { ActivityEvent } from '../../api/types'
import { formatBytes, timeAgo } from '../../lib/media'
import { useUI } from '../../store/ui'

/** Human wording for an event kind. */
export function describeEvent(e: ActivityEvent, users: Record<number, { username: string; displayName: string }>): string {
  const who = (id: number | null) => (id != null ? (users[id]?.displayName ?? `#${id}`) : 'Visitor')
  const target = e.targetLabel ? `“${e.targetLabel}”` : e.targetId != null ? `#${e.targetId}` : ''
  const d = e.detail as Record<string, string | number | boolean | undefined>
  switch (e.kind) {
    case 'auth.login':
      return `${who(e.userId)} signed in`
    case 'auth.login_failed':
      return `Failed sign-in as ${e.targetLabel || '?'}`
    case 'auth.logout':
      return `${who(e.userId)} signed out`
    case 'profile.update':
      return `${who(e.userId)} updated their profile`
    case 'profile.avatar':
      return `${who(e.userId)} changed their picture`
    case 'profile.password_changed':
      return `${who(e.userId)} changed their password`
    case 'album.create':
      return `${who(e.actorId)} created album ${target}${d.public ? ' (public)' : ''}`
    case 'album.update':
      return `${who(e.actorId)} edited album ${target}`
    case 'album.visibility':
      return `${who(e.actorId)} set album ${target} from ${d.from} to ${d.to}`
    case 'album.delete':
      return `${who(e.actorId)} deleted album ${target}`
    case 'album.favorite':
      return `${who(e.actorId)} saved album ${target}`
    case 'album.unfavorite':
      return `${who(e.actorId)} unsaved album ${target}`
    case 'album.link_create':
      return `${who(e.actorId)} created a private link for album #${e.targetId}${d.label ? ` (${d.label})` : ''}`
    case 'album.link_revoke':
      return `${who(e.actorId)} revoked a private link on album #${e.targetId}`
    case 'album.link_view':
      return `${who(e.userId)} viewed album ${target} through a private link`
    case 'media.upload':
      return `${who(e.actorId)} uploaded ${d.kind ?? 'media'} ${target} (${formatBytes(Number(d.size ?? 0))})`
    case 'media.delete':
      return `${who(e.actorId)} deleted media ${target}`
    case 'media.like':
      return `${who(e.actorId)} liked ${target}`
    case 'media.unlike':
      return `${who(e.actorId)} unliked ${target}`
    case 'comment.album':
    case 'comment.media':
      return `${who(e.actorId)} commented on ${target}: ${d.body ?? ''}`
    case 'buddy.request':
      return `${who(e.actorId)} sent a buddy request to @${e.targetLabel}`
    case 'buddy.accept':
      return `${who(e.actorId)} accepted a buddy request from @${e.targetLabel}`
    case 'buddy.remove':
      return `${who(e.actorId)} removed buddy #${e.targetId}`
    case 'message.send':
      return `${who(e.actorId)} messaged @${e.targetLabel}`
    case 'ai.turn':
      return `${who(e.userId)} asked the assistant (${d.backend}): ${d.prompt ?? ''}`
    case 'inbox.account_request':
      return `Account request from ${e.targetLabel} (${[d.email, d.phone].filter(Boolean).join(', ')})`
    case 'inbox.contact':
      return `${who(e.userId)} wrote to the owner`
    case 'admin.user_create':
      return `${who(e.actorId)} created account @${e.targetLabel} (${d.role})`
    case 'admin.user_generate':
      return `${who(e.actorId)} generated account @${e.targetLabel}`
    case 'admin.user_update':
      return `${who(e.actorId)} changed ${who(e.userId)}: ${Array.isArray(e.detail.fields) ? (e.detail.fields as string[]).join(', ') : ''}`
    case 'admin.user_password_reset':
      return `${who(e.actorId)} reset the password of ${who(e.userId)}`
    case 'admin.user_signout':
      return `${who(e.actorId)} signed ${who(e.userId)} out everywhere`
    case 'admin.user_delete':
      return `${who(e.actorId)} deleted account @${e.targetLabel}`
    case 'admin.user_bulk':
      return `${who(e.actorId)} bulk-changed ${who(e.userId)}: ${JSON.stringify(e.detail.patch ?? {})}`
    case 'admin.impersonate':
      return `${who(e.actorId)} signed in as @${e.targetLabel}`
    case 'admin.impersonate_end':
      return `${who(e.actorId)} returned from viewing as @${e.targetLabel}`
    case 'admin.request_approve':
      return `${who(e.actorId)} approved an account request, created @${e.targetLabel}`
    default:
      return `${who(e.actorId ?? e.userId)} · ${e.kind} ${target}`
  }
}

export function EventRow({ e, users }: { e: ActivityEvent; users: Record<number, { username: string; displayName: string }> }) {
  const group = e.kind.split('.')[0]
  return (
    <div className={`event-row kind-${group}`}>
      <div className="event-time muted small" title={new Date(e.ts).toLocaleString()}>
        {timeAgo(e.ts)}
      </div>
      <div className="event-main">
        <span className={`chip chip-tag event-kind`}>{e.kind}</span> {describeEvent(e, users)}
        {e.userId != null && users[e.userId] && (
          <>
            {' '}
            <Link to={`/admin/activity?userId=${e.userId}`} className="muted small">
              @{users[e.userId].username}
            </Link>
          </>
        )}
      </div>
      <div className="event-ip muted small">{e.ip}</div>
    </div>
  )
}

/** Owner only: the global activity log across the monthly partitions, with filters and storage overview. */
export function ActivityPage() {
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const userId = params.get('userId') ? Number(params.get('userId')) : undefined
  const kind = params.get('kind') ?? ''
  const q = params.get('q') ?? ''
  const [search, setSearch] = useState(q)
  const [pages, setPages] = useState<number[]>([])
  const before = pages[pages.length - 1]
  const { data, isLoading } = useActivity({ userId, kind, q, before })
  const { data: kindsList } = useActivityKinds()
  const { data: parts } = useActivityPartitions()
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: { id: number; username: string; display_name: string }[] }>('/api/users').then((r) => r.users) })
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
    setPages([])
  }
  const remove = useMutation({
    mutationFn: (month: string) => api.del(`/api/activity/partitions/${month}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity'] })
      notify('Month deleted')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const exportUrl = `/api/activity/export.csv?${new URLSearchParams({ ...(from ? { from: String(new Date(from + 'T00:00:00').getTime()) } : {}), ...(to ? { to: String(new Date(to + 'T23:59:59.999').getTime()) } : {}), ...(userId ? { userId: String(userId) } : {}), ...(kind ? { kind } : {}) }).toString()}`
  const totalBytes = (parts ?? []).reduce((n, p) => n + p.bytes, 0)
  const totalEvents = (parts ?? []).reduce((n, p) => n + p.events, 0)

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow">Owner only</div>
          <h1 style={{ margin: 0 }}>
            <Activity size={22} /> Activity
          </h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Everything that happens on the site, stored one file per month outside the main database.
          </p>
        </div>
        <div className="side-stats" style={{ minWidth: 260 }}>
          <div>
            <strong>{totalEvents}</strong>
            <span>events</span>
          </div>
          <div>
            <strong>{parts?.length ?? 0}</strong>
            <span>months</span>
          </div>
          <div>
            <strong>{formatBytes(totalBytes)}</strong>
            <span>on disk</span>
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <form
          className="feed-search"
          style={{ minWidth: 260 }}
          onSubmit={(e) => {
            e.preventDefault()
            set('q', search.trim())
          }}
        >
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search labels, details, IPs" aria-label="Search activity" />
        </form>
        <select className="select" value={kind} onChange={(e) => set('kind', e.target.value)} style={{ width: 'auto' }} aria-label="Kind filter">
          <option value="">All kinds</option>
          {['auth', 'album', 'media', 'comment', 'buddy', 'message', 'profile', 'ai', 'inbox', 'admin'].map((g) => (
            <option key={g} value={g}>
              {g}.*
            </option>
          ))}
          {(kindsList ?? []).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select className="select" value={userId ?? ''} onChange={(e) => set('userId', e.target.value)} style={{ width: 'auto' }} aria-label="Account filter">
          <option value="">Every account</option>
          {(users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name} (@{u.username})
            </option>
          ))}
        </select>
        {(userId || kind || q) && (
          <button className="btn ghost sm" onClick={() => { setSearch(''); setParams({}, { replace: true }); setPages([]) }}>
            Clear filters
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {isLoading && !data ? (
          <div className="muted small" style={{ padding: 16 }}>
            Loading…
          </div>
        ) : !data?.events.length ? (
          <div className="empty" style={{ margin: 12 }}>
            No activity recorded yet.
          </div>
        ) : (
          <div className="event-list">
            {data.events.map((e) => (
              <EventRow e={e} users={data.users} key={`${e.partition}-${e.id}`} />
            ))}
          </div>
        )}
        {(pages.length > 0 || data?.nextBefore) && (
          <div className="row between" style={{ padding: 12, borderTop: '1px solid var(--c-border)' }}>
            <button className="btn sm" disabled={pages.length === 0} onClick={() => setPages(pages.slice(0, -1))}>
              Newer
            </button>
            <span className="muted small">
              {data?.events.length ?? 0} per page{pages.length ? ` · page ${pages.length + 1}` : ''}
            </span>
            <button className="btn sm" disabled={!data?.nextBefore} onClick={() => data?.nextBefore && setPages([...pages, data.nextBefore])}>
              Older
            </button>
          </div>
        )}
      </div>

      <section className="card stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>
          <Download size={15} /> Export to CSV
        </h3>
        <p className="muted small" style={{ margin: 0 }}>Pick a date range (inclusive). The current account and kind filters above are applied too. Opens in a spreadsheet; up to 100,000 rows.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field">
            <span className="small">From</span>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          </label>
          <label className="field">
            <span className="small">To</span>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </label>
          <a className="btn primary" href={exportUrl} download>
            <Download size={14} /> Download CSV
          </a>
        </div>
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>
          <Database size={15} /> Storage
        </h3>
        <p className="muted small" style={{ margin: 0 }}>
          Each month is its own SQLite file under <code>data/activity/</code>. The main database never grows with activity. Delete old months you no longer need; the current month cannot be deleted.
        </p>
        {!parts?.length ? (
          <div className="muted small">No activity files yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th>File</th>
                <th>Events</th>
                <th>Size</th>
                <th style={{ textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p, i) => (
                <tr key={p.month}>
                  <td>{p.month}</td>
                  <td className="muted small">
                    <code>{p.file}</code>
                  </td>
                  <td>{p.events}</td>
                  <td>{formatBytes(p.bytes)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {i > 0 && (
                      <button className="btn ghost icon sm danger" title="Delete this month" onClick={() => confirm(`Delete the activity file for ${p.month}? ${p.events} events will be lost.`) && remove.mutate(p.month)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
