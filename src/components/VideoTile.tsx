import { useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../api/types'

/** Poster thumbnail that starts a muted inline preview of the video on mouse-over. */
export function VideoPreview({ item, className }: { item: MediaItem; className?: string }) {
  const [hover, setHover] = useState(false)
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (hover) v.play().catch(() => undefined)
    else {
      v.pause()
      v.currentTime = 0
    }
  }, [hover])
  return (
    <div className={`video-preview ${className ?? ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onTouchStart={() => setHover(true)} onTouchEnd={() => setHover(false)}>
      {item.thumbUrl && <img src={item.thumbUrl} alt={item.title} loading="lazy" decoding="async" width={item.width || undefined} height={item.height || undefined} />}
      {hover && <video ref={ref} src={item.url} muted loop playsInline preload="metadata" poster={item.thumbUrl ?? undefined} />}
      <span className="video-preview-hint" aria-hidden="true">
        {hover ? 'Preview' : ''}
      </span>
    </div>
  )
}
