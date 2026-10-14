import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Compass, Flame, Heart, Images, LogIn, Search, Sparkles, Users, X } from 'lucide-react'
import { usePublicFeed, useSettings } from '../api/hooks'
import { PublicShell } from '../components/PublicShell'
import { FeedCard } from '../components/FeedCard'
import { Avatar } from '../components/Avatar'
import { AlbumCardSkeleton } from '../components/Skeleton'

const SORTS = [
  { id: 'newest', label: 'Latest', icon: Sparkles },
  { id: 'popular', label: 'Popular', icon: Flame },
  { id: 'liked', label: 'Most loved', icon: Heart },
]

/** The anonymous landing page: a social feed of everyone's public albums, the people behind them and trending tags. */
export function PublicHomePage() {
  const { data: site } = useSettings()
  const [params, setParams] = useSearchParams()
  const sort = params.get('sort') ?? 'newest'
  const tag = params.get('tag') ?? ''
  const [q, setQ] = useState(params.get('q') ?? '')
  const { data, isLoading } = usePublicFeed({ sort, q: params.get('q') ?? '', tag })
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const people = data?.people ?? []

  return (
    <PublicShell>
      <main className="page feed-page">
        {people.length > 0 && (
          <section className="people-strip" aria-label="People">
            {people.map((g) => (
              <Link to={`/public/${g.slug}`} className="person-bubble" key={g.id} title={g.owner?.displayName ?? g.title}>
                <span className="ring">
                  {g.owner?.avatarUrl ? <img src={g.owner.avatarUrl} alt="" loading="lazy" /> : g.splash ? <img src={g.splash.thumbUrl ?? g.splash.url} alt="" loading="lazy" /> : <Avatar name={g.owner?.displayName ?? g.title} size={56} />}
                </span>
                <span className="name">{(g.owner?.displayName ?? g.title).split(' ')[0]}</span>
              </Link>
            ))}
          </section>
        )}

        <div className="feed-layout">
          <div className="feed-main">
            <div className="feed-toolbar">
              <div className="feed-tabs" role="tablist">
                {SORTS.map((s) => (
                  <button key={s.id} role="tab" aria-selected={sort === s.id} className={sort === s.id ? 'active' : ''} onClick={() => set('sort', s.id === 'newest' ? '' : s.id)}>
                    <s.icon size={14} /> {s.label}
                  </button>
                ))}
              </div>
              <form
                className="feed-search"
                onSubmit={(e) => {
                  e.preventDefault()
                  set('q', q.trim())
                }}
              >
                <Search size={14} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search albums, people, tags" aria-label="Search" />
                {q && (
                  <button type="button" aria-label="Clear search" onClick={() => { setQ(''); set('q', '') }}>
                    <X size={13} />
                  </button>
                )}
              </form>
            </div>
            {tag && (
              <div className="row" style={{ gap: 8, marginBottom: 16 }}>
                <span className="muted small">Showing</span>
                <button className="chip chip-tag active" onClick={() => set('tag', '')}>
                  #{tag} <X size={11} />
                </button>
              </div>
            )}
            {isLoading && !data ? (
              <div className="feed-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <AlbumCardSkeleton key={i} />
                ))}
              </div>
            ) : !data?.albums.length ? (
              <div className="empty">
                <Compass size={40} strokeWidth={1.2} />
                <p style={{ marginTop: 12 }}>{params.get('q') || tag ? 'Nothing matches that yet.' : 'Nothing public has been shared yet.'}</p>
                {(params.get('q') || tag) && (
                  <button className="btn sm" onClick={() => { setQ(''); setParams({}, { replace: true }) }}>
                    Show everything
                  </button>
                )}
              </div>
            ) : (
              <div className="feed-grid">
                {data.albums.map((a) => (
                  <FeedCard album={a} key={a.id} />
                ))}
              </div>
            )}
          </div>

          <aside className="feed-side">
            <section className="side-card">
              <div className="side-stats">
                <div>
                  <strong>{data?.stats.people ?? 0}</strong>
                  <span>people</span>
                </div>
                <div>
                  <strong>{data?.stats.albums ?? 0}</strong>
                  <span>albums</span>
                </div>
                <div>
                  <strong>{data?.stats.photos ?? 0}</strong>
                  <span>photos</span>
                </div>
                <div>
                  <strong>{data?.stats.likes ?? 0}</strong>
                  <span>likes</span>
                </div>
              </div>
              <Link to="/login" className="btn primary" style={{ width: '100%', justifyContent: 'center' }}>
                <LogIn size={15} /> Member sign in
              </Link>
              <Link to="/request-account" className="btn" style={{ width: '100%', justifyContent: 'center' }}>
                Request an account
              </Link>
              <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>Members get the full collections, likes, comments, saved albums and their own gallery.</p>
            </section>

            {people.length > 0 && (
              <section className="side-card">
                <div className="side-head">
                  <h3>
                    <Users size={15} /> People
                  </h3>
                  <Link to="/public" className="small">
                    See all
                  </Link>
                </div>
                <ul className="side-people">
                  {people.slice(0, 8).map((g) => (
                    <li key={g.id}>
                      <Link to={`/public/${g.slug}`} className="side-person">
                        <Avatar name={g.owner?.displayName ?? g.title} size={34} src={g.owner?.avatarUrl} />
                        <span>
                          <strong>{g.owner?.displayName ?? g.title}</strong>
                          <span className="muted small">
                            {g.counts.publicAlbums} album{g.counts.publicAlbums === 1 ? '' : 's'} · {g.counts.media} photos
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data && data.tags.length > 0 && (
              <section className="side-card">
                <div className="side-head">
                  <h3>
                    <Images size={15} /> Trending tags
                  </h3>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {data.tags.slice(0, 16).map((t) => (
                    <button className={`chip chip-tag ${tag === t.name ? 'active' : ''}`} key={t.name} onClick={() => set('tag', tag === t.name ? '' : t.name)}>
                      #{t.name} <span className="muted">{t.count}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="side-links muted small">
              <Link to="/public">People</Link>
              <Link to="/login">Sign in</Link>
              <Link to="/request-account">Request an account</Link>
              <span>{site?.settings.siteTitle ?? 'xGallery'} by {site?.settings.brandName ?? 'AmberX'}</span>
            </section>
          </aside>
        </div>
      </main>
    </PublicShell>
  )
}
