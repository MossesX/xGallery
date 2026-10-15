import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, ExternalLink, Globe, Images, Maximize2, Minimize2, X } from 'lucide-react'
import { api } from '../api/client'
import type { Album, Comment, MediaItem } from '../api/types'
import { Lightbox } from './Lightbox'
import { MediaThumb } from './MediaThumb'
import { formatBytes } from '../lib/media'

/**
 * A floating, draggable window that browses one album (the owner can open any album). Click a
 * tile for the full viewer. Used from the new-album feed, the gallery tree and the member drawer.
 */
export function AlbumBrowserModal({ albumId, onClose }: { albumId: number | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['album', String(albumId)], queryFn: () => api.get<{ album: Album; media: MediaItem[]; comments: Comment[]; canManage: boolean }>(`/api/albums/${albumId}`), enabled: albumId != null })
  const [open, setOpen] = useState<number | null>(null)
  const [max, setMax] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  useEffect(() => {
    setPos({ x: 0, y: 0 })
    setOpen(null)
  }, [albumId])
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return
      setPos({ x: drag.current.ox + e.clientX - drag.current.sx, y: drag.current.oy + e.clientY - drag.current.sy })
    }
    const up = () => (drag.current = null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])
  if (albumId == null) return null
  const album = data?.album
  const media = data?.media ?? []
  const bytes = media.reduce((n, m) => n + (m.size ?? 0), 0)
  return (
    <>
      <div className="floating-backdrop" onClick={onClose} />
      <section className={`floating ${max ? 'is-max' : ''}`} style={max ? undefined : { transform: `translate(${pos.x}px, ${pos.y}px)` }} role="dialog" aria-label="Album browser">
        <header
          className="floating-head"
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('button, a')) return
            drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
          }}
        >
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <Images size={16} />
            <div style={{ minWidth: 0 }}>
              <strong className="clamp-1">{album?.title ?? 'Album'}</strong>
              <div className="muted small clamp-1">
                {album?.gallery?.owner?.displayName ? `${album.gallery.owner.displayName} · ` : ''}
                {album?.gallery?.title ?? ''}
                {album ? ` · ${media.filter((m) => m.kind === 'image').length} photos · ${media.filter((m) => m.kind === 'video').length} videos · ${formatBytes(bytes)}` : ''}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {album && (
              <>
                <span className={`badge ${album.visibility === 'public' ? 'success' : album.visibility === 'published' ? 'primary' : ''}`}>{album.visibility === 'published' ? 'buddies' : album.visibility}</span>
                <a className="btn ghost icon sm" href={`/api/albums/${album.id}/download.zip`} title="Download ZIP">
                  <Download size={14} />
                </a>
                <Link to={`/album/${album.slug}`} className="btn ghost icon sm" title="Open page" onClick={onClose}>
                  <ExternalLink size={14} />
                </Link>
                {album.isPublic && (
                  <Link to={`/public/${album.gallery?.slug}/${album.slug}`} className="btn ghost icon sm" title="Public page" onClick={onClose}>
                    <Globe size={14} />
                  </Link>
                )}
              </>
            )}
            <button className="btn ghost icon sm" title={max ? 'Restore' : 'Maximize'} onClick={() => setMax((v) => !v)}>
              {max ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button className="btn ghost icon sm" title="Close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="floating-body">
          {isLoading ? (
            <div className="muted small" style={{ padding: 16 }}>
              Loading…
            </div>
          ) : !album ? (
            <div className="empty">This album is not available.</div>
          ) : media.length === 0 ? (
            <div className="empty">No media yet.</div>
          ) : (
            <div className="browser-grid">
              {media.map((m, i) => (
                <button key={m.id} className="browser-tile" onClick={() => setOpen(i)} title={m.title}>
                  {m.kind === 'video' ? <video src={m.url} muted preload="metadata" /> : <MediaThumb item={m} alt="" />}
                  {m.kind === 'video' && <span className="chip chip-glass browser-badge">video</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
      {open != null && album && <Lightbox items={media} index={open} onClose={() => setOpen(null)} onNavigate={setOpen} allowComments={false} allowLikes={false} allowDownloads readOnly context={album.title} />}
    </>
  )
}
