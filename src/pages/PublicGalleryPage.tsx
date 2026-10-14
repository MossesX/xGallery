import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Compass, Images } from 'lucide-react'
import { usePublicAlbum, usePublicGalleries, usePublicGallery, useSettings } from '../api/hooks'
import { MediaLayout } from '../components/MediaLayout'
import { Lightbox } from '../components/Lightbox'
import { PageLoader } from '../components/Skeleton'
import { useGalleryTheme } from '../components/GalleryTheme'
import { PublicShell } from '../components/PublicShell'
import { GalleryTile } from '../components/GalleryTile'
import { AlbumCard } from '../components/AlbumCard'
import { PlayPanel } from '../components/PlayPanel'
import type { MediaItem } from '../api/types'

/** /public: directory of every gallery that has public albums. */
export function PublicDirectoryPage() {
  const { data, isLoading } = usePublicGalleries()
  return (
    <PublicShell>
      <main className="page">
        <section className="toolbar">
          <div>
            <div className="eyebrow">Open to everyone</div>
            <h1 style={{ margin: 0 }}>Public galleries</h1>
          </div>
        </section>
        {isLoading ? (
          <PageLoader />
        ) : !data?.length ? (
          <div className="empty">
            <Compass size={40} strokeWidth={1.2} />
            <p style={{ marginTop: 12 }}>No public galleries yet.</p>
          </div>
        ) : (
          <div className="gallery-browser">
            {data.map((g) => (
              <GalleryTile gallery={g} key={g.id} to={`/public/${g.slug}`} publicMode />
            ))}
          </div>
        )}
      </main>
    </PublicShell>
  )
}

function PublicMedia({ media, layout, allowDownloads, context }: { media: MediaItem[]; layout: Parameters<typeof MediaLayout>[0]['layout']; allowDownloads: boolean; context?: string }) {
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState<number | null>(null)
  const videos = media.filter((m) => m.kind === 'video')
  const playId = params.get('play') ? Number(params.get('play')) : null
  const setPlay = (id: number | null) => {
    const next = new URLSearchParams(params)
    if (id == null) next.delete('play')
    else next.set('play', String(id))
    setParams(next, { replace: true })
  }
  void setPlay
  const onOpen = (i: number) => setOpen(i)
  return (
    <>
      {playId != null && videos.some((v) => v.id === playId) && (
        <PlayPanel videos={videos} currentId={playId} onSelect={(id) => setPlay(id)} onClose={() => setPlay(null)} allowLikes={false} allowDownloads={allowDownloads} readOnly />
      )}
      <MediaLayout items={media} layout={{ ...layout, showLikes: false, heroCover: false }} onOpen={onOpen} />
      {open != null && <Lightbox items={media} index={open} onClose={() => setOpen(null)} onNavigate={setOpen} allowComments={false} allowLikes={false} allowDownloads={allowDownloads} readOnly context={context} />}
    </>
  )
}

/** /public/:slug: a gallery's splash, its hook album and all of its public albums. */
export function PublicGalleryPage() {
  const { slug } = useParams()
  const { data: site } = useSettings()
  const { data, isLoading, error } = usePublicGallery(slug)
  useGalleryTheme(data?.theme)

  if (isLoading || !site) return <PageLoader />
  const layout = data?.album?.layoutOverride ?? site.settings.defaultLayout

  return (
    <PublicShell>
      <main className="page">
        {error || !data ? (
          <div className="empty">
            <p>This gallery is not available.</p>
          </div>
        ) : (
          <>
            <section className="hero-feature">
              {data.gallery.splash && <img className="hero-bg" src={data.gallery.splash.thumbUrl ?? data.gallery.splash.url} alt="" />}
              <div className="hero-shade" />
              <div className="hero-content">
                <div className="eyebrow light">{data.gallery.owner ? `Curated by ${data.gallery.owner.displayName}` : 'Gallery'}</div>
                <h1>{data.gallery.headline || data.gallery.title}</h1>
                {data.gallery.tagline && <p className="lead">{data.gallery.tagline}</p>}
              </div>
            </section>
            {data.album ? (
              <>
                <section className="toolbar">
                  <div>
                    <div className="eyebrow">Featured public album</div>
                    <h2 style={{ margin: 0 }}>{data.album.title}</h2>
                    {data.album.description && <p className="muted" style={{ margin: '6px 0 0', maxWidth: 720 }}>{data.album.description}</p>}
                  </div>
                  <Link to={`/public/${data.gallery.slug}/${data.album.slug}`} className="btn sm">
                    Open album <ArrowRight size={14} />
                  </Link>
                </section>
                <PublicMedia media={data.media} layout={layout} allowDownloads={site.settings.allowDownloads} context={data.album.title} />
              </>
            ) : data.albums.length === 0 ? (
              <div className="empty">This gallery has no public albums yet. Members can sign in to see more.</div>
            ) : null}
            {data.albums.filter((a) => a.id !== data.album?.id).length > 0 && (
              <>
                <section className="toolbar" style={{ marginTop: data.album ? 'calc(var(--space) * 5)' : 0 }}>
                  <div>
                    <div className="eyebrow">{data.album ? 'More from this gallery' : 'Open to everyone'}</div>
                    <h2 style={{ margin: 0 }}>Public albums</h2>
                  </div>
                  <span className="chip">
                    <Images size={11} /> {data.albums.length} albums
                  </span>
                </section>
                <div className="album-grid">
                  {data.albums
                    .filter((a) => a.id !== data.album?.id)
                    .map((a) => (
                      <AlbumCard album={a} key={a.id} to={`/public/${data.gallery.slug}/${a.slug}`} publicMode />
                    ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </PublicShell>
  )
}

/** /public/:slug/:album: one public album, login-free. */
export function PublicAlbumPage() {
  const { slug, album } = useParams()
  const { data: site } = useSettings()
  const { data, isLoading, error } = usePublicAlbum(slug, album)
  useGalleryTheme(data?.theme)
  if (isLoading || !site) return <PageLoader />
  const layout = data?.album.layoutOverride ?? site.settings.defaultLayout
  return (
    <PublicShell>
      <main className="page">
        {error || !data ? (
          <div className="empty">
            <p>This album is not available.</p>
          </div>
        ) : (
          <>
            <div className="row between" style={{ marginBottom: 'calc(var(--space) * 2)' }}>
              <Link to={`/public/${data.gallery.slug}`} className="btn ghost sm">
                ← {data.gallery.title}
              </Link>
            </div>
            <header className="album-header">
              <div className="eyebrow">Public album · {data.gallery.owner?.displayName}</div>
              <h1>{data.album.title}</h1>
              {data.album.description && <p className="muted lead" style={{ maxWidth: 720 }}>{data.album.description}</p>}
            </header>
            <PublicMedia media={data.media} layout={layout} allowDownloads={site.settings.allowDownloads} context={data.album.title} />
          </>
        )}
      </main>
    </PublicShell>
  )
}
