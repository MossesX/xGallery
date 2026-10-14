import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Globe } from 'lucide-react'
import { useGallery } from '../api/hooks'
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
  useGalleryTheme(data?.theme)

  if (isLoading) return <PageLoader />
  if (error instanceof ApiError && error.status === 404) return <Navigate to="/" replace />
  if (!data) return <PageLoader />
  const { gallery, albums } = data
  const shown = albums
  const publicUrl = `${location.origin}/public/${gallery.slug}`

  return (
    <main className="page">
      <div className="row between" style={{ marginBottom: 'calc(var(--space) * 2)' }}>
        <Link to="/" className="btn ghost sm">
          <ArrowLeft size={14} /> All galleries
        </Link>
        <div className="row">
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
          <div className="eyebrow light">{gallery.owner ? `Curated by ${gallery.owner.displayName}` : 'Gallery'}</div>
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
