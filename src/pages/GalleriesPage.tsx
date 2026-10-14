import { useMemo, useState } from 'react'
import { Compass, Search } from 'lucide-react'
import { useGalleries } from '../api/hooks'
import { GalleryTile } from '../components/GalleryTile'
import { Skeleton } from '../components/Skeleton'

const SORTS = [
  ['updated', 'Recently updated'],
  ['title', 'A to Z'],
  ['albums', 'Most albums'],
  ['members', 'Most members'],
] as const

/** Members' galleries browser. */
export function GalleriesPage() {
  const { data, isLoading } = useGalleries()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>('updated')
  const [onlyMine, setOnlyMine] = useState(false)

  const list = useMemo(() => {
    let rows = data ?? []
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      rows = rows.filter((g) => `${g.title} ${g.headline} ${g.tagline} ${g.owner?.displayName ?? ''}`.toLowerCase().includes(t))
    }
    if (onlyMine) rows = rows.filter((g) => g.granted !== false)
    return [...rows].sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title) : sort === 'albums' ? b.counts.albums - a.counts.albums : sort === 'members' ? b.counts.members - a.counts.members : b.updatedAt - a.updatedAt,
    )
  }, [data, q, sort, onlyMine])

  return (
    <main className="page">
      <section className="toolbar">
        <div>
          <div className="eyebrow">Browse</div>
          <h1 style={{ margin: 0 }}>Galleries</h1>
        </div>
        <div className="row">
          <label className="search" style={{ flex: '0 1 260px' }}>
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a gallery or curator" aria-label="Filter galleries" />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Granted to me
          </label>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: 'auto' }} aria-label="Sort galleries">
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </section>
      {isLoading ? (
        <div className="gallery-browser">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} style={{ height: 320 }} />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="empty">
          <Compass size={40} strokeWidth={1.2} />
          <p style={{ marginTop: 12 }}>No galleries match.</p>
        </div>
      ) : (
        <div className="gallery-browser">
          {list.map((g) => (
            <GalleryTile gallery={g} key={g.id} to={`/g/${g.slug}`} />
          ))}
        </div>
      )}
    </main>
  )
}
