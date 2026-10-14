import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Compass, Heart, Images, Pin } from 'lucide-react'
import { usePublicAlbum, usePublicGalleries, usePublicGallery, useSettings } from '../api/hooks'
import { MediaLayout } from '../components/MediaLayout'
import { Lightbox } from '../components/Lightbox'
import { PageLoader } from '../components/Skeleton'
import { useGalleryTheme } from '../components/GalleryTheme'
import { PublicShell } from '../components/PublicShell'
import { GalleryTile } from '../components/GalleryTile'
import { AlbumCard } from '../components/AlbumCard'
import { Avatar } from '../components/Avatar'
import { timeAgo } from '../lib/media'
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
            <h1 style={{ margin: 0 }}>People</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>Everyone sharing public albums.</p>
          </div>
          {data && <span className="chip">{data.length} people</span>}
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
            <section className="profile">
              <div className="profile-cover">{data.gallery.splash && <img src={data.gallery.splash.thumbUrl ?? data.gallery.splash.url} alt="" />}</div>
              <div className="profile-row">
                <div className="profile-avatar">
                  <Avatar name={data.gallery.owner?.displayName ?? data.gallery.title} size={96} />
                </div>
                <div className="profile-info">
                  <h1>{data.gallery.owner?.displayName ?? data.gallery.title}</h1>
                  {data.gallery.owner && <div className="muted">@{data.gallery.owner.username}</div>}
                  {data.gallery.tagline && <p className="profile-bio">{data.gallery.tagline}</p>}
                </div>
                <div className="profile-stats">
                  <div>
                    <strong>{data.albums.length}</strong>
                    <span>albums</span>
                  </div>
                  <div>
                    <strong>{data.albums.reduce((n, a) => n + a.counts.media, 0)}</strong>
                    <span>photos</span>
                  </div>
                  <div>
                    <strong>{data.albums.reduce((n, a) => n + a.counts.likes, 0)}</strong>
                    <span>likes</span>
                  </div>
                </div>
              </div>
            </section>
            {data.album ? (
              <section className="pinned">
                <div className="toolbar" style={{ marginBottom: 'calc(var(--space) * 2)' }}>
                  <div>
                    <div className="eyebrow">
                      <Pin size={11} /> Pinned
                    </div>
                    <h2 style={{ margin: 0 }}>{data.album.title}</h2>
                    {data.album.description && <p className="muted" style={{ margin: '6px 0 0', maxWidth: 720 }}>{data.album.description}</p>}
                  </div>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="muted small row" style={{ gap: 4 }}>
                      <Heart size={13} /> {data.album.counts.likes}
                    </span>
                    <Link to={`/public/${data.gallery.slug}/${data.album.slug}`} className="btn sm">
                      Open album <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
                <PublicMedia media={data.media} layout={layout} allowDownloads={site.settings.allowDownloads} context={data.album.title} />
              </section>
            ) : data.albums.length === 0 ? (
              <div className="empty">Nothing public here yet.</div>
            ) : null}
            {data.albums.filter((a) => a.id !== data.album?.id).length > 0 && (
              <>
                <section className="toolbar" style={{ marginTop: data.album ? 'calc(var(--space) * 5)' : 0 }}>
                  <div>
                    <h2 style={{ margin: 0 }}>Albums</h2>
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
                <ArrowLeft size={14} /> {data.gallery.owner?.displayName ?? data.gallery.title}
              </Link>
            </div>
            <header className="album-header post-header">
              <Link to={`/public/${data.gallery.slug}`} className="feed-person">
                <Avatar name={data.gallery.owner?.displayName ?? data.gallery.title} size={40} />
                <span>
                  <strong>{data.gallery.owner?.displayName ?? data.gallery.title}</strong>
                  <span className="muted small">{data.gallery.owner ? `@${data.gallery.owner.username} · ` : ''}{timeAgo(data.album.updatedAt)}</span>
                </span>
              </Link>
              <h1>{data.album.title}</h1>
              {data.album.description && <p className="muted lead" style={{ maxWidth: 720 }}>{data.album.description}</p>}
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <span className="chip">
                  <Images size={11} /> {data.album.counts.media} photos
                </span>
                <span className="chip">
                  <Heart size={11} /> {data.album.counts.likes}
                </span>
                {data.album.tags.map((t) => (
                  <Link to={`/?tag=${encodeURIComponent(t)}`} className="chip chip-tag" key={t}>
                    #{t}
                  </Link>
                ))}
              </div>
            </header>
            <PublicMedia media={data.media} layout={layout} allowDownloads={site.settings.allowDownloads} context={data.album.title} />
          </>
        )}
      </main>
    </PublicShell>
  )
}
