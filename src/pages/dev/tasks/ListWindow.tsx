import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { ArrowRightLeft, CheckCheck, Copy, Download, Flag, FolderPlus, LayoutList, ListTree, Plus, Search, Tag, Trash2, X } from 'lucide-react'
import { useListContents, useTaskMutations, type Entry, type EntryKind, type TaskList, type TypeSchema } from '../../../api/tasks'
import { useUI } from '../../../store/ui'
import { childrenOf, listPath, useMenu, useSelection, type DragPayload, type MenuItem } from './common'
import { EntryEditor } from './EntryEditor'
import { DEFAULT_VIEW, useTasksLayout, type ListView, type TreeRoot } from './store'
import { GridView, TreeView, visibleEntries, type DropTarget } from './views'

const ROOTS: [TreeRoot, string][] = [
  ['structure', 'Lists & groups'],
  ['kind', 'Kind'],
  ['status', 'Status'],
  ['priority', 'Priority'],
  ['tag', 'Tag'],
  ['due', 'Due date'],
]

interface Props {
  listId: number
  allLists: TaskList[]
  types: TypeSchema
  onPrompt: (title: string, initial: string, cb: (value: string) => void) => void
  onListMenuItems: (list: TaskList) => MenuItem[]
}

/** One open list: its toolbar, the tree or grid view, the preview pane, and every group action. */
export function ListWindow({ listId, allLists, types, onPrompt, onListMenuItems }: Props) {
  const notify = useUI((s) => s.notify)
  const menu = useMenu()
  const { data } = useListContents(listId)
  const viewRaw = useTasksLayout((s) => s.views[listId])
  const view = useMemo(() => ({ ...DEFAULT_VIEW, ...(viewRaw ?? {}) }), [viewRaw])
  const setView = useTasksLayout((s) => s.setView)
  const previewWidth = useTasksLayout((s) => s.previewWidth)
  const setPreviewWidth = useTasksLayout((s) => s.setPreviewWidth)
  const { createEntry, createList, bulk, updateEntry, reorder } = useTaskMutations()
  const selection = useSelection()
  const [focused, setFocused] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [newKind, setNewKind] = useState<EntryKind>('task')
  const entries = useMemo(() => visibleEntries(data?.entries ?? [], view, q), [data, view, q])
  const focusedEntry = data?.entries.find((e) => e.id === focused) ?? null
  useEffect(() => {
    if (focused != null && data && !data.entries.some((e) => e.id === focused)) setFocused(null)
  }, [data, focused])

  const ids = [...selection.selected]
  const sel = (data?.entries ?? []).filter((e) => selection.has(e.id))

  const err = (e: Error) => notify(e.message, 'error')
  const add = (targetListId: number, parentId: number | null = null, kind: EntryKind = newKind) =>
    onPrompt(`New ${types[kind].label.toLowerCase()}${parentId ? ' (subtask)' : ''}`, '', (title) => {
      if (!title.trim()) return
      createEntry.mutate(
        { listId: targetListId, parentId, kind, title, draft: true },
        {
          onSuccess: (r) => {
            setFocused(r.entry.id)
            selection.setAll([r.entry.id])
            if (r.warnings.length) notify(`Saved as a draft: ${r.warnings.join('. ')}`, 'info')
          },
          onError: err,
        },
      )
    })
  const addGroup = (parentId: number) => onPrompt('New group (sub-list)', '', (title) => title.trim() && createList.mutate({ title, parentId }, { onError: err }))
  const toggleDone = (e: Entry) => updateEntry.mutate({ id: e.id, status: e.status === 'done' ? types[e.kind].defaultStatus : 'done', draft: true }, { onError: err })

  const onDrop = (payload: DragPayload, target: DropTarget) => {
    if (payload.type !== 'entries') return
    const moving = payload.ids.filter((id) => id !== target.parentId)
    if (!moving.length) return
    const sameList = data?.entries.filter((e) => moving.includes(e.id)).every((e) => e.listId === target.listId && e.parentId === (target.parentId ?? null))
    if (sameList && target.beforeId && view.sort === 'manual') {
      // Reorder among siblings: place the moved entries before the drop row.
      const siblings = childrenOf(data!.entries, target.parentId ?? null, target.listId).map((e) => e.id)
      const rest = siblings.filter((id) => !moving.includes(id))
      const at = rest.indexOf(target.beforeId)
      rest.splice(at < 0 ? rest.length : at, 0, ...moving)
      reorder.mutate(rest, { onError: err })
      return
    }
    bulk.mutate({ ids: moving, action: 'move', listId: target.listId, parentId: target.parentId ?? null }, { onSuccess: (r) => notify(`${r.count} moved`, 'success'), onError: err })
  }

  /* ----- menus ----- */
  const moveTargets = (): MenuItem[] =>
    allLists.map((l) => ({ label: listPath(allLists, l.id), onClick: () => bulk.mutate({ ids, action: 'move', listId: l.id }, { onSuccess: () => { selection.clear(); notify(`Moved to ${l.title}`, 'success') }, onError: err }) }))
  const statusItems = (kind: EntryKind): MenuItem[] => types[kind].statuses.map((s) => ({ label: s.replace('_', ' '), onClick: () => bulk.mutate({ ids, action: 'patch', patch: { status: s } }, { onError: err }) }))
  const priorityItems = (kind: EntryKind): MenuItem[] => types[kind].priorities.map((pr) => ({ label: pr, onClick: () => bulk.mutate({ ids, action: 'patch', patch: { priority: pr } }, { onError: err }) }))
  const groupItems = (anchorKind: EntryKind): MenuItem[] => [
    { label: 'Mark done', icon: <CheckCheck size={14} />, onClick: () => bulk.mutate({ ids, action: 'patch', patch: { status: 'done' } }, { onError: err }) },
    { label: 'Set status', icon: <Flag size={14} />, children: statusItems(anchorKind) },
    { label: 'Set priority', icon: <Flag size={14} />, children: priorityItems(anchorKind) },
    { label: 'Change kind', children: (['note', 'todo', 'task'] as EntryKind[]).map((k) => ({ label: types[k].label, onClick: () => bulk.mutate({ ids, action: 'patch', patch: { kind: k } }, { onSuccess: (r) => r.errors?.length && notify(r.errors.join('. '), 'error'), onError: err }) })) },
    { label: 'Add tag…', icon: <Tag size={14} />, onClick: () => onPrompt('Tag to add', '', (tag) => tag.trim() && bulk.mutate({ ids, action: 'patch', patch: { addTags: [tag.trim().toLowerCase()] } }, { onError: err })) },
    { label: 'Move to…', icon: <ArrowRightLeft size={14} />, children: moveTargets() },
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: () => bulk.mutate({ ids, action: 'duplicate' }, { onError: err }) },
    { sep: true },
    { label: `Delete ${ids.length > 1 ? `${ids.length} entries` : 'entry'}`, icon: <Trash2 size={14} />, danger: true, onClick: () => confirm(`Delete ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}?`) && bulk.mutate({ ids, action: 'delete' }, { onSuccess: () => selection.clear(), onError: err }) },
  ]
  const entryMenu = (e: MouseEvent, entry: Entry) => {
    const items: MenuItem[] = [{ head: ids.length > 1 ? `${ids.length} selected` : `${types[entry.kind].label} · ${entry.title.slice(0, 30)}` }]
    if (ids.length <= 1) {
      items.push({ label: 'Open in preview', icon: <LayoutList size={14} />, onClick: () => setFocused(entry.id) })
      if (types[entry.kind].core.subtasks !== 'hidden') items.push({ label: 'Add subtask', icon: <Plus size={14} />, onClick: () => add(entry.listId, entry.id) })
      items.push({ label: 'Rename', onClick: () => onPrompt('Rename entry', entry.title, (title) => title.trim() && updateEntry.mutate({ id: entry.id, title, draft: true }, { onError: err })) })
      items.push({ sep: true })
    }
    items.push(...groupItems(entry.kind))
    menu.open(e, items)
  }
  const listMenu = (e: MouseEvent, list: TaskList) => menu.open(e, [{ head: `${list.parentId ? 'Group' : 'List'} · ${list.title.slice(0, 30)}` }, ...addItems(list.id), { sep: true }, ...onListMenuItems(list)])
  const addItems = (targetListId: number, parentId: number | null = null): MenuItem[] => [
    ...(['note', 'todo', 'task'] as EntryKind[]).map((k) => ({ label: `New ${types[k].label.toLowerCase()}`, icon: <Plus size={14} />, onClick: () => add(targetListId, parentId, k) })),
    ...(parentId ? [] : [{ label: 'New group (sub-list)', icon: <FolderPlus size={14} />, onClick: () => addGroup(targetListId) }]),
  ]
  const areaMenu = (e: MouseEvent, targetListId: number) => menu.open(e, [{ head: 'This list' }, ...addItems(targetListId), { sep: true }, { label: view.mode === 'tree' ? 'Switch to grid' : 'Switch to tree', onClick: () => setView(listId, { mode: view.mode === 'tree' ? 'grid' : 'tree' }) }, { label: view.showDone ? 'Hide done' : 'Show done', onClick: () => setView(listId, { showDone: !view.showDone }) }, { label: 'Select all', onClick: () => selection.setAll(entries.map((x) => x.id)) }])

  if (!data) return <div className="muted small" style={{ padding: 16 }}>Loading…</div>
  const viewProps = { rootId: listId, lists: data.lists, entries, types, view, selection, focused, onFocus: setFocused, onEntryMenu: entryMenu, onListMenu: listMenu, onAreaMenu: areaMenu, onDrop, onToggleDone: toggleDone, onAdd: (l: number, parent?: number | null) => add(l, parent ?? null), onViewChange: (patch: Partial<ListView>) => setView(listId, patch) }
  const subtasksOf = (id: number) => childrenOf(data.entries, id)

  return (
    <div className="list-window" data-list-window={listId}>
      <div className="lw-toolbar">
        <div className="feed-tabs sm">
          <button className={view.mode === 'tree' ? 'active' : ''} onClick={() => setView(listId, { mode: 'tree' })} title="Tree view">
            <ListTree size={13} /> Tree
          </button>
          <button className={view.mode === 'grid' ? 'active' : ''} onClick={() => setView(listId, { mode: 'grid' })} title="Grid view">
            <LayoutList size={13} /> Grid
          </button>
        </div>
        <select className="select sm" value={view.root} onChange={(e) => setView(listId, { root: e.target.value as TreeRoot })} aria-label="Group by" title="Root of the tree / grid sections">
          {ROOTS.map(([v, l]) => (
            <option key={v} value={v}>
              By {l.toLowerCase()}
            </option>
          ))}
        </select>
        <select className="select sm" value={view.filterKind} onChange={(e) => setView(listId, { filterKind: e.target.value as ListView['filterKind'] })} aria-label="Kind filter">
          <option value="">All kinds</option>
          {(['note', 'todo', 'task'] as EntryKind[]).map((k) => (
            <option key={k} value={k}>
              {types[k].label}s
            </option>
          ))}
        </select>
        <label className="checkbox small">
          <input type="checkbox" checked={view.showDone} onChange={(e) => setView(listId, { showDone: e.target.checked })} /> done
        </label>
        <div className="search sm grow">
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" aria-label="Filter entries" />
        </div>
        <select className="select sm" value={newKind} onChange={(e) => setNewKind(e.target.value as EntryKind)} aria-label="New entry kind">
          {(['note', 'todo', 'task'] as EntryKind[]).map((k) => (
            <option key={k} value={k}>
              {types[k].label}
            </option>
          ))}
        </select>
        <button className="btn primary sm" onClick={() => add(listId)} title="Add entry">
          <Plus size={13} /> Add
        </button>
        <button className="btn sm" onClick={() => addGroup(listId)} title="Add a group (sub-list)">
          <FolderPlus size={13} />
        </button>
        <a className="btn ghost icon sm" href={`/api/dev/tasks/lists/${listId}/export.md`} title="Export as markdown">
          <Download size={13} />
        </a>
      </div>

      {ids.length > 0 && (
        <div className="lw-selection" data-selection-bar="">
          <strong>{ids.length} selected</strong>
          <button className="btn sm" title="Mark done" onClick={() => bulk.mutate({ ids, action: 'patch', patch: { status: 'done' } }, { onError: err })}>
            <CheckCheck size={13} />
          </button>
          <button className="btn sm" title="Set status / priority / kind…" onClick={(e) => menu.open(e, groupItems(sel[0]?.kind ?? 'task'))}>
            <Flag size={13} /> More
          </button>
          <button className="btn sm" title="Move to…" onClick={(e) => menu.open(e, moveTargets())}>
            <ArrowRightLeft size={13} />
          </button>
          <button className="btn sm" title="Duplicate" onClick={() => bulk.mutate({ ids, action: 'duplicate' }, { onError: err })}>
            <Copy size={13} />
          </button>
          <button className="btn sm danger" title="Delete selected" onClick={() => confirm(`Delete ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}?`) && bulk.mutate({ ids, action: 'delete' }, { onSuccess: () => selection.clear(), onError: err })}>
            <Trash2 size={13} />
          </button>
          <button className="btn ghost icon sm" title="Clear selection" onClick={selection.clear}>
            <X size={13} />
          </button>
        </div>
      )}

      <div className="lw-body">
        <div className="lw-main">{view.mode === 'tree' ? <TreeView {...viewProps} /> : <GridView {...viewProps} />}</div>
        {view.mode === 'tree' && (
          <>
            <div
              className="lw-resize"
              onMouseDown={(ev) => {
                const startX = ev.clientX
                const startW = previewWidth
                const move = (m: globalThis.MouseEvent) => setPreviewWidth(Math.min(800, Math.max(240, startW - (m.clientX - startX))))
                const up = () => {
                  document.removeEventListener('mousemove', move)
                  document.removeEventListener('mouseup', up)
                }
                document.addEventListener('mousemove', move)
                document.addEventListener('mouseup', up)
              }}
            />
            <aside className="lw-preview" style={{ width: previewWidth }}>
              {focusedEntry ? (
                <EntryEditor entry={focusedEntry} types={types} subtasks={subtasksOf(focusedEntry.id)} onOpenSubtask={setFocused} onAddSubtask={() => add(focusedEntry.listId, focusedEntry.id)} />
              ) : (
                <div className="muted small" style={{ padding: 16 }}>
                  Select an entry to see and edit its details here.
                </div>
              )}
            </aside>
          </>
        )}
      </div>
    </div>
  )
}
