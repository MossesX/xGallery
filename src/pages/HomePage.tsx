import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Images, LayoutGrid, Search, X } from 'lucide-react'
import { useAlbums, useGalleries, useMe, useSettings } from '../api/hooks'
import { AlbumCard } from '../components/AlbumCard'
import { GalleryTile } from '../components/GalleryTile'
import { AlbumCardSkeleton } from '../components/Skeleton'
import { MediaThumb } from '../components/MediaThumb'
import { Avatar } from '../components/Avatar'
import { useUiConfig } from '../ui/config'

const SORTS = [
  ['manual', 'Curated'],
  ['newest', 'Newest'],
  ['updated', 'Recently updated'],
  ['popular', 'Most viewed'],
  ['title', 'A to Z'],
] as const

/** The signed-in home page, assembled from the sections the developer panel configures. */
export function HomePage() {
  const { data: user } = useMe()
  const { data: site } = useSettings()
  const { data: galleries } = useGalleries()
  const ui = useUiConfig()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const tag = params.get('tag') ?? ''
  const gallery = params.get('gallery') ?? ''
  const sort = params.get('sort') ?? 'manual'
  const { data, isLoading } = useAlbums({ q: q || undefined, tag: tag || undefined, sort, gallery: gallery || undefined })

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const albums = data?.albums ?? []
  const filtering = !!(q || tag || gallery)
  const heroOn = ui.home.sections.some((s) => s.type === 'hero' && s.enabled)
  const hero = useMemo(() => {
    if (filtering || !heroOn) return null
    const byId = site?.settings.heroAlbumId ? albums.find((a) => a.id === site.settings.heroAlbumId) : undefined
    return byId ?? albums.find((a) => a.featured && a.cover) ?? albums.find((a) => a.cover) ?? null
  }, [albums, filtering, site?.settings.heroAlbumId, heroOn])
  const rest = hero ? albums.filter((a) => a.id !== hero.id) : albums
  const multiGallery = (galleries?.length ?? 0) > 1

  const sections: Record<string, (title: string) => ReactNode> = {
    hero: () =>
      hero && (
        <section className="hero-feature" data-album-id={hero.id} data-album-slug={hero.slug} data-album-title={hero.title} data-album-public={hero.isPublic ? '1' : '0'} data-album-owner={hero.gallery?.owner?.id ?? ''}>
          {hero.cover && <MediaThumb item={hero.cover} alt="" className="hero-bg" />}
          <div className="hero-shade" />
          <div className="hero-content">
            <div className="eyebrow light">Featured gallery{hero.gallery ? ` · ${hero.gallery.title}` : ''}</div>
            <h1>{hero.title}</h1>
            {hero.description && <p className="lead clamp-3">{hero.description}</p>}
            <div className="row" style={{ gap: 12 }}>
              <Link to={`/album/${hero.slug}`} className="btn primary lg">
                Open album <ArrowRight size={16} />
              </Link>
              <span className="chip chip-glass">
                <Images size={12} /> {hero.counts.media} items
              </span>
            </div>
          </div>
        </section>
      ),
    galleries: (title) =>
      multiGallery &&
      !filtering && (
        <>
          <section className="toolbar">
            <div>
              <div className="eyebrow">Your access</div>
              <h2 style={{ margin: 0 }}>{title || 'Galleries'}</h2>
            </div>
            <Link to="/galleries" className="btn sm">
              Browse all <ArrowRight size={14} />
            </Link>
          </section>
          <div className="gallery-browser">
            {galleries!.slice(0, 6).map((g) => (
              <GalleryTile gallery={g} key={g.id} to={`/g/${g.slug}`} />
            ))}
          </div>
        </>
      ),
    people: (title) =>
      !filtering &&
      !!galleries?.length && (
        <>
          {title && (
            <section className="toolbar">
              <h2 style={{ margin: 0 }}>{title}</h2>
            </section>
          )}
          <div className="people-strip" aria-label="People">
            {galleries.map((g) => (
              <Link to={`/g/${g.slug}`} className="person-bubble" key={g.id} title={g.owner?.displayName ?? g.title}>
                <span className="ring">{g.owner?.avatarUrl ? <img src={g.owner.avatarUrl} alt="" loading="lazy" /> : <Avatar name={g.owner?.displayName ?? g.title} size={56} />}</span>
                <span className="person-name clamp-1">{(g.owner?.displayName ?? g.title).split(' ')[0]}</span>
              </Link>
            ))}
          </div>
        </>
      ),
    tags: (title) =>
      !!data?.tags.length && (
        <>
          {title && (
            <section className="toolbar">
              <h2 style={{ margin: 0 }}>{title}</h2>
            </section>
          )}
          <div className="tag-row">
            {data.tags.map((t) => (
              <button key={t.name} className={`chip chip-tag ${tag === t.name ? 'active' : ''}`} onClick={() => set('tag', tag === t.name ? '' : t.name)}>
                #{t.name} <span className="muted">{t.count}</span>
              </button>
            ))}
          </div>
        </>
      ),
    albums: (title) => (
      <>
        <section className="toolbar">
          <div>
            <div className="eyebrow">{filtering ? 'Results' : title || 'All albums'}</div>
            <h2 style={{ margin: 0 }}>
              {q ? `“${q}”` : tag ? `#${tag}` : gallery ? galleries?.find((g) => String(g.id) === gallery)?.title ?? 'Gallery' : `Welcome back, ${user?.display_name?.split(' ')[0] ?? 'friend'}`}
            </h2>
          </div>
          <div className="row">
            {filtering && (
              <button className="btn sm" onClick={() => setParams({}, { replace: true })}>
                <X size={14} /> Clear
              </button>
            )}
            {multiGallery && (
              <select className="select" value={gallery} onChange={(e) => set('gallery', e.target.value)} aria-label="Gallery" style={{ width: 'auto' }}>
                <option value="">All galleries</option>
                {galleries!.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            )}
            <select className="select" value={sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort" style={{ width: 'auto' }}>
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </section>
        {!ui.home.sections.some((s) => s.type === 'tags' && s.enabled) && !!data?.tags.length && (
          <div className="tag-row">
            {data.tags.map((t) => (
              <button key={t.name} className={`chip chip-tag ${tag === t.name ? 'active' : ''}`} onClick={() => set('tag', tag === t.name ? '' : t.name)}>
                #{t.name} <span className="muted">{t.count}</span>
              </button>
            ))}
          </div>
        )}
        {isLoading ? (
          <div className="album-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <AlbumCardSkeleton key={i} />
            ))}
          </div>
        ) : rest.length === 0 && !hero ? (
          <div className="empty">
            {filtering ? <Search size={40} strokeWidth={1.2} /> : <LayoutGrid size={40} strokeWidth={1.2} />}
            <p style={{ marginTop: 12 }}>{filtering ? 'Nothing matches that search.' : 'No albums have been shared with you yet.'}</p>
          </div>
        ) : (
          <div className="album-grid">
            {rest.map((a) => (
              <AlbumCard album={a} key={a.id} />
            ))}
          </div>
        )}
      </>
    ),
    custom: (title, html?: string) => (
      <section className="custom-block">
        {title && <h2>{title}</h2>}
        <div className="custom-html" dangerouslySetInnerHTML={{ __html: html ?? '' }} />
      </section>
    ),
  }

  return (
    <main className="page">
      {ui.home.sections
        .filter((s) => s.enabled)
        .map((s) => {
          const render = sections[s.type]
          const node = s.type === 'custom' ? (sections.custom as (t: string, h: string) => ReactNode)(s.title, s.html) : render?.(s.title)
          if (!node) return null
          return (
            <div key={s.id} data-section={s.id} data-section-title={s.title || s.type} className="home-section">
              {node}
            </div>
          )
        })}
    </main>
  )
}
