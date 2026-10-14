import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ListVideo, Repeat, X } from 'lucide-react'
import type { MediaItem } from '../api/types'
import { VideoPreview } from './VideoTile'
import { LikeButton } from './LikeButton'
import { formatDuration } from '../lib/media'
import { api } from '../api/client'

interface Props {
  videos: MediaItem[]
  currentId: number
  onSelect: (id: number) => void
  onClose: () => void
  allowLikes: boolean
  allowDownloads: boolean
  readOnly?: boolean
}

/** A dedicated player with the album's videos as a playlist. Autoplays the next clip. */
export function PlayPanel({ videos, currentId, onSelect, onClose, allowLikes, allowDownloads, readOnly }: Props) {
  const index = Math.max(0, videos.findIndex((v) => v.id === currentId))
  const item = videos[index]
  const [autoNext, setAutoNext] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const go = useCallback((delta: number) => onSelect(videos[(index + delta + videos.length) % videos.length].id), [index, videos, onSelect])

  useEffect(() => {
    if (!readOnly && item) api.post(`/api/media/${item.id}/view`).catch(() => undefined)
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [item?.id, readOnly, item])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && e.shiftKey) go(1)
      if (e.key === 'ArrowLeft' && e.shiftKey) go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, go])

  if (!item) return null

  return (
    <section className="play-panel" ref={panelRef} aria-label="Video player">
      <div className="play-stage">
        <video key={item.id} ref={videoRef} src={item.url} poster={item.thumbUrl ?? undefined} controls autoPlay playsInline onEnded={() => autoNext && videos.length > 1 && go(1)} />
        <div className="play-toolbar">
          <button className="lb-btn" onClick={onClose} title="Close player (Esc)" aria-label="Close player">
            <X size={18} />
          </button>
        </div>
      </div>
      <aside className="play-side">
        <div className="play-head">
          <div className="eyebrow">
            Now playing · {index + 1} / {videos.length}
            {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
          </div>
          <h3 style={{ margin: '4px 0 6px' }}>{item.title || 'Untitled'}</h3>
          {item.description && <p className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{item.description}</p>}
          <div className="row" style={{ gap: 6 }}>
            {videos.length > 1 && (
              <>
                <button className="btn sm" onClick={() => go(-1)} title="Previous (Shift+←)">
                  <ChevronLeft size={14} /> Prev
                </button>
                <button className="btn sm" onClick={() => go(1)} title="Next (Shift+→)">
                  Next <ChevronRight size={14} />
                </button>
                <button className={`btn sm ${autoNext ? 'primary' : ''}`} onClick={() => setAutoNext((a) => !a)} title="Autoplay next">
                  <Repeat size={14} /> Auto
                </button>
              </>
            )}
            {allowLikes && !readOnly && <LikeButton item={item} compact />}
            {allowDownloads && (
              <a className="btn sm" href={`${item.url}${item.url.includes('?') ? '&' : '?'}download=1`} title="Download">
                <Download size={14} />
              </a>
            )}
          </div>
        </div>
        <div className="eyebrow muted" style={{ margin: '14px 0 8px' }}>
          <ListVideo size={12} style={{ verticalAlign: '-2px' }} /> Playlist
        </div>
        <div className="playlist">
          {videos.map((v, i) => (
            <button key={v.id} className={`playlist-item ${v.id === item.id ? 'on' : ''}`} onClick={() => onSelect(v.id)}>
              <VideoPreview item={v} className="playlist-thumb" />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="ellipsis" style={{ display: 'block', fontWeight: 600 }}>
                  {i + 1}. {v.title || 'Untitled'}
                </span>
                <span className="muted small">{formatDuration(v.duration) || 'video'}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>
    </section>
  )
}
