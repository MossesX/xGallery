import { Link } from 'react-router-dom'
import { ArrowRight, Compass, Globe, Images, LogIn } from 'lucide-react'
import { usePublicGalleries, useSettings } from '../api/hooks'
import { PublicShell } from '../components/PublicShell'
import { GalleryTile } from '../components/GalleryTile'
import { AlbumCardSkeleton } from '../components/Skeleton'

/** The anonymous landing page: browse everyone's public albums, sign in from the banner or the footer. */
export function PublicHomePage() {
  const { data: site } = useSettings()
  const { data: galleries, isLoading } = usePublicGalleries()
  const hero = galleries?.find((g) => g.splash) ?? galleries?.[0]
  const previews = (galleries ?? []).flatMap((g) => g.previews.filter(Boolean).map((p) => ({ ...p!, gallerySlug: g.slug, galleryTitle: g.title }))).slice(0, 8)

  return (
    <PublicShell>
      <main className="page">
        <section className="hero-feature landing-hero">
          {hero?.splash && <img className="hero-bg" src={hero.splash.thumbUrl ?? hero.splash.url} alt="" />}
          <div className="hero-shade" />
          <div className="hero-content">
            <div className="eyebrow light">{site?.settings.brandName ?? 'AmberX'} · {site?.settings.siteTitle ?? 'xGallery'}</div>
            <h1>{site?.settings.tagline ?? 'Curated visual stories'}</h1>
            <p className="lead">Browse public albums from every gallery. Members sign in for the full collections, saved albums, likes and discussion.</p>
            <div className="row" style={{ gap: 10 }}>
              <a href="#galleries" className="btn primary lg">
                <Compass size={16} /> Explore public galleries
              </a>
              <Link to="/login" className="btn lg landing-signin">
                <LogIn size={16} /> Member sign in
              </Link>
            </div>
          </div>
        </section>

        {previews.length > 0 && (
          <>
            <section className="toolbar">
              <div>
                <div className="eyebrow">Latest</div>
                <h2 style={{ margin: 0 }}>Public albums</h2>
              </div>
            </section>
            <div className="album-grid" style={{ marginBottom: 'calc(var(--space) * 5)' }}>
              {previews.map((p) => (
                <Link to={`/public/${p.gallerySlug}/${p.albumSlug}`} className="album-card" key={`${p.gallerySlug}-${p.albumId}`}>
                  <div className="cover">{p.cover && <img src={p.cover.thumbUrl ?? p.cover.url} alt="" loading="lazy" />}</div>
                  <div className="body">
                    <h3>{p.title}</h3>
                    <div className="muted small">{p.galleryTitle}</div>
                    <div className="row between" style={{ marginTop: 'auto' }}>
                      <span className="chip">
                        <Globe size={11} /> Public
                      </span>
                      <span className="muted small row" style={{ gap: 4 }}>
                        Open <ArrowRight size={12} />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        <section className="toolbar" id="galleries">
          <div>
            <div className="eyebrow">Open to everyone</div>
            <h2 style={{ margin: 0 }}>Public galleries</h2>
          </div>
          <span className="chip">
            <Images size={11} /> {galleries?.length ?? 0} galleries
          </span>
        </section>
        {isLoading ? (
          <div className="gallery-browser">
            {Array.from({ length: 3 }).map((_, i) => (
              <AlbumCardSkeleton key={i} />
            ))}
          </div>
        ) : !galleries?.length ? (
          <div className="empty">
            <Compass size={40} strokeWidth={1.2} />
            <p style={{ marginTop: 12 }}>No public galleries yet. Members can sign in to see their collections.</p>
            <Link to="/login">Member sign in →</Link>
          </div>
        ) : (
          <div className="gallery-browser">
            {galleries.map((g) => (
              <GalleryTile gallery={g} key={g.id} to={`/public/${g.slug}`} publicMode />
            ))}
          </div>
        )}
      </main>
    </PublicShell>
  )
}
