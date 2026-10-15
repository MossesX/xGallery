import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Info, Link2, Maximize2, Pause, Play, Repeat, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { MediaItem } from '../api/types'
import { LikeButton } from './LikeButton'
import { ReactionBar } from './ReactionBar'
import { Comments } from './Comments'
import { formatBytes, formatDuration } from '../lib/media'
import { api } from '../api/client'
import { useUI } from '../store/ui'

interface Props {
  items: MediaItem[]
  index: number
  onClose: () => void
  onNavigate: (index: number) => void
  allowComments: boolean
  allowLikes: boolean
  allowDownloads: boolean
  /** Public share mode: no likes/comments/views. */
  readOnly?: boolean
  /** Shown above the title, e.g. the album name. */
  context?: string
}

/**
 * The immersive viewer: a dark stage for images and videos, a filmstrip of the whole album,
 * a collapsible info and comments panel, zoom with drag-to-pan, slideshow and autoplay-next.
 */
export function Lightbox({ items, index, onClose, onNavigate, allowComments, allowLikes, allowDownloads, readOnly, context }: Props) {
  const item = items[index]
  const [sideOpen, setSideOpen] = useState(() => window.innerWidth > 1100)
  const [zoom, setZoom] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [autoNext, setAutoNext] = useState(true)
  const [chromeHidden, setChromeHidden] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const touchStart = useRef<number | null>(null)
  const hideTimer = useRef<number | null>(null)
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null)
  const notify = useUI((s) => s.notify)

  const prev = useCallback(() => onNavigate((index - 1 + items.length) % items.length), [index, items.length, onNavigate])
  const next = useCallback(() => onNavigate((index + 1) % items.length), [index, items.length, onNavigate])

  useEffect(() => setZoom(false), [index])

  // Preload neighbours so arrows feel instant.
  useEffect(() => {
    for (const d of [1, -1]) {
      const n = items[(index + d + items.length) % items.length]
      if (n?.kind === 'image') {
        const img = new Image()
        img.src = n.url
      }
    }
  }, [index, items])

  useEffect(() => {
    if (!readOnly && item) api.post(`/api/media/${item.id}/view`).catch(() => undefined)
  }, [item?.id, readOnly, item])

  useEffect(() => {
    if (!playing || item?.kind === 'video') return
    const t = setInterval(next, 4500)
    return () => clearInterval(t)
  }, [playing, next, item?.kind])

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('.strip-item.on')
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [index])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    else rootRef.current?.requestFullscreen?.().catch(() => undefined)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === ' ') {
        e.preventDefault()
        if (item?.kind === 'video') {
          const v = stageRef.current?.querySelector('video')
          if (v) v.paused ? v.play().catch(() => undefined) : v.pause()
        } else setPlaying((p) => !p)
      } else if (e.key === 'i') setSideOpen((s) => !s)
      else if (e.key === 'z') setZoom((z) => !z)
      else if (e.key === 'f') toggleFullscreen()
      else if (e.key === 'Home') onNavigate(0)
      else if (e.key === 'End') onNavigate(items.length - 1)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, prev, next, toggleFullscreen, item?.kind, items.length, onNavigate])

  // Auto-hide chrome while the pointer rests on the stage.
  const bump = () => {
    setChromeHidden(false)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setChromeHidden(true), 2500)
  }

  const copyLink = () => {
    const url = new URL(location.href)
    url.searchParams.set('m', String(item.id))
    navigator.clipboard.writeText(url.toString()).then(() => notify('Link to this item copied', 'success'))
  }

  if (!item) return null
  const dlUrl = `${item.url}${item.url.includes('?') ? '&' : '?'}download=1`

  return (
    <div className={`viewer ${chromeHidden ? 'chrome-hidden' : ''} ${sideOpen ? 'with-side' : ''}`} ref={rootRef} role="dialog" aria-modal="true" aria-label={item.title || 'Media viewer'} onMouseMove={bump}>
      <header className="viewer-top">
        <button className="lb-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <X size={18} />
        </button>
        <div className="viewer-title">
          {context && <div className="eyebrow light">{context}</div>}
          <strong className="ellipsis">{item.title || 'Untitled'}</strong>
          <span className="muted-light">
            {index + 1} / {items.length}
          </span>
        </div>
        <div className="viewer-actions">
          {item.kind === 'image' && (
            <button className={`lb-btn ${zoom ? 'active' : ''}`} onClick={() => setZoom((z) => !z)} aria-label="Zoom" title="Zoom (Z)">
              {zoom ? <ZoomOut size={17} /> : <ZoomIn size={17} />}
            </button>
          )}
          {items.length > 1 && item.kind === 'image' && (
            <button className={`lb-btn ${playing ? 'active' : ''}`} onClick={() => setPlaying((p) => !p)} aria-label="Slideshow" title="Slideshow (Space)">
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
          )}
          {items.length > 1 && item.kind === 'video' && (
            <button className={`lb-btn ${autoNext ? 'active' : ''}`} onClick={() => setAutoNext((a) => !a)} aria-label="Autoplay next" title="Autoplay next">
              <Repeat size={17} />
            </button>
          )}
          <button className="lb-btn" onClick={toggleFullscreen} aria-label="Fullscreen" title="Fullscreen (F)">
            <Maximize2 size={17} />
          </button>
          {!readOnly && (
            <button className="lb-btn" onClick={copyLink} aria-label="Copy link" title="Copy link to this item">
              <Link2 size={17} />
            </button>
          )}
          {allowDownloads && (
            <a className="lb-btn" href={dlUrl} aria-label="Download" title="Download original">
              <Download size={17} />
            </a>
          )}
          <button className={`lb-btn ${sideOpen ? 'active' : ''}`} onClick={() => setSideOpen((v) => !v)} aria-label="Details" title="Details (I)">
            <Info size={17} />
          </button>
        </div>
      </header>

      <div
        className={`viewer-stage ${zoom ? 'zoomed' : ''}`}
        ref={stageRef}
        onClick={(e) => e.target === e.currentTarget && onClose()}
        onTouchStart={(e) => (touchStart.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchStart.current == null) return
          const dx = e.changedTouches[0].clientX - touchStart.current
          if (Math.abs(dx) > 60) (dx > 0 ? prev : next)()
          touchStart.current = null
        }}
        onMouseDown={(e) => {
          if (!zoom || !stageRef.current) return
          drag.current = { x: e.clientX, y: e.clientY, sl: stageRef.current.scrollLeft, st: stageRef.current.scrollTop }
        }}
        onMouseMove={(e) => {
          if (!drag.current || !stageRef.current) return
          stageRef.current.scrollLeft = drag.current.sl - (e.clientX - drag.current.x)
          stageRef.current.scrollTop = drag.current.st - (e.clientY - drag.current.y)
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
      >
        {item.kind === 'video' ? (
          <video key={item.id} src={item.url} poster={item.thumbUrl ?? undefined} controls autoPlay playsInline onEnded={() => autoNext && items.length > 1 && next()} />
        ) : (
          <img key={item.id} src={item.url} alt={item.title} draggable={false} onClick={() => !drag.current && setZoom((z) => !z)} />
        )}
        {items.length > 1 && (
          <>
            <button className="lb-btn viewer-prev" onClick={prev} aria-label="Previous" title="Previous (←)">
              <ChevronLeft size={22} />
            </button>
            <button className="lb-btn viewer-next" onClick={next} aria-label="Next" title="Next (→)">
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      {items.length > 1 && (
        <div className="viewer-strip" ref={stripRef}>
          {items.map((m, i) => (
            <button key={m.id} className={`strip-item ${i === index ? 'on' : ''}`} onClick={() => onNavigate(i)} title={m.title}>
              <img src={m.thumbUrl ?? m.url} alt="" loading="lazy" />
              {m.kind === 'video' && (
                <span className="strip-badge">
                  <Play size={9} fill="currentColor" /> {formatDuration(m.duration) || 'video'}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <aside className={`viewer-side ${sideOpen ? '' : 'collapsed'}`}>
        <div className="side-head">
          <div className="eyebrow">
            {item.kind} · {item.width}×{item.height}
            {item.duration ? ` · ${formatDuration(item.duration)}` : ''} · {formatBytes(item.size)}
          </div>
          <h3 style={{ marginTop: 6 }}>{item.title || 'Untitled'}</h3>
          {item.description && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{item.description}</p>}
          <div className="row" style={{ gap: 10 }}>
            {allowLikes && !readOnly && <LikeButton item={item} />}
            {allowLikes && !readOnly && <ReactionBar item={item} compact />}
            <span className="muted small">{item.views} views</span>
          </div>
        </div>
        {allowComments && !readOnly && (
          <div className="side-body">
            <div className="eyebrow muted" style={{ marginBottom: 12 }}>
              Comments
            </div>
            <Comments mediaId={item.id} />
          </div>
        )}
        {readOnly && (
          <div className="side-body">
            <p className="muted small">You are viewing a public page. Members can sign in to like and comment.</p>
          </div>
        )}
      </aside>
    </div>
  )
}
