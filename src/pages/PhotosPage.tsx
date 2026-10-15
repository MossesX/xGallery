import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clapperboard, Image as ImageIcon, LayoutGrid, Search } from 'lucide-react'
import { useSettings, useTimeline } from '../api/hooks'
import type { MediaItem, TimelineItem } from '../api/types'
import { Lightbox } from '../components/Lightbox'
import { MediaThumb } from '../components/MediaThumb'
import { PageLoader } from '../components/Skeleton'

function dayLabel(day: string): string {
  const d = new Date(day + 'T00:00:00')
  const today = new Date()
  const diff = Math.round((new Date(today.toDateString()).getTime() - d.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** Google-Photos style timeline: everything you can see, grouped by day, newest first. */
export function PhotosPage() {
  const { data: site } = useSettings()
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [pages, setPages] = useState<number[]>([])
  const [acc, setAcc] = useState<TimelineItem[]>([])
  const before = pages[pages.length - 1]
  const { data, isLoading } = useTimeline({ before, kind, q })
  const items = useMemo(() => {
    const seen = new Set<number>()
    const out: TimelineItem[] = []
    for (const it of [...acc, ...(data?.items ?? [])]) {
      if (seen.has(it.id)) continue
      seen.add(it.id)
      out.push(it)
    }
    return out
  }, [acc, data])
  const groups = useMemo(() => {
    const map = new Map<string, TimelineItem[]>()
    for (const it of items) map.set(it.day, [...(map.get(it.day) ?? []), it])
    return [...map.entries()]
  }, [items])
  const [open, setOpen] = useState<number | null>(null)
  const reset = () => {
    setPages([])
    setAcc([])
  }
  const more = () => {
    if (!data?.nextBefore) return
    setAcc(items)
    setPages([...pages, data.nextBefore])
  }
  if (!site) return <PageLoader />
  return (
    <main className="page">
      <section className="toolbar">
        <div>
          <div className="eyebrow">Everything you can see</div>
          <h1 style={{ margin: 0 }}>
            <LayoutGrid size={22} /> Photos
          </h1>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="feed-tabs">
            <button className={kind === '' ? 'active' : ''} onClick={() => { setKind(''); reset() }}>
              All
            </button>
            <button className={kind === 'image' ? 'active' : ''} onClick={() => { setKind('image'); reset() }}>
              <ImageIcon size={13} /> Photos
            </button>
            <button className={kind === 'video' ? 'active' : ''} onClick={() => { setKind('video'); reset() }}>
              <Clapperboard size={13} /> Videos
            </button>
          </div>
          <label className="feed-search" style={{ minWidth: 220 }}>
            <Search size={14} />
            <input value={q} onChange={(e) => { setQ(e.target.value); reset() }} placeholder="Search titles, albums" aria-label="Search photos" />
          </label>
        </div>
      </section>
      {isLoading && !items.length ? (
        <PageLoader />
      ) : !items.length ? (
        <div className="empty">Nothing to show yet. Albums shared with you and your own uploads appear here by day.</div>
      ) : (
        <div className="timeline">
          {groups.map(([day, list]) => (
            <section key={day} className="timeline-day">
              <h3 className="timeline-head">
                {dayLabel(day)} <span className="muted small">· {list.length}</span>
              </h3>
              <div className="timeline-grid">
                {list.map((m) => (
                  <button key={m.id} className="timeline-tile" onClick={() => setOpen(items.indexOf(m))} title={`${m.title} · ${m.album.title}`}>
                    {m.kind === 'video' ? <video src={m.url} muted preload="metadata" /> : <MediaThumb item={m} alt="" />}
                    {m.kind === 'video' && (
                      <span className="chip chip-glass browser-badge">
                        <Clapperboard size={10} />
                      </span>
                    )}
                    <span className="timeline-album">
                      <Link to={`/album/${m.album.slug}`} onClick={(e) => e.stopPropagation()}>
                        {m.album.title}
                      </Link>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {data?.nextBefore && (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <button className="btn" onClick={more}>
                Load older
              </button>
            </div>
          )}
        </div>
      )}
      {open != null && <Lightbox items={items as MediaItem[]} index={open} onClose={() => setOpen(null)} onNavigate={setOpen} allowComments={site.settings.allowComments} allowLikes={site.settings.allowLikes} allowDownloads={site.settings.allowDownloads} context="Photos" />}
    </main>
  )
}
