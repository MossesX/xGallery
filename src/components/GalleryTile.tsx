import { Link } from 'react-router-dom'
import { Clapperboard, Globe, Images, Users } from 'lucide-react'
import type { Gallery } from '../api/types'
import { Avatar } from './Avatar'

/** Rich gallery card for the galleries browser: splash, owner, preview strip and counts. */
export function GalleryTile({ gallery, to, publicMode = false }: { gallery: Gallery; to: string; publicMode?: boolean }) {
  const previews = gallery.previews.filter(Boolean).slice(0, 4)
  return (
    <Link to={to} className="gallery-tile">
      <div className="splash">
        {gallery.splash ? <img src={gallery.splash.thumbUrl ?? gallery.splash.url} alt="" /> : previews[0]?.cover ? <img src={previews[0].cover.thumbUrl ?? previews[0].cover.url} alt="" /> : null}
        <div className="shade" />
        <div className="content">
          <div className="row" style={{ gap: 6, marginBottom: 4 }}>
            {gallery.counts.publicAlbums > 0 && (
              <span className="chip chip-glass">
                <Globe size={11} /> {gallery.counts.publicAlbums} public
              </span>
            )}
            {gallery.granted === false && <span className="chip chip-glass">Public only</span>}
          </div>
          <div className="eyebrow light">{gallery.headline ? gallery.title : 'Gallery'}</div>
          <h3>{gallery.headline || gallery.title}</h3>
        </div>
      </div>
      <div className="body">
        {gallery.tagline && <p className="muted small clamp-2" style={{ margin: 0 }}>{gallery.tagline}</p>}
        {previews.length > 0 && (
          <div className="strip">
            {previews.map((p) => (
              <div key={p.albumId} title={p.title}>
                {p.cover && <img src={p.cover.thumbUrl ?? p.cover.url} alt="" loading="lazy" />}
              </div>
            ))}
          </div>
        )}
        <div className="meta">
          <span className="owner">
            {gallery.owner && <Avatar name={gallery.owner.displayName} size={24} src={gallery.owner.avatarUrl} />}
            <span>{gallery.owner?.displayName ?? 'Gallery'}</span>
          </span>
          <span className="row" style={{ gap: 10 }}>
            <span className="row" style={{ gap: 4 }}>
              <Images size={12} /> {publicMode ? gallery.counts.publicAlbums : gallery.counts.albums}
            </span>
            {gallery.counts.videos > 0 && (
              <span className="row" style={{ gap: 4 }}>
                <Clapperboard size={12} /> {gallery.counts.videos}
              </span>
            )}
            {!publicMode && (
              <span className="row" style={{ gap: 4 }}>
                <Users size={12} /> {gallery.counts.members}
              </span>
            )}
          </span>
        </div>
      </div>
    </Link>
  )
}
