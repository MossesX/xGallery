import { Fragment, useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Plus } from 'lucide-react'
import type { Entry, TaskList, TypeSchema } from '../../../api/tasks'
import { childrenOf, DragPayload, dueClass, fmtDue, getDrag, hasDrag, humanStatus, KindIcon, PriorityChip, setDrag, StatusIcon, useSelection } from './common'
import type { ListView, TreeRoot } from './store'
import { EntryEditor } from './EntryEditor'

/* ---------- shared view contract ---------- */

export interface DropTarget {
  listId: number
  parentId?: number | null
  beforeId?: number
}

export interface ViewProps {
  rootId: number
  lists: TaskList[]
  entries: Entry[]
  types: TypeSchema
  view: ListView
  selection: ReturnType<typeof useSelection>
  focused: number | null
  onFocus: (id: number | null) => void
  onEntryMenu: (e: MouseEvent, entry: Entry) => void
  onListMenu: (e: MouseEvent, list: TaskList) => void
  onAreaMenu: (e: MouseEvent, listId: number) => void
  onDrop: (payload: DragPayload, target: DropTarget) => void
  onToggleDone: (entry: Entry) => void
  onAdd: (listId: number, parentId?: number | null) => void
  onViewChange: (patch: Partial<ListView>) => void
}

const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

export function sortEntries(list: Entry[], sort: ListView['sort']): Entry[] {
  const out = [...list]
  switch (sort) {
    case 'title':
      return out.sort((a, b) => a.title.localeCompare(b.title))
    case 'due':
      return out.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
    case 'priority':
      return out.sort((a, b) => (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9))
    case 'updated':
      return out.sort((a, b) => b.updatedAt - a.updatedAt)
    default:
      return out.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
  }
}

export function visibleEntries(entries: Entry[], view: ListView, q: string): Entry[] {
  const needle = q.trim().toLowerCase()
  return entries.filter((e) => (view.showDone || e.status !== 'done') && (!view.filterKind || e.kind === view.filterKind) && (!needle || `${e.title} ${e.body} ${e.tags.join(' ')}`.toLowerCase().includes(needle)))
}

/** Bucket key for the non-structural tree roots. */
export function bucketsOf(e: Entry, root: TreeRoot, types: TypeSchema): { key: string; label: string; order: number }[] {
  switch (root) {
    case 'kind':
      return [{ key: e.kind, label: types[e.kind].label + 's', order: ['note', 'todo', 'task'].indexOf(e.kind) }]
    case 'status':
      return [{ key: e.status, label: humanStatus(e.status), order: ['open', 'in_progress', 'blocked', 'done'].indexOf(e.status) + 1 || 9 }]
    case 'priority':
      return [{ key: e.priority, label: `${e.priority} priority`, order: PRIO_RANK[e.priority] ?? 9 }]
    case 'tag':
      return e.tags.length ? e.tags.map((t) => ({ key: `tag:${t}`, label: `#${t}`, order: 0 })) : [{ key: 'untagged', label: 'Untagged', order: 1 }]
    case 'due': {
      if (!e.dueAt) return [{ key: 'none', label: 'No due date', order: 5 }]
      const days = (e.dueAt - Date.now()) / 86_400_000
      if (days < 0) return [{ key: 'late', label: 'Overdue', order: 0 }]
      if (days < 1) return [{ key: 'today', label: 'Today', order: 1 }]
      if (days < 7) return [{ key: 'week', label: 'This week', order: 2 }]
      if (days < 31) return [{ key: 'month', label: 'This month', order: 3 }]
      return [{ key: 'later', label: 'Later', order: 4 }]
    }
    default:
      return []
  }
}

interface Node {
  key: string
  type: 'list' | 'bucket' | 'entry'
  label: string
  list?: TaskList
  entry?: Entry
  listId: number
  children: Node[]
  count: number
}

function entryNode(e: Entry, entries: Entry[], sort: ListView['sort']): Node {
  const kids = sortEntries(childrenOf(entries, e.id), sort).map((c) => entryNode(c, entries, sort))
  return { key: `e${e.id}`, type: 'entry', label: e.title, entry: e, listId: e.listId, children: kids, count: kids.length }
}

export function buildTree(p: Pick<ViewProps, 'rootId' | 'lists' | 'entries' | 'types' | 'view'>): Node[] {
  const { rootId, lists, entries, types, view } = p
  if (view.root === 'structure') {
    const listNode = (l: TaskList): Node => {
      const groups = lists.filter((x) => x.parentId === l.id).sort((a, b) => a.sortOrder - b.sortOrder).map(listNode)
      const tops = sortEntries(childrenOf(entries, null, l.id), view.sort).map((e) => entryNode(e, entries, view.sort))
      return { key: `l${l.id}`, type: 'list', label: l.title, list: l, listId: l.id, children: [...groups, ...tops], count: entries.filter((e) => e.listId === l.id).length }
    }
    const root = lists.find((l) => l.id === rootId)
    return root ? [listNode(root)] : []
  }
  const buckets = new Map<string, Node & { order: number }>()
  for (const e of sortEntries(entries.filter((x) => x.parentId == null || !entries.some((y) => y.id === x.parentId)), view.sort)) {
    for (const b of bucketsOf(e, view.root, types)) {
      const node = buckets.get(b.key) ?? { key: `b${b.key}`, type: 'bucket', label: b.label, listId: rootId, children: [], count: 0, order: b.order }
      node.children.push(entryNode(e, entries, view.sort))
      node.count++
      buckets.set(b.key, node)
    }
  }
  return [...buckets.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
}

function flatIds(nodes: Node[], out: number[] = []): number[] {
  for (const n of nodes) {
    if (n.entry) out.push(n.entry.id)
    flatIds(n.children, out)
  }
  return out
}

/* ---------- drag helpers for rows ---------- */

function useDropRow(onDrop: ViewProps['onDrop'], target: () => DropTarget | null) {
  const [over, setOver] = useState(false)
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!hasDrag(e) || !target()) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false)
        const payload = getDrag(e)
        const t = target()
        // Only entries land on rows; tabs and panels bubble up to the workspace, which floats them.
        if (!payload || payload.type !== 'entries' || !t) return
        e.preventDefault()
        e.stopPropagation()
        onDrop(payload, t)
      },
    },
  }
}

function EntryMeta({ e, types }: { e: Entry; types: TypeSchema }) {
  const t = types[e.kind]
  return (
    <span className="entry-meta">
      {t.core.status !== 'hidden' && e.kind !== 'note' && <span className={`chip st-${e.status}`}>{humanStatus(e.status)}</span>}
      {t.core.priority !== 'hidden' && e.priority !== 'normal' && <PriorityChip priority={e.priority} />}
      {e.dueAt && <span className={`chip ${dueClass(e)}`}>{fmtDue(e.dueAt)}</span>}
      {e.checklist.length > 0 && (
        <span className="chip">
          ☑ {e.checklist.filter((c) => c.done).length}/{e.checklist.length}
        </span>
      )}
      {e.tags.slice(0, 3).map((tag) => (
        <span key={tag} className="chip chip-tag">
          #{tag}
        </span>
      ))}
    </span>
  )
}

/* ---------- tree view ---------- */

export function TreeView(p: ViewProps) {
  const nodes = useMemo(() => buildTree(p), [p.rootId, p.lists, p.entries, p.types, p.view])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const order = useMemo(() => flatIds(nodes), [nodes])
  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const dragStart = (e: DragEvent, entry: Entry) => {
    const ids = p.selection.has(entry.id) ? [...p.selection.selected] : [entry.id]
    setDrag(e, { type: 'entries', ids, fromList: entry.listId })
  }
  return (
    <div className="tree-view" onContextMenu={(e) => { if ((e.target as Element).closest('.tnode')) return; e.preventDefault(); p.onAreaMenu(e, p.rootId) }}>
      {nodes.length === 0 && <div className="muted small" style={{ padding: 16 }}>Nothing here yet. Right-click or use “Add” to create an entry.</div>}
      {nodes.map((n) => (
        <TreeNode key={n.key} node={n} depth={0} p={p} collapsed={collapsed} toggle={toggle} order={order} dragStart={dragStart} />
      ))}
    </div>
  )
}

function TreeNode({ node, depth, p, collapsed, toggle, order, dragStart }: { node: Node; depth: number; p: ViewProps; collapsed: Set<string>; toggle: (k: string) => void; order: number[]; dragStart: (e: DragEvent, entry: Entry) => void }) {
  const open = !collapsed.has(node.key)
  const drop = useDropRow(p.onDrop, () => (node.type === 'list' ? { listId: node.listId } : node.entry ? { listId: node.entry.listId, parentId: node.entry.parentId, beforeId: node.entry.id } : null))
  const e = node.entry
  const t = e ? p.types[e.kind] : null
  const selected = e ? p.selection.has(e.id) : false
  return (
    <div className="tnode-wrap">
      <div
        className={`tnode ${node.type} ${selected ? 'selected' : ''} ${e && p.focused === e.id ? 'focused' : ''} ${drop.over ? 'drop-over' : ''} ${e?.status === 'done' ? 'is-done' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable={!!e}
        onDragStart={(ev) => e && dragStart(ev, e)}
        {...drop.props}
        onClick={(ev) => {
          if (e) {
            p.selection.click(e.id, ev, order)
            p.onFocus(e.id)
          } else toggle(node.key)
        }}
        onContextMenu={(ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          if (e) {
            if (!p.selection.has(e.id)) p.selection.click(e.id, { ctrlKey: false, metaKey: false, shiftKey: false }, order)
            p.onFocus(e.id)
            p.onEntryMenu(ev, e)
          } else if (node.list) p.onListMenu(ev, node.list)
          else p.onAreaMenu(ev, node.listId)
        }}
        data-node={node.key}
      >
        {node.children.length > 0 ? (
          <button className="caret" onClick={(ev) => { ev.stopPropagation(); toggle(node.key) }} aria-label={open ? 'Collapse' : 'Expand'}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="caret-space" />
        )}
        {node.type === 'list' && (open ? <FolderOpen size={14} className="list-ico" style={{ color: node.list?.color || undefined }} /> : <Folder size={14} className="list-ico" style={{ color: node.list?.color || undefined }} />)}
        {e && t && t.core.status !== 'hidden' && <input type="checkbox" className="done-box" checked={e.status === 'done'} onClick={(ev) => ev.stopPropagation()} onChange={() => p.onToggleDone(e)} aria-label={`Done: ${e.title}`} />}
        {e && <KindIcon kind={e.kind} types={p.types} />}
        <span className="tnode-label clamp-1">{node.label}</span>
        {e ? <EntryMeta e={e} types={p.types} /> : <span className="muted small">{node.count}</span>}
        {node.type === 'list' && (
          <button className="btn ghost icon sm tnode-add" title="Add entry here" onClick={(ev) => { ev.stopPropagation(); p.onAdd(node.listId) }}>
            <Plus size={12} />
          </button>
        )}
      </div>
      {open && node.children.map((c) => <TreeNode key={c.key} node={c} depth={depth + 1} p={p} collapsed={collapsed} toggle={toggle} order={order} dragStart={dragStart} />)}
    </div>
  )
}

/* ---------- grid view (sections = subgrids, rows expand into the editor) ---------- */

export function GridView(p: ViewProps) {
  const nodes = useMemo(() => buildTree(p), [p.rootId, p.lists, p.entries, p.types, p.view])
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [openChildren, setOpenChildren] = useState<Set<number>>(new Set())
  const order = useMemo(() => flatIds(nodes), [nodes])
  const gridFields = [...new Set(Object.values(p.types).flatMap((t) => t.fields.filter((f) => f.showInGrid).map((f) => f.key)))]
  const fieldLabel = (key: string) => Object.values(p.types).flatMap((t) => t.fields).find((f) => f.key === key)?.label ?? key
  const cols = 8 + gridFields.length
  const toggleSet = (set: Set<string>, key: string) => {
    const n = new Set(set)
    if (n.has(key)) n.delete(key)
    else n.add(key)
    return n
  }
  const toggleNum = (set: Set<number>, key: number) => {
    const n = new Set(set)
    if (n.has(key)) n.delete(key)
    else n.add(key)
    return n
  }
  const sortBtn = (key: ListView['sort'], label: string) => (
    <button className={`grid-sort ${p.view.sort === key ? 'active' : ''}`} onClick={() => p.onViewChange({ sort: p.view.sort === key ? 'manual' : key })}>
      {label}
      {p.view.sort === key ? ' ▾' : ''}
    </button>
  )

  // Sections: structure → every list in the subtree (groups as sub-grids); other roots → buckets.
  const sections: { key: string; label: string; listId: number; list?: TaskList; rows: Node[]; depth: number }[] = []
  const walk = (n: Node, depth: number) => {
    if (n.type === 'entry') return
    sections.push({ key: n.key, label: n.label, listId: n.listId, list: n.list, rows: n.children.filter((c) => c.type === 'entry'), depth })
    n.children.filter((c) => c.type !== 'entry').forEach((c) => walk(c, depth + 1))
  }
  nodes.forEach((n) => walk(n, 0))
  const allIds = order
  const allSelected = allIds.length > 0 && allIds.every((id) => p.selection.has(id))

  return (
    <div className="grid-view" onContextMenu={(e) => { if ((e.target as Element).closest('tr')) return; e.preventDefault(); p.onAreaMenu(e, p.rootId) }}>
      <table className="grid-table">
        <thead>
          <tr>
            <th style={{ width: 28 }}>
              <input type="checkbox" checked={allSelected} onChange={() => (allSelected ? p.selection.clear() : p.selection.setAll(allIds))} aria-label="Select all" />
            </th>
            <th style={{ width: 28 }} />
            <th>{sortBtn('title', 'Title')}</th>
            <th style={{ width: 110 }}>Status</th>
            <th style={{ width: 100 }}>{sortBtn('priority', 'Priority')}</th>
            <th style={{ width: 120 }}>{sortBtn('due', 'Due')}</th>
            <th>Tags</th>
            {gridFields.map((k) => (
              <th key={k}>{fieldLabel(k)}</th>
            ))}
            <th style={{ width: 120 }}>{sortBtn('updated', 'Updated')}</th>
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => (
            <Fragment key={s.key}>
              <SectionRow s={s} cols={cols} collapsed={collapsedSections.has(s.key)} onToggle={() => setCollapsedSections((c) => toggleSet(c, s.key))} p={p} />
              {!collapsedSections.has(s.key) &&
                s.rows.map((n) => (
                  <GridRows key={n.key} node={n} depth={s.depth} p={p} order={order} expanded={expanded} toggleExpanded={(id) => setExpanded((x) => toggleNum(x, id))} openChildren={openChildren} toggleChildren={(id) => setOpenChildren((x) => toggleNum(x, id))} gridFields={gridFields} cols={cols} />
                ))}
              {!collapsedSections.has(s.key) && s.rows.length === 0 && (
                <tr className="grid-empty">
                  <td colSpan={cols} style={{ paddingLeft: 24 + s.depth * 16 }}>
                    <span className="muted small">Empty.</span>{' '}
                    <button className="link-btn small" onClick={() => p.onAdd(s.listId)}>
                      Add an entry
                    </button>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {sections.length === 0 && <div className="muted small" style={{ padding: 16 }}>Nothing here yet.</div>}
    </div>
  )
}

function SectionRow({ s, cols, collapsed, onToggle, p }: { s: { key: string; label: string; listId: number; list?: TaskList; rows: Node[]; depth: number }; cols: number; collapsed: boolean; onToggle: () => void; p: ViewProps }) {
  const drop = useDropRow(p.onDrop, () => ({ listId: s.listId }))
  return (
    <tr className={`grid-section ${drop.over ? 'drop-over' : ''}`} {...drop.props} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (s.list) p.onListMenu(e, s.list); else p.onAreaMenu(e, s.listId) }}>
      <td colSpan={cols} style={{ paddingLeft: 8 + s.depth * 16 }}>
        <button className="caret" onClick={onToggle} aria-label={collapsed ? 'Expand section' : 'Collapse section'}>
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        {s.list ? <Folder size={13} style={{ color: s.list.color || undefined }} /> : null} <strong>{s.label}</strong> <span className="muted small">{s.rows.length}</span>
        {s.list && (
          <button className="btn ghost icon sm" title="Add entry here" onClick={() => p.onAdd(s.listId)}>
            <Plus size={12} />
          </button>
        )}
      </td>
    </tr>
  )
}

function GridRows({ node, depth, p, order, expanded, toggleExpanded, openChildren, toggleChildren, gridFields, cols }: { node: Node; depth: number; p: ViewProps; order: number[]; expanded: Set<number>; toggleExpanded: (id: number) => void; openChildren: Set<number>; toggleChildren: (id: number) => void; gridFields: string[]; cols: number }) {
  const e = node.entry!
  const t = p.types[e.kind]
  const selected = p.selection.has(e.id)
  const drop = useDropRow(p.onDrop, () => ({ listId: e.listId, parentId: e.parentId, beforeId: e.id }))
  const subtasks = node.children.map((c) => c.entry!)
  return (
    <>
      <tr
        className={`grid-row ${selected ? 'selected' : ''} ${p.focused === e.id ? 'focused' : ''} ${drop.over ? 'drop-over' : ''} ${e.status === 'done' ? 'is-done' : ''}`}
        draggable
        onDragStart={(ev) => setDrag(ev, { type: 'entries', ids: selected ? [...p.selection.selected] : [e.id], fromList: e.listId })}
        {...drop.props}
        onClick={(ev) => {
          if ((ev.target as Element).closest('input, button')) return
          p.selection.click(e.id, ev, order)
          p.onFocus(e.id)
        }}
        onDoubleClick={() => toggleExpanded(e.id)}
        onContextMenu={(ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          if (!selected) p.selection.click(e.id, { ctrlKey: false, metaKey: false, shiftKey: false }, order)
          p.onFocus(e.id)
          p.onEntryMenu(ev, e)
        }}
        data-entry-row={e.id}
      >
        <td>
          <input type="checkbox" checked={selected} onChange={() => p.selection.toggle(e.id)} aria-label={`Select ${e.title}`} />
        </td>
        <td>{t.core.status !== 'hidden' ? <input type="checkbox" className="done-box" checked={e.status === 'done'} onChange={() => p.onToggleDone(e)} aria-label={`Done: ${e.title}`} /> : null}</td>
        <td style={{ paddingLeft: 8 + depth * 16 }}>
          <span className="row" style={{ gap: 6 }}>
            {node.children.length > 0 ? (
              <button className="caret" onClick={() => toggleChildren(e.id)} aria-label="Toggle subtasks">
                {openChildren.has(e.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            ) : (
              <span className="caret-space" />
            )}
            <KindIcon kind={e.kind} types={p.types} />
            <span className="clamp-1">{e.title}</span>
            {node.children.length > 0 && <span className="muted small">({node.children.filter((c) => c.entry?.status === 'done').length}/{node.children.length})</span>}
          </span>
        </td>
        <td>{t.core.status !== 'hidden' ? <span className={`chip st-${e.status}`}><StatusIcon status={e.status} size={11} /> {humanStatus(e.status)}</span> : <span className="muted small">—</span>}</td>
        <td>{t.core.priority !== 'hidden' ? <PriorityChip priority={e.priority} /> : <span className="muted small">—</span>}</td>
        <td className={dueClass(e)}>{fmtDue(e.dueAt) || <span className="muted small">—</span>}</td>
        <td>
          {e.tags.map((tag) => (
            <span key={tag} className="chip chip-tag">
              #{tag}
            </span>
          ))}
        </td>
        {gridFields.map((k) => (
          <td key={k} className="small">
            {Array.isArray(e.fields[k]) ? (e.fields[k] as string[]).join(', ') : e.fields[k] === true ? 'yes' : e.fields[k] == null || e.fields[k] === '' ? <span className="muted">—</span> : String(e.fields[k])}
          </td>
        ))}
        <td className="muted small">{new Date(e.updatedAt).toLocaleDateString()}</td>
        <td>
          <button className="btn ghost icon sm grid-expand" title={expanded.has(e.id) ? 'Collapse details' : 'Expand details'} onClick={() => toggleExpanded(e.id)}>
            {expanded.has(e.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </td>
      </tr>
      {expanded.has(e.id) && (
        <tr className="grid-detail">
          <td colSpan={cols}>
            <EntryEditor entry={e} types={p.types} subtasks={subtasks} compact onOpenSubtask={(id) => p.onFocus(id)} onAddSubtask={() => p.onAdd(e.listId, e.id)} />
          </td>
        </tr>
      )}
      {openChildren.has(e.id) && node.children.map((c) => <GridRows key={c.key} node={c} depth={depth + 1} p={p} order={order} expanded={expanded} toggleExpanded={toggleExpanded} openChildren={openChildren} toggleChildren={toggleChildren} gridFields={gridFields} cols={cols} />)}
    </>
  )
}
