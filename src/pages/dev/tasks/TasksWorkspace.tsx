import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Check, ChevronDown, ChevronRight, Download, ExternalLink, Folder, FolderPlus, ListTodo, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Pencil, Pin, Plus, Trash2, X } from 'lucide-react'
import { useTaskLists, useTaskMutations, useTaskTypes, type TaskList } from '../../../api/tasks'
import { Modal } from '../../../components/Modal'
import { useUI } from '../../../store/ui'
import { ContextMenuLayer, getDrag, hasDrag, MenuContext, setDrag, useMenu, type DragPayload, type MenuApi, type MenuItem } from './common'
import { ListWindow } from './ListWindow'
import { useTasksLayout, type Floating } from './store'

const COLORS = ['', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#ef4444', '#64748b']

/* ---------- floating window (used by list windows and the lists column) ---------- */

function FloatingWindow({ title, icon, pos, onMove, onRaise, onDock, onClose, onMinimize, children, dragPayload, extraButtons, dataId }: { title: string; icon?: ReactNode; pos: Floating; onMove: (p: Partial<Floating>) => void; onRaise: () => void; onDock: () => void; onClose: () => void; onMinimize: () => void; children: ReactNode; dragPayload?: DragPayload; extraButtons?: ReactNode; dataId: string }) {
  const startDrag = (e: MouseEvent) => {
    if ((e.target as Element).closest('button')) return
    e.preventDefault()
    onRaise()
    const sx = e.clientX
    const sy = e.clientY
    const { x, y } = pos
    const move = (m: globalThis.MouseEvent) => onMove({ x: Math.max(0, x + m.clientX - sx), y: Math.max(0, y + m.clientY - sy) })
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  const startResize = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const { w, h } = pos
    const move = (m: globalThis.MouseEvent) => onMove({ w: Math.max(320, w + m.clientX - sx), h: Math.max(160, h + m.clientY - sy) })
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  return (
    <div className={`task-float ${pos.minimized ? 'minimized' : ''}`} style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.minimized ? undefined : pos.h, zIndex: 40 + pos.z }} onMouseDown={onRaise} data-float={dataId}>
      <div className="task-float-title" onMouseDown={startDrag} onDoubleClick={onDock} title="Drag to move · double-click to dock" draggable={!!dragPayload} onDragStart={(e) => dragPayload && setDrag(e, dragPayload)}>
        {icon} <span className="grow clamp-1">{title}</span>
        {extraButtons}
        <button className="btn ghost icon sm" title={pos.minimized ? 'Restore' : 'Minimize to title bar'} onClick={onMinimize}>
          {pos.minimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
        </button>
        <button className="btn ghost icon sm" title="Dock" onClick={onDock}>
          <Pin size={12} />
        </button>
        <button className="btn ghost icon sm" title="Close" onClick={onClose}>
          <X size={12} />
        </button>
      </div>
      {!pos.minimized && (
        <>
          <div className="task-float-body">{children}</div>
          <div className="task-float-resize" onMouseDown={startResize} />
        </>
      )}
    </div>
  )
}

/* ---------- lists column ---------- */

function ListsColumn({ lists, onOpen, onFloat, menuItems, onNewList, onDropEntries, extraItems }: { lists: TaskList[]; onOpen: (id: number) => void; onFloat: (id: number) => void; menuItems: (l: TaskList) => MenuItem[]; onNewList: () => void; onDropEntries: (payload: DragPayload, listId: number) => void; extraItems?: MenuItem[] }) {
  const menu = useMenu()
  const { updateList, reorderLists } = useTaskMutations()
  const notify = useUI((s) => s.notify)
  const tabs = useTasksLayout((s) => s.tabs)
  const active = useTasksLayout((s) => s.activeTab)
  const floating = useTasksLayout((s) => s.floating)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [over, setOver] = useState<number | null>(null)
  const roots = lists.filter((l) => l.parentId == null).sort((a, b) => a.sortOrder - b.sortOrder)
  const drop = (e: DragEvent, l: TaskList) => {
    const p = getDrag(e)
    setOver(null)
    if (!p) return
    e.preventDefault()
    e.stopPropagation()
    if (p.type === 'entries') onDropEntries(p, l.id)
    else if (p.type === 'list' && p.id !== l.id) {
      const moving = lists.find((x) => x.id === p.id)
      if (!moving) return
      if (moving.parentId === l.parentId) {
        const siblings = lists.filter((x) => x.parentId === l.parentId).sort((a, b) => a.sortOrder - b.sortOrder).map((x) => x.id).filter((id) => id !== p.id)
        siblings.splice(siblings.indexOf(l.id), 0, p.id)
        reorderLists.mutate(siblings)
      } else updateList.mutate({ id: p.id, parentId: l.id }, { onError: (err: Error) => notify(err.message, 'error') })
    }
  }
  const row = (l: TaskList, depth: number) => {
    const kids = lists.filter((x) => x.parentId === l.id).sort((a, b) => a.sortOrder - b.sortOrder)
    const open = !collapsed.has(l.id)
    const isOpen = tabs.includes(l.id) || !!floating[l.id]
    return (
      <div key={l.id}>
        <div
          className={`lists-row ${active === l.id ? 'active' : ''} ${isOpen ? 'is-open' : ''} ${over === l.id ? 'drop-over' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable
          onDragStart={(e) => setDrag(e, { type: 'list', id: l.id })}
          onDragOver={(e) => { if (hasDrag(e)) { e.preventDefault(); if (over !== l.id) setOver(l.id) } }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => drop(e, l)}
          onClick={() => onOpen(l.id)}
          onDoubleClick={() => onFloat(l.id)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); menu.open(e, [{ head: `${l.parentId ? 'Group' : 'List'} · ${l.title.slice(0, 28)}` }, ...menuItems(l)]) }}
          data-list-row={l.id}
        >
          {kids.length > 0 ? (
            <button className="caret" onClick={(e) => { e.stopPropagation(); setCollapsed((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n }) }} aria-label="Toggle">
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="caret-space" />
          )}
          <Folder size={13} style={{ color: l.color || undefined }} />
          <span className="grow clamp-1">{l.title}</span>
          <span className="muted small">{l.counts.entries - l.counts.done || ''}</span>
        </div>
        {open && kids.map((k) => row(k, depth + 1))}
      </div>
    )
  }
  return (
    <div className="lists-column" onContextMenu={(e) => { if ((e.target as Element).closest('.lists-row')) return; e.preventDefault(); menu.open(e, [{ head: 'Lists' }, { label: 'New list', icon: <Plus size={14} />, onClick: onNewList }, ...(extraItems ?? [])]) }} data-lists-column="">
      {roots.map((l) => row(l, 0))}
      {roots.length === 0 && (
        <div className="muted small" style={{ padding: 12 }}>
          No lists yet.{' '}
          <button className="link-btn" onClick={onNewList}>
            Create one
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------- the workspace ---------- */

export function TasksWorkspace() {
  const notify = useUI((s) => s.notify)
  const { data: lists } = useTaskLists()
  const { data: types } = useTaskTypes()
  const { createList, updateList, deleteList, bulk, createEntry } = useTaskMutations()
  const layout = useTasksLayout()
  // Arriving from the context menu ("New note about this page") seeds a note in the first list (made if none).
  const location = useLocation()
  const navigate = useNavigate()
  const seeded = useRef(false)
  useEffect(() => {
    const seed = (location.state as { newNote?: { title: string; text: string } } | null)?.newNote
    if (!seed || !lists || seeded.current) return
    seeded.current = true
    navigate(location.pathname, { replace: true, state: null })
    const place = (listId: number) =>
      createEntry.mutate(
        { listId, kind: 'note', title: seed.title.slice(0, 120) || 'Note', body: seed.text, draft: true },
        { onSuccess: () => { layout.openTab(listId); notify('Note added', 'success') }, onError: (e: Error) => notify(e.message, 'error') },
      )
    if (lists.length) place(lists[0].id)
    else createList.mutate({ title: 'Notes' }, { onSuccess: (l) => place(l.id), onError: (e: Error) => notify(e.message, 'error') })
  }, [lists]) // eslint-disable-line react-hooks/exhaustive-deps
  const [menuState, setMenuState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [prompt, setPrompt] = useState<{ title: string; value: string; cb: (v: string) => void } | null>(null)
  const [closeAsk, setCloseAsk] = useState<number | null>(null)
  const [tabDragOver, setTabDragOver] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuApi: MenuApi = { open: (e, items) => { if ('preventDefault' in e) (e as MouseEvent).preventDefault(); setMenuState({ x: e.clientX, y: e.clientY, items }) }, close: () => setMenuState(null) }
  const closeMenu = useCallback(() => setMenuState(null), [])
  const err = (e: Error) => notify(e.message, 'error')

  // Lists that disappeared (deleted elsewhere) leave the layout.
  useEffect(() => {
    if (!lists) return
    for (const id of [...layout.tabs, ...Object.keys(layout.floating).map(Number)]) if (!lists.some((l) => l.id === id)) layout.forget(id)
  }, [lists]) // eslint-disable-line react-hooks/exhaustive-deps

  const ask = (title: string, value: string, cb: (v: string) => void) => setPrompt({ title, value, cb })
  const newList = (parentId: number | null = null) => ask(parentId ? 'New group (sub-list)' : 'New list', '', (title) => title.trim() && createList.mutate({ title, parentId }, { onSuccess: (l) => !parentId && layout.openTab(l.id), onError: err }))
  const rename = (l: TaskList) => ask(`Rename “${l.title}”`, l.title, (title) => title.trim() && updateList.mutate({ id: l.id, title }, { onError: err }))
  const remove = (l: TaskList) => {
    const n = l.counts.entries
    if (!confirm(`Delete ${l.parentId ? 'group' : 'list'} “${l.title}”${n ? ` and its ${n} entr${n === 1 ? 'y' : 'ies'}` : ''}? This cannot be undone.`)) return
    deleteList.mutate(l.id, { onSuccess: () => { layout.forget(l.id); notify('Deleted', 'success') }, onError: err })
  }
  const listMenuItems = (l: TaskList): MenuItem[] => [
    { label: 'Open in tab', icon: <ExternalLink size={14} />, onClick: () => layout.openTab(l.parentId ? rootOf(l) : l.id) },
    { label: 'Open as floating window', icon: <Maximize2 size={14} />, onClick: () => layout.float(l.parentId ? rootOf(l) : l.id) },
    { label: 'Rename', icon: <Pencil size={14} />, onClick: () => rename(l) },
    { label: 'New group inside', icon: <FolderPlus size={14} />, onClick: () => newList(l.id) },
    { label: 'New list', icon: <Plus size={14} />, onClick: () => newList(null) },
    { label: 'Colour', children: COLORS.map((c) => ({ label: c ? c : 'None', icon: <span className="color-dot" style={{ background: c || 'transparent' }} />, onClick: () => updateList.mutate({ id: l.id, color: c }, { onError: err }) })) },
    { label: 'Export as markdown', icon: <Download size={14} />, onClick: () => window.open(`/api/dev/tasks/lists/${l.id}/export.md`, '_blank') },
    { sep: true },
    { label: `Delete ${l.parentId ? 'group' : 'list'}`, icon: <Trash2 size={14} />, danger: true, onClick: () => remove(l) },
  ]
  const rootOf = (l: TaskList): number => {
    let cur: TaskList | undefined = l
    for (let i = 0; cur && cur.parentId && i < 10; i++) cur = lists?.find((x) => x.id === cur!.parentId)
    return cur?.id ?? l.id
  }
  const dropEntries = (p: DragPayload, listId: number) => p.type === 'entries' && bulk.mutate({ ids: p.ids, action: 'move', listId }, { onSuccess: (r) => notify(`${r.count} moved`, 'success'), onError: err })

  // "Panes": every pane with a check (visible) or a cross (hidden); picking one toggles it.
  const panesItem = (): MenuItem => {
    const mark = (on: boolean) => (on ? <Check size={14} className="mark-on" /> : <X size={14} className="mark-off" />)
    const visible = (id: number) => layout.tabs.includes(id) || (!!layout.floating[id] && !layout.floating[id].minimized)
    const toggleList = (id: number) => {
      if (visible(id)) {
        if (layout.floating[id]) layout.moveFloating(id, { minimized: true })
        else layout.closeTab(id)
      } else if (layout.floating[id]) {
        layout.moveFloating(id, { minimized: false })
        layout.raise(id)
      } else layout.openTab(id)
    }
    return {
      label: 'Panes',
      icon: <PanelsTopLeft size={14} />,
      children: [
        { label: 'Lists column', icon: mark(!layout.listsHidden), onClick: () => layout.toggleLists() },
        { label: 'Preview pane', icon: mark(!layout.previewHidden), onClick: () => layout.togglePreview() },
        { sep: true },
        { head: 'List windows' },
        ...(lists ?? []).map((l) => ({ label: l.title, icon: mark(visible(l.id)), onClick: () => toggleList(l.id) })),
      ],
    }
  }
  const workspaceMenu = (e: MouseEvent) => {
    if ((e.target as Element).closest('.tab, .lists-row, input, textarea, button')) return
    e.preventDefault()
    menuApi.open(e, [{ head: 'Workspace' }, panesItem(), { label: 'New list', icon: <Plus size={14} />, onClick: () => newList(null) }])
  }
  const tabMenu = (e: MouseEvent, l: TaskList) =>
    menuApi.open(e, [
      { head: `Tab · ${l.title.slice(0, 28)}` },
      { label: 'Rename', icon: <Pencil size={14} />, onClick: () => rename(l) },
      { label: 'Undock (floating window)', icon: <Maximize2 size={14} />, onClick: () => layout.float(l.id) },
      { label: 'Close tab', icon: <X size={14} />, onClick: () => layout.closeTab(l.id) },
      { label: 'Close other tabs', onClick: () => layout.tabs.filter((t) => t !== l.id).forEach((t) => layout.closeTab(t)) },
      { label: 'Export as markdown', icon: <Download size={14} />, onClick: () => window.open(`/api/dev/tasks/lists/${l.id}/export.md`, '_blank') },
      { sep: true },
      panesItem(),
      { sep: true },
      { label: 'Delete list', icon: <Trash2 size={14} />, danger: true, onClick: () => remove(l) },
    ])

  // Dropping a tab (or the lists panel) anywhere outside the tab strip undocks it at that spot.
  const onRootDrop = (e: DragEvent) => {
    const p = getDrag(e)
    if (!p || (p.type !== 'tab' && p.type !== 'panel')) return
    if ((e.target as Element).closest('.tab-strip, .lists-row, .task-float')) return
    e.preventDefault()
    const r = rootRef.current?.getBoundingClientRect()
    const x = Math.max(0, e.clientX - (r?.left ?? 0) - 120)
    const y = Math.max(0, e.clientY - (r?.top ?? 0) - 16)
    if (p.type === 'tab') layout.float(p.id, { x, y })
    else layout.setListsPanel({ docked: false, floating: { ...layout.listsPanel.floating, x, y } })
  }

  const listById = (id: number) => lists?.find((l) => l.id === id)
  const active = layout.activeTab != null ? listById(layout.activeTab) : undefined
  const lp = layout.listsPanel
  const panelIcon = <ListTodo size={13} />

  if (!lists || !types) return <div className="muted small" style={{ padding: 16 }}>Loading…</div>

  const listsPanelBody = (
    <>
      <div className="lists-head">
        <strong>Lists</strong>
        <button className="btn ghost icon sm" title="New list" onClick={() => newList(null)}>
          <Plus size={13} />
        </button>
        <button className="btn ghost icon sm" title={lp.docked ? 'Undock the lists column' : 'Dock the lists column'} onClick={() => layout.setListsPanel({ docked: !lp.docked })}>
          {lp.docked ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </button>
      </div>
      <ListsColumn lists={lists} onOpen={(id) => (layout.floating[id] ? layout.raise(id) : layout.openTab(id))} onFloat={(id) => layout.float(id)} menuItems={listMenuItems} onNewList={() => newList(null)} onDropEntries={dropEntries} extraItems={[{ sep: true }, panesItem()]} />
    </>
  )

  return (
    <MenuContext.Provider value={menuApi}>
      <div className="tasks-app" ref={rootRef} onDragOver={(e) => { if (hasDrag(e)) e.preventDefault() }} onDrop={onRootDrop}>
        <div className="tasks-topbar" onContextMenu={workspaceMenu} data-tasks-topbar="">
          <Link to="/dev" className="btn ghost sm">
            ← Developer panel
          </Link>
          <strong className="row" style={{ gap: 6 }}>
            <ListTodo size={15} /> Task manager
          </strong>
          <span className="muted small">
            {lists.length} list{lists.length === 1 ? '' : 's'} · {lists.reduce((a, l) => a + l.counts.entries, 0)} entries · drag entries between lists, tabs and windows · right-click anything
          </span>
          <span className="grow" />
          {!lp.docked && (
            <button className="btn sm" onClick={() => layout.setListsPanel({ docked: true })}>
              <PanelLeftOpen size={13} /> Dock lists
            </button>
          )}
          <button className="btn primary sm" onClick={() => newList(null)}>
            <Plus size={13} /> New list
          </button>
        </div>

        <div className="tasks-body">
          {lp.docked && !layout.listsHidden && (
            <aside className="tasks-lists" style={{ width: lp.width }} draggable onDragStart={(e) => { if ((e.target as Element).closest('.lists-row')) return; setDrag(e, { type: 'panel', id: 'lists' }) }} data-lists-panel="docked">
              {listsPanelBody}
            </aside>
          )}
          <div className="tasks-dock">
            <div
              className="tab-strip"
              onContextMenu={workspaceMenu}
              onDragOver={(e) => { if (hasDrag(e)) e.preventDefault() }}
              onDrop={(e) => {
                const p = getDrag(e)
                if (!p) return
                if (p.type === 'tab' && !(e.target as Element).closest('.tab')) {
                  e.preventDefault()
                  e.stopPropagation()
                  layout.dock(p.id)
                }
              }}
            >
              {layout.tabs.map((id) => {
                const l = listById(id)
                if (!l) return null
                return (
                  <div
                    key={id}
                    className={`tab ${layout.activeTab === id ? 'active' : ''} ${tabDragOver === id ? 'drop-over' : ''}`}
                    draggable
                    onDragStart={(e) => setDrag(e, { type: 'tab', id })}
                    onDragOver={(e) => { if (hasDrag(e)) { e.preventDefault(); if (tabDragOver !== id) setTabDragOver(id) } }}
                    onDragLeave={() => setTabDragOver(null)}
                    onDrop={(e) => {
                      setTabDragOver(null)
                      const p = getDrag(e)
                      if (!p) return
                      e.preventDefault()
                      e.stopPropagation()
                      if (p.type === 'entries') dropEntries(p, id)
                      else if (p.type === 'tab' && p.id !== id) {
                        const tabs = layout.tabs.filter((t) => t !== p.id)
                        tabs.splice(tabs.indexOf(id), 0, p.id)
                        useTasksLayout.setState({ tabs, activeTab: p.id, floating: Object.fromEntries(Object.entries(layout.floating).filter(([k]) => Number(k) !== p.id)) })
                      }
                    }}
                    onClick={() => layout.setActive(id)}
                    onDoubleClick={() => rename(l)}
                    onContextMenu={(e) => tabMenu(e, l)}
                    style={{ borderTopColor: l.color || undefined }}
                    data-tab={id}
                  >
                    <Folder size={12} style={{ color: l.color || undefined }} />
                    <span className="clamp-1">{l.title}</span>
                    <button className="tab-close" title="Close tab" onClick={(e) => { e.stopPropagation(); layout.closeTab(id) }}>
                      <X size={11} />
                    </button>
                  </div>
                )
              })}
              {layout.tabs.length === 0 && <span className="muted small" style={{ padding: '6px 10px' }}>Open a list from the column, or create one.</span>}
            </div>
            <div className="tasks-dock-body">
              {active ? (
                <ListWindow key={active.id} listId={active.id} allLists={lists} types={types} onPrompt={ask} onListMenuItems={listMenuItems} />
              ) : (
                <div className="empty" style={{ margin: 32 }}>
                  <ListTodo size={36} strokeWidth={1.2} />
                  <p>
                    {lists.length ? 'Pick a list on the left to open it here, or drag a tab out to float it.' : 'Create your first list to start collecting notes, to-dos and tasks.'}
                  </p>
                  <button className="btn primary" onClick={() => newList(null)}>
                    <Plus size={14} /> New list
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {Object.entries(layout.floating).map(([k, pos]) => {
          const id = Number(k)
          const l = listById(id)
          if (!l) return null
          return (
            <FloatingWindow key={id} dataId={String(id)} title={l.title} icon={<Folder size={13} style={{ color: l.color || undefined }} />} pos={pos} onMove={(p) => layout.moveFloating(id, p)} onRaise={() => layout.raise(id)} onDock={() => layout.dock(id)} onClose={() => setCloseAsk(id)} onMinimize={() => layout.moveFloating(id, { minimized: !pos.minimized })} dragPayload={{ type: 'tab', id }} extraButtons={<button className="btn ghost icon sm" title="Rename" onClick={() => rename(l)}><Pencil size={12} /></button>}>
              <ListWindow listId={id} allLists={lists} types={types} onPrompt={ask} onListMenuItems={listMenuItems} />
            </FloatingWindow>
          )
        })}
        {!lp.docked && !layout.listsHidden && (
          <FloatingWindow dataId="lists" title="Lists" icon={panelIcon} pos={lp.floating} onMove={(p) => layout.moveListsPanel(p)} onRaise={() => layout.moveListsPanel({ z: layout.nextZ })} onDock={() => layout.setListsPanel({ docked: true })} onClose={() => layout.setListsPanel({ docked: true })} onMinimize={() => layout.moveListsPanel({ minimized: !lp.floating.minimized })} dragPayload={{ type: 'panel', id: 'lists' }}>
            <div className="tasks-lists tasks-lists-float">{listsPanelBody}</div>
          </FloatingWindow>
        )}

        <ContextMenuLayer state={menuState} onClose={closeMenu} />

        {prompt && (
          <Modal open title={prompt.title} onClose={() => setPrompt(null)}>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault()
                const v = prompt.value
                setPrompt(null)
                prompt.cb(v)
              }}
            >
              <input className="input" value={prompt.value} onChange={(e) => setPrompt({ ...prompt, value: e.target.value })} autoFocus aria-label={prompt.title} />
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn" onClick={() => setPrompt(null)}>
                  Cancel
                </button>
                <button className="btn primary">OK</button>
              </div>
            </form>
          </Modal>
        )}
        {closeAsk != null && listById(closeAsk) && (
          <Modal open title={`Close “${listById(closeAsk)!.title}”`} onClose={() => setCloseAsk(null)}>
            <div className="stack" style={{ gap: 10 }}>
              <p className="muted small" style={{ margin: 0 }}>Closing a floating window: dock it back as a tab, close it (the list stays in the column), or delete the list for good.</p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={() => { layout.dock(closeAsk); setCloseAsk(null) }}>
                  <Pin size={13} /> Dock as tab
                </button>
                <button className="btn" onClick={() => { layout.forget(closeAsk); setCloseAsk(null) }}>
                  <X size={13} /> Just close
                </button>
                <button className="btn danger" onClick={() => { const l = listById(closeAsk)!; setCloseAsk(null); remove(l) }}>
                  <Trash2 size={13} /> Delete list
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </MenuContext.Provider>
  )
}
