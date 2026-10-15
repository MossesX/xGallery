import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Clock, LayoutGrid, ListTree, Search, Star, Table2, X } from 'lucide-react'
import { CATEGORIES, type Command, type Risk } from './catalog'

/**
 * The command library: search, instant filters, and three views of the same list — a grid with
 * expandable rows (each opening a nested sub-grid of its options and examples), a tree whose
 * root can be changed, and cards.
 */

interface Props {
  commands: Command[]
  favorites: Set<string>
  recent: string[]
  selectedId: string | null
  onSelect: (c: Command) => void
  onRun: (c: Command) => void
  onFavorite: (id: string) => void
}
type View = 'grid' | 'tree' | 'cards'
const RISKS: Risk[] = ['safe', 'careful', 'danger']

export function Library({ commands, favorites, recent, selectedId, onSelect, onRun, onFavorite }: Props) {
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>(() => (localStorage.getItem('xg-cmdr-view') as View) || 'grid')
  const [cats, setCats] = useState<Set<string>>(new Set())
  const [risks, setRisks] = useState<Set<Risk>>(new Set())
  const [tags, setTags] = useState<Set<string>>(new Set())
  const [favOnly, setFavOnly] = useState(false)
  const [root, setRoot] = useState<string>('all')
  const [open, setOpen] = useState<Set<string>>(new Set(['Files']))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [groupBy, setGroupBy] = useState(true)
  const pick = (v: View) => { setView(v); localStorage.setItem('xg-cmdr-view', v) }
  const toggleSet = <T,>(set: Set<T>, v: T, setter: (s: Set<T>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); setter(n) }

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = useMemo(() => commands.filter((c) => {
    if (cats.size && !cats.has(c.cat)) return false
    if (risks.size && !risks.has(c.risk)) return false
    if (tags.size && ![...tags].every((t) => c.tags.includes(t))) return false
    if (favOnly && !favorites.has(c.id)) return false
    if (!words.length) return true
    const hay = `${c.name} ${c.summary} ${c.cat} ${c.sub} ${c.tags.join(' ')} ${c.build(Object.fromEntries(c.opts.map((o) => [o.key, o.default])))}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  }), [commands, cats, risks, tags, favOnly, favorites, words])
  const allCats = useMemo(() => [...new Set([...CATEGORIES, ...commands.map((c) => c.cat)])], [commands])
  const countBy = (cat: string) => commands.filter((c) => c.cat === cat).length
  const tagCounts = useMemo(() => { const m = new Map<string, number>(); for (const c of filtered) for (const t of c.tags) m.set(t, (m.get(t) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28) }, [filtered])
  const hasFilter = q || cats.size || risks.size || tags.size || favOnly
  const clear = () => { setQ(''); setCats(new Set()); setRisks(new Set()); setTags(new Set()); setFavOnly(false) }

  const row = (c: Command) => (
    <tr key={c.id} className={`cmdr-row ${selectedId === c.id ? 'is-selected' : ''}`} onClick={() => onSelect(c)} onDoubleClick={() => onRun(c)} data-cmd={c.id}>
      <td style={{ width: 24 }}>
        <button className="btn ghost icon sm" style={{ width: 22, height: 22 }} onClick={(e) => { e.stopPropagation(); toggleSet(expanded, c.id, setExpanded) }} aria-label="Expand" data-cmd-expand="">
          {expanded.has(c.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </td>
      <td>
        <strong>{c.name}</strong> {c.custom && <span className="chip">mine</span>} {c.ftp && <span className="chip">ftp</span>}
        <div className="muted small">{c.summary}</div>
      </td>
      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{c.sub}</td>
      <td>
        <span className={`chip risk-${c.risk}`}>{c.risk}</span>
      </td>
      <td style={{ width: 26 }}>
        <button className={`btn ghost icon sm ${favorites.has(c.id) ? 'active' : ''}`} style={{ width: 22, height: 22 }} onClick={(e) => { e.stopPropagation(); onFavorite(c.id) }} title="Favourite" aria-label="Favourite">
          <Star size={12} fill={favorites.has(c.id) ? 'currentColor' : 'none'} />
        </button>
      </td>
    </tr>
  )
  const detail = (c: Command) =>
    expanded.has(c.id) && (
      <tr key={`${c.id}-d`} className="cmdr-subgrid">
        <td />
        <td colSpan={4}>
          <div className="cmdr-sub">
            <div className="small muted">
              <strong>Options</strong> · {c.opts.length ? 'set them in the customize pane on the right' : 'none, runs as is'}
            </div>
            {c.opts.length > 0 && (
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Option</th>
                    <th>Type</th>
                    <th>Default</th>
                    <th>Choices / hint</th>
                  </tr>
                </thead>
                <tbody>
                  {c.opts.map((o) => (
                    <tr key={o.key}>
                      <td>{o.label}</td>
                      <td className="small muted">{o.type}</td>
                      <td className="mono small">{String(o.default ?? '')}</td>
                      <td className="small muted">{o.options ? o.options.map((x) => (typeof x === 'string' ? x : x.l)).join(' · ') : o.hint ?? o.placeholder ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="small muted">
              <strong>Default command</strong>
            </div>
            <pre className="vps-pre" style={{ maxHeight: 120 }}>{c.build(Object.fromEntries(c.opts.map((o) => [o.key, o.default])))}</pre>
            {c.examples?.length ? (
              <div className="small">
                <strong>Examples</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {c.examples.map((e) => (
                    <li key={e.label}>
                      {e.label}: <code>{c.build({ ...Object.fromEntries(c.opts.map((o) => [o.key, o.default])), ...e.v })}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="row" style={{ gap: 4 }}>
              {c.tags.map((t) => (
                <button key={t} className={`chip chip-tag ${tags.has(t) ? 'active' : ''}`} onClick={() => toggleSet(tags, t, setTags)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </td>
      </tr>
    )

  const grid = () => {
    if (!groupBy)
      return (
        <table className="table compact cmdr-grid">
          <tbody>{filtered.flatMap((c) => [row(c), detail(c)])}</tbody>
        </table>
      )
    const byCat = new Map<string, Map<string, Command[]>>()
    for (const c of filtered) {
      if (!byCat.has(c.cat)) byCat.set(c.cat, new Map())
      const m = byCat.get(c.cat)!
      if (!m.has(c.sub)) m.set(c.sub, [])
      m.get(c.sub)!.push(c)
    }
    return (
      <div className="stack" style={{ gap: 4 }}>
        {[...byCat.entries()].map(([cat, subs]) => {
          const isOpen = open.has(cat) || !!hasFilter
          const total = [...subs.values()].reduce((a, b) => a + b.length, 0)
          return (
            <div key={cat} className="cmdr-group" data-cmd-group={cat}>
              <button className="cmdr-group-head" onClick={() => toggleSet(open, cat, setOpen)}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} <strong>{cat}</strong> <span className="muted small">{total}</span>
              </button>
              {isOpen &&
                [...subs.entries()].map(([sub, cmds]) => (
                  <div key={sub} className="cmdr-subgroup">
                    <div className="eyebrow" style={{ padding: '4px 8px 0' }}>
                      {sub} · {cmds.length}
                    </div>
                    <table className="table compact cmdr-grid">
                      <tbody>{cmds.flatMap((c) => [row(c), detail(c)])}</tbody>
                    </table>
                  </div>
                ))}
            </div>
          )
        })}
        {!byCat.size && <p className="muted small">Nothing matches.</p>}
      </div>
    )
  }

  const tree = () => {
    const roots = root === 'all' ? allCats : root === 'favorites' ? ['Favourites'] : root === 'recent' ? ['Recent'] : [root]
    const cmdsFor = (cat: string) => (cat === 'Favourites' ? filtered.filter((c) => favorites.has(c.id)) : cat === 'Recent' ? recent.map((id) => filtered.find((c) => c.id === id)).filter((x): x is Command => !!x) : filtered.filter((c) => c.cat === cat))
    return (
      <div className="cmdr-tree">
        <div className="row" style={{ gap: 6, marginBottom: 6 }}>
          <span className="muted small">Root</span>
          <select className="select sm" value={root} onChange={(e) => setRoot(e.target.value)} aria-label="Tree root">
            <option value="all">Everything</option>
            <option value="favorites">Favourites</option>
            <option value="recent">Recently used</option>
            {allCats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <ul>
          {roots.map((cat) => {
            const cmds = cmdsFor(cat)
            const subs = [...new Set(cmds.map((c) => c.sub))]
            const isOpen = open.has(cat) || roots.length === 1 || !!hasFilter
            return (
              <li key={cat}>
                <button className="cmdr-node" onClick={() => toggleSet(open, cat, setOpen)} data-tree-cat={cat}>
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <strong>{cat}</strong> <span className="muted small">{cmds.length}</span>
                </button>
                {isOpen && (
                  <ul>
                    {subs.map((sub) => {
                      const key = `${cat}/${sub}`
                      const subOpen = open.has(key) || roots.length === 1 || !!hasFilter
                      const list = cmds.filter((c) => c.sub === sub)
                      return (
                        <li key={sub}>
                          <button className="cmdr-node" onClick={() => toggleSet(open, key, setOpen)}>
                            {subOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {sub} <span className="muted small">{list.length}</span>
                          </button>
                          {subOpen && (
                            <ul>
                              {list.map((c) => (
                                <li key={c.id}>
                                  <button className={`cmdr-leaf ${selectedId === c.id ? 'active' : ''}`} onClick={() => onSelect(c)} onDoubleClick={() => onRun(c)} title={c.summary} data-cmd={c.id}>
                                    <span className={`cmdr-dot risk-${c.risk}`} /> {c.name}
                                    {favorites.has(c.id) && <Star size={10} fill="currentColor" />}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  const cards = () => (
    <div className="cmdr-cards">
      {filtered.map((c) => (
        <button key={c.id} className={`cmdr-card ${selectedId === c.id ? 'active' : ''}`} onClick={() => onSelect(c)} onDoubleClick={() => onRun(c)} data-cmd={c.id}>
          <div className="row between" style={{ gap: 4 }}>
            <strong>{c.name}</strong>
            <span className={`chip risk-${c.risk}`}>{c.risk}</span>
          </div>
          <div className="muted small">{c.summary}</div>
          <div className="muted small">
            {c.cat} › {c.sub}
          </div>
        </button>
      ))}
      {!filtered.length && <p className="muted small">Nothing matches.</p>}
    </div>
  )

  return (
    <div className="cmdr-lib" data-cmdr-library="">
      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
        <div className="cmdr-search grow">
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${commands.length} commands…`} aria-label="Search commands" />
          {q && (
            <button className="tab-close" onClick={() => setQ('')} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="segmented" role="radiogroup" aria-label="View">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => pick('grid')} title="Grid" data-view="grid">
            <Table2 size={13} />
          </button>
          <button className={view === 'tree' ? 'active' : ''} onClick={() => pick('tree')} title="Tree" data-view="tree">
            <ListTree size={13} />
          </button>
          <button className={view === 'cards' ? 'active' : ''} onClick={() => pick('cards')} title="Cards" data-view="cards">
            <LayoutGrid size={13} />
          </button>
        </div>
      </div>
      <div className="cmdr-filters">
        <button className={`chip chip-tag ${favOnly ? 'active' : ''}`} onClick={() => setFavOnly(!favOnly)} data-filter-fav="">
          <Star size={10} /> favourites {favorites.size}
        </button>
        {RISKS.map((r) => (
          <button key={r} className={`chip chip-tag risk-${r} ${risks.has(r) ? 'active' : ''}`} onClick={() => toggleSet(risks, r, setRisks)} data-filter-risk={r}>
            {r}
          </button>
        ))}
        {view === 'grid' && (
          <button className={`chip chip-tag ${groupBy ? 'active' : ''}`} onClick={() => setGroupBy(!groupBy)}>
            grouped
          </button>
        )}
        {hasFilter ? (
          <button className="chip chip-tag" onClick={clear} data-filter-clear="">
            <X size={10} /> clear
          </button>
        ) : null}
      </div>
      <div className="cmdr-filters">
        {allCats.map((cat) => (
          <button key={cat} className={`chip chip-tag ${cats.has(cat) ? 'active' : ''}`} onClick={() => toggleSet(cats, cat, setCats)} data-filter-cat={cat}>
            {cat} <span className="muted">{countBy(cat)}</span>
          </button>
        ))}
      </div>
      <div className="cmdr-filters cmdr-tags">
        {tagCounts.map(([t, cnt]) => (
          <button key={t} className={`chip chip-tag ${tags.has(t) ? 'active' : ''}`} onClick={() => toggleSet(tags, t, setTags)} data-filter-tag={t}>
            {t} <span className="muted">{cnt}</span>
          </button>
        ))}
      </div>
      <div className="muted small" style={{ padding: '0 2px' }}>
        {filtered.length} of {commands.length} · click selects, double-click runs
        {recent.length > 0 && (
          <>
            {' '}
            · <Clock size={10} /> last: {recent.slice(0, 3).map((id) => commands.find((c) => c.id === id)?.name).filter(Boolean).join(', ')}
          </>
        )}
      </div>
      <div className="cmdr-lib-body">{view === 'grid' ? grid() : view === 'tree' ? tree() : cards()}</div>
    </div>
  )
}
