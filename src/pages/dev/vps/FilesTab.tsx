import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Download, File, FileText, Folder, FolderPlus, Home, Link2, Pencil, RefreshCw, Save, Shield, Trash2, Upload, X } from 'lucide-react'
import { uploadRaw } from '../../../api/client'
import { fmtBytes, useInvalidateVps, useVps, VPS, type FileEntry } from '../../../api/vps'
import { useUI } from '../../../store/ui'
import { Busy, Out, relTime, useAction, useVpsCtx } from './common'

const BOOKMARKS = ['/opt/xgallery', '/opt/sites', '/root/docker-exports', '/var/lib/docker/volumes', '/etc', '/var/log', '/root']

/** SFTP browser: navigate, edit text files in place, upload (with progress), download, mkdir, rename, chmod, delete. */
export function FilesTab() {
  const { p, profile } = useVpsCtx()
  const notify = useUI((s) => s.notify)
  const invalidate = useInvalidateVps()
  const [path, setPath] = useState('/opt/xgallery')
  const [typed, setTyped] = useState(path)
  const list = useVps<{ path: string; entries: FileEntry[] }>(p(`/files?path=${encodeURIComponent(path)}`))
  const { run, out, busy } = useAction()
  const [editing, setEditing] = useState<{ path: string; content: string; dirty: boolean; binary: boolean; size: number } | null>(null)
  const [upl, setUpl] = useState<{ name: string; frac: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => setTyped(path), [path])
  const go = (next: string) => setPath(next.replace(/\/+/g, '/').replace(/(.)\/$/, '$1') || '/')
  const parent = path === '/' ? '/' : path.replace(/\/[^/]+$/, '') || '/'
  const full = (name: string) => (path === '/' ? `/${name}` : `${path}/${name}`)
  const openFile = async (e: FileEntry) => {
    if (e.size > 2_000_000) return notify('Too large to edit here: download it instead', 'error')
    try {
      const r = await fetch(`${VPS}${p(`/files/read?path=${encodeURIComponent(full(e.name))}`)}`, { credentials: 'include' })
      const d = (await r.json()) as { path: string; size: number; binary: boolean; content: string; error?: string }
      if (!r.ok) throw new Error(d.error ?? 'Could not read the file')
      setEditing({ path: d.path, content: d.content, dirty: false, binary: d.binary, size: d.size })
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }
  const save = async () => {
    if (!editing) return
    const r = await run({ method: 'PUT', path: '/files/write', body: { path: editing.path, content: editing.content }, label: `Saved ${editing.path}`, invalidate: ['/files'], key: 'save' })
    if (r) setEditing({ ...editing, dirty: false })
  }
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    for (const f of Array.from(files)) {
      setUpl({ name: f.name, frac: 0 })
      try {
        await uploadRaw(`${VPS}${p('/files/upload')}`, f, 'application/octet-stream', { path: full(f.name) }, (frac) => setUpl({ name: f.name, frac }))
        notify(`Uploaded ${f.name}`, 'success')
      } catch (e) {
        notify((e as Error).message, 'error')
      }
    }
    setUpl(null)
    invalidate('/files')
  }
  const mkdir = () => {
    const name = window.prompt('New folder name')
    if (name) run({ path: '/files/mkdir', body: { path: full(name) }, label: `Created ${name}`, invalidate: ['/files'] })
  }
  const newFile = () => {
    const name = window.prompt('New file name')
    if (name) setEditing({ path: full(name), content: '', dirty: true, binary: false, size: 0 })
  }
  const rename = (e: FileEntry) => {
    const to = window.prompt('Rename / move to', full(e.name))
    if (to && to !== full(e.name)) run({ path: '/files/rename', body: { from: full(e.name), to }, label: `Renamed ${e.name}`, invalidate: ['/files'] })
  }
  const chmod = (e: FileEntry) => {
    const mode = window.prompt(`Permissions for ${e.name} (octal)`, e.mode)
    if (mode) run({ path: '/files/chmod', body: { path: full(e.name), mode }, label: `chmod ${mode} ${e.name}`, invalidate: ['/files'] })
  }
  const del = (e: FileEntry) => run({ method: 'DELETE', path: `/files?path=${encodeURIComponent(full(e.name))}${e.type === 'dir' ? '&force=1' : ''}`, label: `Deleted ${e.name}`, confirm: `Delete ${full(e.name)}${e.type === 'dir' ? ' and everything in it' : ''}?`, invalidate: ['/files'] })
  const dl = (e: FileEntry) => `${VPS}${p(`/files/download?path=${encodeURIComponent(full(e.name))}`)}`

  return (
    <div className="vps-files" data-vps-files="" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files) }}>
      <div className="stack" style={{ gap: 8, minWidth: 0 }}>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn ghost icon sm" title="Up" onClick={() => go(parent)} disabled={path === '/'}>
            <ArrowUp size={13} />
          </button>
          <button className="btn ghost icon sm" title="Deploy dir" onClick={() => go('/opt/xgallery')}>
            <Home size={13} />
          </button>
          <form className="grow row" style={{ gap: 4, flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); go(typed.startsWith('/') ? typed : `/${typed}`) }}>
            <input className="input sm mono grow" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Path" />
          </form>
          <button className="btn ghost icon sm" title="Refresh" onClick={() => list.refetch()}>
            <RefreshCw size={13} />
          </button>
          <button className="btn sm" onClick={mkdir}>
            <FolderPlus size={12} /> Folder
          </button>
          <button className="btn sm" onClick={newFile}>
            <FileText size={12} /> File
          </button>
          <button className="btn sm" onClick={() => fileInput.current?.click()} data-vps-upload="">
            <Upload size={12} /> Upload
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
        </div>
        <div className="row" style={{ gap: 4 }}>
          {BOOKMARKS.map((b) => (
            <button key={b} className={`chip chip-tag ${path === b ? 'active' : ''}`} onClick={() => go(b)}>
              {b}
            </button>
          ))}
        </div>
        {upl && (
          <div className="dev-session-chip">
            Uploading {upl.name} · {Math.round(upl.frac * 100)}%
          </div>
        )}
        {list.error && <div className="dev-session-chip warn">{(list.error as Error).message}</div>}
        <div className="card table-card vps-file-list">
          <table className="table compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
                <th>Mode</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list.data?.entries ?? []).map((e) => (
                <tr key={e.name} data-vps-file={e.name}>
                  <td>
                    <button className="link row" style={{ gap: 6, flexWrap: 'nowrap' }} onClick={() => (e.type === 'dir' ? go(full(e.name)) : openFile(e))}>
                      {e.type === 'dir' ? <Folder size={14} /> : e.type === 'link' ? <Link2 size={14} /> : <File size={14} />}
                      {e.name}
                    </button>
                  </td>
                  <td className="small">{e.type === 'dir' ? '' : fmtBytes(e.size)}</td>
                  <td className="small muted">{relTime(e.mtime)}</td>
                  <td className="mono small">{e.mode}</td>
                  <td>
                    <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                      {e.type !== 'dir' && (
                        <a className="btn ghost icon sm" title="Download" href={dl(e)} download>
                          <Download size={12} />
                        </a>
                      )}
                      <button className="btn ghost icon sm" title="Rename / move" onClick={() => rename(e)}>
                        <Pencil size={12} />
                      </button>
                      <button className="btn ghost icon sm" title="Permissions" onClick={() => chmod(e)}>
                        <Shield size={12} />
                      </button>
                      <button className="btn ghost icon sm danger" title="Delete" onClick={() => del(e)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.data && !list.data.entries.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    Empty folder. Drop files here to upload.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {out && <Out out={out} title="Last action" maxHeight={120} />}
      </div>
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        {editing ? (
          <>
            <div className="row between">
              <span className="mono small" title={editing.path}>
                {editing.path} {editing.dirty && <span className="chip prio-high">unsaved</span>}
              </span>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn primary sm" onClick={save} disabled={!editing.dirty || editing.binary || busy === 'save'} data-vps-save-file="">
                  <Busy on={busy === 'save'}>
                    <Save size={12} />
                  </Busy>{' '}
                  Save
                </button>
                <button className="btn ghost icon sm" onClick={() => (!editing.dirty || window.confirm('Discard unsaved changes?')) && setEditing(null)}>
                  <X size={13} />
                </button>
              </div>
            </div>
            {editing.binary ? <p className="muted">Binary file ({fmtBytes(editing.size)}); download it instead.</p> : <textarea className="textarea mono vps-editor" value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value, dirty: true })} spellCheck={false} aria-label="File content" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() } }} />}
          </>
        ) : (
          <div className="card muted small" style={{ minHeight: 200 }}>
            Click a file to edit it here (Ctrl+S saves). Edits go straight to the server over SFTP: for the app's own source use the Code editor, which keeps checkpoints. Profile: {profile || 'default'}.
          </div>
        )}
      </div>
    </div>
  )
}
