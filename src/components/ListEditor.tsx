import { useState, type DragEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react'

/**
 * A reorderable list editor (drag the grip, or use the arrows) used by every "menu" the developer
 * panel offers: navigation, toolbar buttons, footer links, context-menu entries, home sections.
 */

interface Props<T extends { id: string }> {
  items: T[]
  onChange: (items: T[]) => void
  renderItem: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode
  create?: () => T
  addLabel?: string
  max?: number
  summary?: (item: T) => ReactNode
  emptyText?: string
}

export function ListEditor<T extends { id: string }>({ items, onChange, renderItem, create, addLabel = 'Add item', max = 24, summary, emptyText = 'Nothing here yet.' }: Props<T>) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= items.length) return
    const next = [...items]
    const [it] = next.splice(from, 1)
    next.splice(to, 0, it)
    onChange(next)
  }
  const update = (i: number, patch: Partial<T>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i))

  const onDrop = (e: DragEvent, i: number) => {
    e.preventDefault()
    if (dragging != null) move(dragging, i)
    setDragging(null)
    setOver(null)
  }

  return (
    <div className="list-editor">
      {items.length === 0 && <div className="muted small list-empty">{emptyText}</div>}
      {items.map((it, i) => (
        <div
          key={it.id}
          className={`list-row ${dragging === i ? 'dragging' : ''} ${over === i ? 'over' : ''} ${openId === it.id ? 'open' : ''}`}
          draggable
          onDragStart={(e) => {
            setDragging(i)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', String(i))
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (over !== i) setOver(i)
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => onDrop(e, i)}
          onDragEnd={() => {
            setDragging(null)
            setOver(null)
          }}
          data-list-item={it.id}
        >
          <div className="list-row-head">
            <span className="grip" title="Drag to reorder" aria-label="Drag to reorder">
              <GripVertical size={14} />
            </span>
            <button type="button" className="list-row-summary" onClick={() => setOpenId(openId === it.id ? null : it.id)} aria-expanded={openId === it.id}>
              {summary ? summary(it) : it.id}
            </button>
            <span className="row" style={{ gap: 2 }}>
              <button type="button" className="btn ghost icon sm" title="Move up" onClick={() => move(i, i - 1)} disabled={i === 0}>
                <ChevronUp size={13} />
              </button>
              <button type="button" className="btn ghost icon sm" title="Move down" onClick={() => move(i, i + 1)} disabled={i === items.length - 1}>
                <ChevronDown size={13} />
              </button>
              <button type="button" className="btn ghost icon sm danger" title="Remove" onClick={() => remove(i)}>
                <Trash2 size={13} />
              </button>
            </span>
          </div>
          {openId === it.id && <div className="list-row-body">{renderItem(it, (patch) => update(i, patch), i)}</div>}
        </div>
      ))}
      {create && items.length < max && (
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            const it = create()
            onChange([...items, it])
            setOpenId(it.id)
          }}
        >
          <Plus size={13} /> {addLabel}
        </button>
      )}
    </div>
  )
}
