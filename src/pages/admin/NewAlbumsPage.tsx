import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clapperboard, Images, Mail, Phone, Search, Sparkles } from 'lucide-react'
import { api } from '../../api/client'
import { useNewAlbums } from '../../api/hooks'
import { Avatar } from '../../components/Avatar'
import { AlbumBrowserModal } from '../../components/AlbumBrowserModal'
import { formatBytes, timeAgo } from '../../lib/media'

/** Owner only: the new-album log with contact details and a floating browser per album. */
export function NewAlbumsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useNewAlbums()
  const [q, setQ] = useState('')
  const [browse, setBrowse] = useState<number | null>(null)
  const [sort, setSort] = useState<'newest' | 'largest' | 'user'>('newest')
  const seen = useMutation({
    mutationFn: () => api.put('/api/notifications/admin/read', { kind: 'album.' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notif-unread'] })
      qc.invalidateQueries({ queryKey: ['new-albums'] })
    },
  })
  useEffect(() => {
    // Opening the log clears the new-album counter in the banner.
    seen.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const list = (data ?? [])
    .filter((a) => !q || `${a.title} ${a.user.displayName} ${a.user.username} ${a.user.email} ${a.user.phone} ${a.gallery.title}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort === 'largest' ? b.photos + b.videos - (a.photos + a.videos) : sort === 'user' ? a.user.displayName.localeCompare(b.user.displayName) : b.createdAt - a.createdAt))

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow">Owner only</div>
          <h1 style={{ margin: 0 }}>
            <Sparkles size={22} /> New albums
          </h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Every album created on the site, newest first, with who made it and how to reach them. Browse any of them in place.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="feed-search" style={{ minWidth: 240 }}>
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search album, person, email, phone" aria-label="Search new albums" />
          </label>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: 'auto' }} aria-label="Sort">
            <option value="newest">Newest</option>
            <option value="largest">Most items</option>
            <option value="user">By person</option>
          </select>
        </div>
      </div>
      {isLoading ? null : !list.length ? (
        <div className="empty">No albums yet.</div>
      ) : (
        <div className="new-album-grid">
          {list.map((a) => (
            <article key={a.id} className={`card new-album ${a.seen ? '' : 'is-new'}`}>
              <button className="new-album-cover" onClick={() => setBrowse(a.id)} title="Browse this album">
                {a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : <Images size={32} strokeWidth={1.2} />}
                {!a.seen && <span className="chip chip-accent new-album-badge">New</span>}
              </button>
              <div className="stack" style={{ gap: 6, padding: '10px 12px 12px' }}>
                <div className="row between" style={{ alignItems: 'flex-start' }}>
                  <strong className="clamp-1">{a.title}</strong>
                  <span className={`badge ${a.visibility === 'public' ? 'success' : a.visibility === 'published' ? 'primary' : ''}`}>{a.visibility === 'published' ? 'buddies' : a.visibility}</span>
                </div>
                <div className="feed-person" style={{ gap: 8 }}>
                  <Avatar name={a.user.displayName} size={28} src={a.user.avatarUrl} />
                  <span>
                    <strong style={{ fontSize: '0.85rem' }}>{a.user.displayName}</strong>
                    <span className="muted small">@{a.user.username} · {a.gallery.title}</span>
                  </span>
                </div>
                <div className="muted small stack" style={{ gap: 2 }}>
                  {a.user.email ? (
                    <span className="row" style={{ gap: 4 }}>
                      <Mail size={11} /> <a href={`mailto:${a.user.email}`}>{a.user.email}</a>
                    </span>
                  ) : null}
                  {a.user.phone ? (
                    <span className="row" style={{ gap: 4 }}>
                      <Phone size={11} /> <a href={`tel:${a.user.phone}`}>{a.user.phone}</a>
                    </span>
                  ) : null}
                  {!a.user.email && !a.user.phone && <span>No contact on file</span>}
                </div>
                <div className="row between muted small">
                  <span className="row" style={{ gap: 10 }}>
                    <span className="row" style={{ gap: 3 }}>
                      <Images size={12} /> {a.photos}
                    </span>
                    <span className="row" style={{ gap: 3 }}>
                      <Clapperboard size={12} /> {a.videos}
                    </span>
                    <span>{formatBytes(a.bytes)}</span>
                  </span>
                  <span title={new Date(a.createdAt).toLocaleString()}>{timeAgo(a.createdAt)}</span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn primary sm" onClick={() => setBrowse(a.id)}>
                    <Images size={13} /> Browse
                  </button>
                  <Link to={`/album/${a.slug}`} className="btn sm">
                    Open page
                  </Link>
                  <Link to={`/admin/activity?userId=${a.user.id}`} className="btn ghost sm">
                    Activity
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <AlbumBrowserModal albumId={browse} onClose={() => setBrowse(null)} />
    </div>
  )
}
