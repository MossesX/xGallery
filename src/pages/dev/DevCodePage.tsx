import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Download, FileCode2, FilePlus2, Save, Search, Trash2, Undo2 } from 'lucide-react'
import { api } from '../../api/client'
import { useChanges, useDevFile, useDevFiles, useInvalidateWorkspace } from '../../api/dev'
import { useUI } from '../../store/ui'

interface Node {
  name: string
  path: string
  size: number
  children?: Node[]
}

function buildTree(files: { path: string; size: number }[]): Node[] {
  const root: Node = { name: '', path: '', size: 0, children: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let cur = root
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1
      let next = cur.children!.find((c) => c.name === part && (isLeaf ? !c.children : !!c.children))
      if (!next) {
        next = { name: part, path: parts.slice(0, i + 1).join('/'), size: isLeaf ? f.size : 0, children: isLeaf ? undefined : [] }
        cur.children!.push(next)
      }
      cur = next
    })
  }
  const sort = (n: Node) => {
    n.children?.sort((a, b) => (!!b.children === !!a.children ? a.name.localeCompare(b.name) : a.children ? -1 : 1))
    n.children?.forEach(sort)
  }
  sort(root)
  return root.children!
}

function Tree({ nodes, depth, open, toggle, select, selected, changed }: { nodes: Node[]; depth: number; open: Set<string>; toggle: (p: string) => void; select: (p: string) => void; selected: string | null; changed: Map<string, string> }) {
  return (
    <>
      {nodes.map((n) =>
        n.children ? (
          <div key={n.path}>
            <button className="tree-row dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(n.path)}>
              {open.has(n.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {n.name}
            </button>
            {open.has(n.path) && <Tree nodes={n.children} depth={depth + 1} open={open} toggle={toggle} select={select} selected={selected} changed={changed} />}
          </div>
        ) : (
          <button key={n.path} className={`tree-row file ${selected === n.path ? 'active' : ''} ${changed.has(n.path) ? `changed-${changed.get(n.path)}` : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => select(n.path)} title={n.path}>
            <FileCode2 size={12} /> {n.name}
            {changed.has(n.path) && <span className="tree-mark">{changed.get(n.path)}</span>}
          </button>
        ),
      )}
    </>
  )
}

/** The source workspace: tree, editor, per-file diff against the snapshot, save / restore / delete. */
export function DevCodePage() {
  const notify = useUI((s) => s.notify)
  const invalidate = useInvalidateWorkspace()
  const [params, setParams] = useSearchParams()
  const selected = params.get('path')
  const { data: files } = useDevFiles()
  const { data: changes } = useChanges()
  const { data: file } = useDevFile(selected)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set(['src', 'server', 'server/src']))
  const [text, setText] = useState('')
  const [view, setView] = useState<'edit' | 'diff'>('edit')
  const [newPath, setNewPath] = useState('')
  useEffect(() => setText(file?.file.contents ?? ''), [file?.file.path, file?.file.contents])

  const changed = useMemo(() => new Map((changes?.files ?? []).map((f) => [f.path, f.status])), [changes])
  const tree = useMemo(() => {
    const list = (files?.files ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase()))
    return buildTree(list)
  }, [files, filter])
  const dirty = !!file && text !== file.file.contents

  const save = useMutation({
    mutationFn: (v: { path: string; contents: string }) => api.put<{ added: number; removed: number; created: boolean }>('/api/dev/file', v),
    onSuccess: (r, v) => {
      invalidate()
      notify(`${r.created ? 'Created' : 'Saved'} ${v.path} (+${r.added} / −${r.removed})`, 'success')
      if (v.path !== selected) setParams({ path: v.path })
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const restore = useMutation({ mutationFn: (p: string) => api.post('/api/dev/file/restore', { path: p }), onSuccess: () => { invalidate(); notify('File restored from the source snapshot', 'success') }, onError: (e: Error) => notify(e.message, 'error') })
  const del = useMutation({ mutationFn: (p: string) => api.del(`/api/dev/file?path=${encodeURIComponent(p)}`), onSuccess: () => { invalidate(); setParams({}); notify('File deleted (checkpointed first)', 'success') }, onError: (e: Error) => notify(e.message, 'error') })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && selected && dirty) {
        e.preventDefault()
        save.mutate({ path: selected, contents: text })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected, dirty, text, save])

  const toggle = (p: string) => setOpen((s) => {
    const n = new Set(s)
    if (n.has(p)) n.delete(p)
    else n.add(p)
    return n
  })
  const lines = text.split('\n').length

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="eyebrow">Developer</div>
          <h1 style={{ margin: 0 }}>Code editor</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Workspace copy of snapshot {files?.sourceVersion} · every save is checkpointed and logged · {changes?.files.length ?? 0} changed file{changes?.files.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="new/file/path.ts" aria-label="New file path" style={{ width: 220 }} />
          <button className="btn sm" onClick={() => { if (newPath.trim()) { save.mutate({ path: newPath.trim(), contents: '' }); setNewPath('') } }} disabled={!newPath.trim()}>
            <FilePlus2 size={13} /> New file
          </button>
          <a className="btn sm" href="/api/dev/patch">
            <Download size={13} /> Export patch
          </a>
        </div>
      </div>

      {!!changes?.files.length && (
        <div className="card" style={{ padding: 10 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="eyebrow" style={{ marginRight: 6 }}>Changed</span>
            {changes.files.map((f) => (
              <button key={f.path} className={`chip changed-${f.status}`} onClick={() => setParams({ path: f.path })} title={`${f.status === 'A' ? 'added' : f.status === 'D' ? 'deleted' : 'modified'} · +${f.added} / −${f.removed}`}>
                {f.path} <span className="muted">+{f.added}/−{f.removed}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="dev-code">
        <aside className="card dev-tree">
          <div className="search" style={{ margin: 8 }}>
            <Search size={13} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files…" aria-label="Filter files" />
          </div>
          <div className="dev-tree-body">
            <Tree nodes={tree} depth={0} open={filter ? new Set((files?.files ?? []).flatMap((f) => f.path.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/')))) : open} toggle={toggle} select={(p) => setParams({ path: p })} selected={selected} changed={changed} />
          </div>
        </aside>
        <div className="card dev-editor">
          {!selected ? (
            <div className="empty" style={{ margin: 24 }}>
              <FileCode2 size={30} strokeWidth={1.2} />
              <p>Pick a file to read or edit it. Changes go to the workspace copy, never straight to the live site.</p>
            </div>
          ) : !file ? (
            <div className="muted small" style={{ padding: 16 }}>
              Loading…
            </div>
          ) : !file.file.text ? (
            <div className="muted small" style={{ padding: 16 }}>
              {file.file.path} is a binary file ({file.file.size} bytes).
            </div>
          ) : (
            <>
              <div className="dev-editor-head">
                <code className="grow clamp-1">{file.file.path}</code>
                <span className="muted small">
                  {lines} lines · {file.file.size} bytes{dirty ? ' · unsaved' : ''}
                </span>
                <div className="feed-tabs">
                  <button className={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>
                    Edit
                  </button>
                  <button className={view === 'diff' ? 'active' : ''} onClick={() => setView('diff')}>
                    Diff{file.diff ? '' : ' (none)'}
                  </button>
                </div>
                <button className="btn primary sm" onClick={() => save.mutate({ path: file.file.path, contents: text })} disabled={!dirty || save.isPending} title="Ctrl/⌘ S">
                  <Save size={13} /> Save
                </button>
                <button className="btn ghost sm" onClick={() => confirm('Put this file back as it is in the source snapshot?') && restore.mutate(file.file.path)} disabled={!changed.has(file.file.path)} title="Restore from the source snapshot">
                  <Undo2 size={13} /> Restore
                </button>
                <button className="btn ghost icon sm danger" onClick={() => confirm(`Delete ${file.file.path} from the workspace?`) && del.mutate(file.file.path)} title="Delete file">
                  <Trash2 size={13} />
                </button>
              </div>
              {view === 'edit' ? (
                <div className="dev-editor-body">
                  <pre className="dev-gutter" aria-hidden="true">
                    {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
                  </pre>
                  <textarea className="dev-textarea" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="File contents" onKeyDown={(e) => {
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const t = e.currentTarget
                      const s = t.selectionStart
                      setText(text.slice(0, s) + '  ' + text.slice(t.selectionEnd))
                      requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2))
                    }
                  }} />
                </div>
              ) : (
                <pre className="diff dev-diff">{file.diff || 'This file is identical to the source snapshot.'}</pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
