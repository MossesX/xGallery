import { Link } from 'react-router-dom'
import { Clapperboard, Eye, Heart, Images, MessageSquare } from 'lucide-react'
import type { Album } from '../api/types'
import { MediaThumb } from './MediaThumb'
import { Avatar } from './Avatar'
import { timeAgo } from '../lib/media'

/** A public album as a social post: who, when, the cover, title and reactions. */
export function FeedCard({ album }: { album: Album }) {
  const owner = album.gallery?.owner
  const slug = album.gallery?.slug ?? ''
  return (
    <article className="feed-card" data-album-id={album.id} data-album-slug={album.slug} data-album-title={album.title} data-album-public={album.isPublic ? '1' : '0'} data-album-owner={album.gallery?.owner?.id ?? ''}>
      <header className="feed-head">
        <Link to={`/public/${slug}`} className="feed-person">
          <Avatar name={owner?.displayName ?? album.gallery?.title ?? '?'} size={36} src={owner?.avatarUrl} />
          <span>
            <strong>{owner?.displayName ?? album.gallery?.title}</strong>
            <span className="muted small">{owner ? `@${owner.username} · ` : ''}{timeAgo(album.updatedAt)}</span>
          </span>
        </Link>
        <span className="chip">
          <Images size={11} /> {album.counts.media}
          {album.counts.videos > 0 && (
            <>
              {' '}
              · <Clapperboard size={11} /> {album.counts.videos}
            </>
          )}
        </span>
      </header>
      <Link to={`/public/${slug}/${album.slug}`} className="feed-cover" aria-label={album.title}>
        {album.cover ? <MediaThumb item={album.cover} alt="" /> : <div className="cover-placeholder"><Images size={36} strokeWidth={1.2} /></div>}
      </Link>
      <div className="feed-body">
        <Link to={`/public/${slug}/${album.slug}`} className="feed-title">
          {album.title}
        </Link>
        {album.description && <p className="muted small clamp-2">{album.description}</p>}
        <div className="feed-foot">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {album.tags.slice(0, 3).map((t) => (
              <Link to={`/?tag=${encodeURIComponent(t)}`} className="chip chip-tag" key={t}>
                #{t}
              </Link>
            ))}
          </div>
          <div className="feed-stats">
            <span>
              <Heart size={13} /> {album.counts.likes}
            </span>
            <span>
              <MessageSquare size={13} /> {album.counts.comments}
            </span>
            <span>
              <Eye size={13} /> {album.views}
            </span>
          </div>
        </div>
      </div>
    </article>
  )
}
