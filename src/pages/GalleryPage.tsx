import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Globe, Share2 } from 'lucide-react'
import { useCreateGalleryLink, useGallery } from '../api/hooks'
import { AlbumCard } from '../components/AlbumCard'
import { PageLoader } from '../components/Skeleton'
import { useGalleryTheme } from '../components/GalleryTheme'
import { ApiError } from '../api/client'
import { useUI } from '../store/ui'

/** A member's view of one gallery: its splash and the albums they may see. */
export function GalleryPage() {
  const { slug } = useParams()
  const { data, isLoading, error } = useGallery(slug)
  const notify = useUI((s) => s.notify)
  const createLink = useCreateGalleryLink()
  useGalleryTheme(data?.theme)

  if (isLoading) return <PageLoader />
  if (error instanceof ApiError && error.status === 404) return <Navigate to="/" replace />
  if (!data) return <PageLoader />
  const { gallery, albums } = data
  const shown = albums
  const publicUrl = `${location.origin}/public/${gallery.slug}`

  return (
    <main className="page" data-gallery-id={gallery.id} data-gallery-slug={gallery.slug} data-gallery-title={gallery.title} data-gallery-manage={data.canManage ? '1' : '0'}>
      <div className="row between" style={{ marginBottom: 'calc(var(--space) * 2)' }}>
        <Link to="/" className="btn ghost sm">
          <ArrowLeft size={14} /> All galleries
        </Link>
        <div className="row">
          {data.canManage && (
            <button className="btn sm" onClick={() => createLink.mutate({ galleryId: gallery.id }, { onSuccess: (l) => notify(`Gallery link copied: ${l.fullUrl}`, 'success'), onError: (e: Error) => notify(e.message, 'error') })} disabled={createLink.isPending} title="Create a private link anyone can open to see this gallery's albums" data-gallery-link="">
              <Share2 size={14} /> Gallery link
            </button>
          )}
          {gallery.publicAlbum && (
            <button className="btn sm" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => notify('Public link copied', 'success'))}>
              <Globe size={14} /> Public page
            </button>
          )}
        </div>
      </div>
      <section className="hero-feature" style={{ minHeight: 360 }}>
        {gallery.splash && <img className="hero-bg" src={gallery.splash.thumbUrl ?? gallery.splash.url} alt="" />}
        <div className="hero-shade" />
        <div className="hero-content">
          <div className="eyebrow light">{gallery.owner ? `${gallery.owner.displayName} · @${gallery.owner.username}` : 'Gallery'}</div>
          <h1>{gallery.headline || gallery.title}</h1>
          {gallery.tagline && <p className="lead">{gallery.tagline}</p>}
        </div>
      </section>
      <section className="toolbar">
        <div>
          <div className="eyebrow">{gallery.title}</div>
          <h2 style={{ margin: 0 }}>Albums shared with you</h2>
        </div>
      </section>
      {shown.length === 0 ? (
        <div className="empty">No albums here yet.</div>
      ) : (
        <div className="album-grid">
          {shown.map((a) => (
            <AlbumCard album={a} key={a.id} />
          ))}
        </div>
      )}
    </main>
  )
}
