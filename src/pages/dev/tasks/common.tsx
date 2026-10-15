import { createContext, useContext, useEffect, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Clock, ListChecks, OctagonX, StickyNote, type LucideIcon } from 'lucide-react'
import type { Entry, EntryKind, TaskList, TypeSchema } from '../../../api/tasks'
import { ICONS } from '../../../ui/config'

/* ---------- icons, chips, dates ---------- */

const KIND_ICONS: Record<EntryKind, LucideIcon> = { note: StickyNote, todo: ListChecks, task: CircleDot }

export function KindIcon({ kind, types, size = 13 }: { kind: EntryKind; types?: TypeSchema; size?: number }) {
  const I = (types && ICONS[types[kind].icon]) ?? KIND_ICONS[kind]
  return <I size={size} style={{ color: types?.[kind].color }} />
}

export function StatusIcon({ status, size = 13 }: { status: string; size?: number }) {
  if (status === 'done') return <CheckCircle2 size={size} className="st-done" />
  if (status === 'blocked') return <OctagonX size={size} className="st-blocked" />
  if (status === 'in_progress') return <Clock size={size} className="st-progress" />
  return <Circle size={size} className="st-open" />
}

export function PriorityChip({ priority }: { priority: string }) {
  return (
    <span className={`chip prio-${priority}`}>
      {priority === 'urgent' && <AlertTriangle size={10} />} {priority.replace('_', ' ')}
    </span>
  )
}

export function fmtDue(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  const days = Math.round((ts - Date.now()) / 86_400_000)
  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (days < 0) return `${label} (${-days}d late)`
  if (days === 0) return `${label} (today)`
  if (days === 1) return `${label} (tomorrow)`
  return label
}

export function dueClass(e: Entry): string {
  if (!e.dueAt || e.status === 'done') return ''
  const days = (e.dueAt - Date.now()) / 86_400_000
  return days < 0 ? 'due-late' : days < 2 ? 'due-soon' : ''
}

export const humanStatus = (s: string) => s.replace(/_/g, ' ')

/* ---------- context menu (one per workspace, items depend on what was clicked) ---------- */

export interface MenuItem {
  label?: string
  icon?: ReactNode
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  sep?: boolean
  head?: string
  children?: MenuItem[]
}

export interface MenuApi {
  open: (e: MouseEvent | { clientX: number; clientY: number }, items: MenuItem[]) => void
  close: () => void
}

export const MenuContext = createContext<MenuApi>({ open: () => {}, close: () => {} })
export const useMenu = () => useContext(MenuContext)

export function ContextMenuLayer({ state, onClose }: { state: { x: number; y: number; items: MenuItem[] } | null; onClose: () => void }) {
  const [sub, setSub] = useState<number | null>(null)
  useEffect(() => {
    if (!state) return
    const close = () => onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', close, true)
    }
  }, [state, onClose])
  useEffect(() => setSub(null), [state])
  if (!state) return null
  const x = Math.min(state.x, window.innerWidth - 280)
  const y = Math.min(state.y, window.innerHeight - 20 - Math.min(480, state.items.length * 30))
  const render = (items: MenuItem[], depth: number) =>
    items.map((it, i) =>
      it.sep ? (
        <div key={i} className="ctx-sep" />
      ) : it.head ? (
        <div key={i} className="ctx-head">
          {it.head}
        </div>
      ) : it.children ? (
        <div key={i} className="ctx-sub" onMouseEnter={() => depth === 0 && setSub(i)}>
          <button className="ctx-item" disabled={it.disabled} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            {it.icon} {it.label} <span className="ctx-arrow">›</span>
          </button>
          {sub === i && (
            <div className="ctx-menu ctx-menu-sub" role="menu" onMouseDown={(e) => e.stopPropagation()}>
              {render(it.children, depth + 1)}
            </div>
          )}
        </div>
      ) : (
        <button
          key={i}
          className={`ctx-item ${it.danger ? 'danger' : ''}`}
          disabled={it.disabled}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
            it.onClick?.()
          }}
        >
          {it.icon} {it.label}
        </button>
      ),
    )
  return (
    <div className="ctx-menu tasks-ctx" style={{ left: x, top: y }} role="menu" onMouseDown={(e) => e.stopPropagation()}>
      {render(state.items, 0)}
    </div>
  )
}

/* ---------- drag payloads shared by every view, tab and window ---------- */

export type DragPayload = { type: 'entries'; ids: number[]; fromList: number } | { type: 'list'; id: number } | { type: 'tab'; id: number } | { type: 'panel'; id: 'lists' }

export const DRAG_MIME = 'application/x-xg-tasks'

export function setDrag(e: DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
  e.dataTransfer.setData('text/plain', payload.type)
  e.dataTransfer.effectAllowed = 'move'
}

export function getDrag(e: DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_MIME)
    return raw ? (JSON.parse(raw) as DragPayload) : null
  } catch {
    return null
  }
}

export function hasDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(DRAG_MIME)
}

/* ---------- small helpers ---------- */

export function listPath(lists: TaskList[], id: number): string {
  const out: string[] = []
  let cur = lists.find((l) => l.id === id)
  for (let i = 0; cur && i < 10; i++) {
    out.unshift(cur.title)
    cur = cur.parentId ? lists.find((l) => l.id === cur!.parentId) : undefined
  }
  return out.join(' › ')
}

export function rootOf(lists: TaskList[], id: number): number {
  let cur = lists.find((l) => l.id === id)
  for (let i = 0; cur && cur.parentId && i < 10; i++) cur = lists.find((l) => l.id === cur!.parentId)
  return cur?.id ?? id
}

export function childrenOf(entries: Entry[], parentId: number | null, listId?: number): Entry[] {
  return entries.filter((e) => e.parentId === parentId && (listId == null || e.listId === listId)).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
}

/** Selection with click / ctrl-click / shift-click semantics over an ordered id list. */
export function useSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const click = (id: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, order: number[]) => {
    setSelected((prev) => {
      const next = new Set(e.ctrlKey || e.metaKey ? prev : [])
      if (e.shiftKey && anchor != null && order.includes(anchor)) {
        const a = order.indexOf(anchor)
        const b = order.indexOf(id)
        for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x)
        return next
      }
      if ((e.ctrlKey || e.metaKey) && prev.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (!e.shiftKey) setAnchor(id)
  }
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const clear = () => setSelected(new Set())
  const setAll = (ids: number[]) => setSelected(new Set(ids))
  return { selected, click, toggle, clear, setAll, has: (id: number) => selected.has(id) }
}
