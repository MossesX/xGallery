import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowUp, Download, File, FileText, Folder, FolderPlus, Link2, Pencil, RefreshCw, Save, Shield, Trash2, Upload, X } from 'lucide-react'
import { api, uploadRaw } from '../../../api/client'
import { fmtBytes, VPS, withProfile, type ExecOut, type FileEntry } from '../../../api/vps'
import { useUI } from '../../../store/ui'

/**
 * One SFTP client tab of the commander. Everything goes through the panel server's SFTP routes
 * (no shell), so the same snippets work from a phone. The parent drives it through the ref: the
 * FTP snippets map to these actions.
 */

export type FtpKind = 'list' | 'upload' | 'download' | 'mkdir' | 'rename' | 'chmod' | 'delete' | 'edit' | 'newfile' | 'cd'
export interface FtpHandle {
  act: (kind: FtpKind, opts?: { path?: string; dir?: string; mode?: string; src?: string; dst?: string }) => void
  cd: (path: string) => void
  path: () => string
  selected: () => string[]
}
interface Props {
  profile: string
  initialPath: string
  visible: boolean
  onPath?: (p: string) => void
  onLog?: (line: string, ok: boolean) => void
}

export const FtpPane = forwardRef<FtpHandle, Props>(function FtpPane({ profile, initialPath, visible, onPath, onLog }, ref) {
  const notify = useUI((s) => s.notify)
  const [path, setPath] = useState(initialPath || '/')
  const [typed, setTyped] = useState(path)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ path: string; content: string; dirty: boolean } | null>(null)
  const [upl, setUpl] = useState<{ name: string; frac: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const url = (p: string) => `${VPS}${withProfile(p, profile)}`
  const full = (name: string) => (path === '/' ? `/${name}` : `${path}/${name}`)
  const log = (line: string, ok = true) => onLog?.(line, ok)

  const load = async (p = path) => {
    setLoading(true)
    setError('')
    try {
      const r = await api.get<{ path: string; entries: FileEntry[] }>(url(`/files?path=${encodeURIComponent(p)}`))
      setEntries(r.entries)
      setPath(r.path)
      setTyped(r.path)
      onPath?.(r.path)
      setSel(new Set())
    } catch (e) {
      setError((e as Error).message)
      log(`list ${p}: ${(e as Error).message}`, false)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load(initialPath || '/')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const go = (p: string) => load(p.replace(/\/+/g, '/').replace(/(.)\/$/, '$1') || '/')
  const parent = path === '/' ? '/' : path.replace(/\/[^/]+$/, '') || '/'
  const one = () => {
    const names = [...sel]
    if (names.length !== 1) {
      notify('Select exactly one item first', 'error')
      return null
    }
    return full(names[0])
  }
  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const r = (await fn()) as ExecOut | { ok?: boolean; stderr?: string } | undefined
      if (r && typeof r === 'object' && 'ok' in r && r.ok === false) throw new Error(String((r as ExecOut).stderr || 'failed').trim())
      log(label, true)
      notify(label, 'success')
      await load()
    } catch (e) {
      log(`${label}: ${(e as Error).message}`, false)
      notify((e as Error).message, 'error')
    }
  }
  const openFile = async (p: string) => {
    try {
      const d = await api.get<{ path: string; size: number; binary: boolean; content: string }>(url(`/files/read?path=${encodeURIComponent(p)}`))
      if (d.binary) return notify('Binary file: download it instead', 'error')
      setEditing({ path: d.path, content: d.content, dirty: false })
      log(`opened ${d.path}`)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  const save = () => editing && run(`saved ${editing.path}`, async () => { await api.put(url('/files/write'), { path: editing.path, content: editing.content }); setEditing({ ...editing, dirty: false }) })
  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    for (const f of Array.from(files)) {
      setUpl({ name: f.name, frac: 0 })
      try {
        await uploadRaw(url('/files/upload'), f, 'application/octet-stream', { path: full(f.name) }, (frac) => setUpl({ name: f.name, frac }))
        log(`uploaded ${full(f.name)} (${fmtBytes(f.size)})`)
      } catch (e) {
        log(`upload ${f.name}: ${(e as Error).message}`, false)
        notify((e as Error).message, 'error')
      }
    }
    setUpl(null)
    load()
  }
  const download = (p: string) => {
    const a = document.createElement('a')
    a.href = url(`/files/download?path=${encodeURIComponent(p)}`)
    a.download = p.split('/').pop() ?? 'file'
    a.click()
    log(`download ${p}`)
  }
  const act: FtpHandle['act'] = (kind, o = {}) => {
    switch (kind) {
      case 'list':
        return void load()
      case 'cd':
        return void go(o.dir ?? o.path ?? path)
      case 'upload':
        return input.current?.click()
      case 'download': {
        const p = o.path ?? one()
        if (p) download(p)
        return
      }
      case 'mkdir': {
        const p = o.dir ?? o.path ?? (window.prompt('New folder (name or absolute path)') || '')
        if (!p) return
        return void run(`created ${p.startsWith('/') ? p : full(p)}`, () => api.post(url('/files/mkdir'), { path: p.startsWith('/') ? p : full(p) }))
      }
      case 'newfile': {
        const p = o.path ?? (window.prompt('New file (name or absolute path)') || '')
        if (!p) return
        setEditing({ path: p.startsWith('/') ? p : full(p), content: '', dirty: true })
        return
      }
      case 'rename': {
        const src = o.src ?? one()
        if (!src) return
        const dst = o.dst ?? (window.prompt('Rename / move to', src) || '')
        if (!dst || dst === src) return
        return void run(`moved ${src} → ${dst}`, () => api.post(url('/files/rename'), { from: src, to: dst }))
      }
      case 'chmod': {
        const p = o.path ?? one()
        if (!p) return
        const mode = o.mode ?? (window.prompt('Permissions (octal)', '644') || '')
        if (!mode) return
        return void run(`chmod ${mode} ${p}`, () => api.post(url('/files/chmod'), { path: p, mode }))
      }
      case 'delete': {
        const names = o.path ? [o.path] : [...sel].map(full)
        if (!names.length) return notify('Select something to delete', 'error')
        if (!window.confirm(`Delete ${names.length === 1 ? names[0] : `${names.length} items`}?`)) return
        return void (async () => {
          for (const p of names) {
            const isDir = entries.find((e) => full(e.name) === p)?.type === 'dir'
            await run(`deleted ${p}`, () => api.del(url(`/files?path=${encodeURIComponent(p)}${isDir ? '&force=1' : ''}`)))
          }
        })()
      }
      case 'edit': {
        const p = o.path ?? one()
        if (p) openFile(p)
        return
      }
    }
  }
  useImperativeHandle(ref, () => ({ act, cd: go, path: () => path, selected: () => [...sel].map(full) }))
  const toggle = (name: string) => setSel((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n })

  return (
    <div className="cmdr-ftp" style={{ display: visible ? undefined : 'none' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files) }} data-ftp-pane="">
      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
        <button className="btn ghost icon sm" title="Up" onClick={() => go(parent)} disabled={path === '/'}>
          <ArrowUp size={13} />
        </button>
        <form className="grow" onSubmit={(e) => { e.preventDefault(); go(typed.startsWith('/') ? typed : `/${typed}`) }}>
          <input className="input sm mono" style={{ width: '100%' }} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="FTP path" />
        </form>
        <button className="btn ghost icon sm" title="Refresh" onClick={() => load()} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
        <button className="btn ghost icon sm" title="New folder" onClick={() => act('mkdir')}>
          <FolderPlus size={13} />
        </button>
        <button className="btn ghost icon sm" title="New file" onClick={() => act('newfile')}>
          <FileText size={13} />
        </button>
        <button className="btn ghost icon sm" title="Upload" onClick={() => act('upload')} data-ftp-upload="">
          <Upload size={13} />
        </button>
        <button className="btn ghost icon sm" title="Download selected" onClick={() => act('download')}>
          <Download size={13} />
        </button>
        <button className="btn ghost icon sm" title="Rename / move selected" onClick={() => act('rename')}>
          <Pencil size={13} />
        </button>
        <button className="btn ghost icon sm" title="Permissions of selected" onClick={() => act('chmod')}>
          <Shield size={13} />
        </button>
        <button className="btn ghost icon sm danger" title="Delete selected" onClick={() => act('delete')}>
          <Trash2 size={13} />
        </button>
        <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
      {upl && <div className="dev-session-chip">Uploading {upl.name} · {Math.round(upl.frac * 100)}%</div>}
      {error && <div className="dev-session-chip warn">{error}</div>}
      <div className="cmdr-ftp-body">
        <div className="cmdr-ftp-list">
          <table className="table compact">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" aria-label="Select all" checked={entries.length > 0 && sel.size === entries.length} onChange={(e) => setSel(e.target.checked ? new Set(entries.map((x) => x.name)) : new Set())} />
                </th>
                <th>Name</th>
                <th>Size</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.name} className={sel.has(e.name) ? 'is-selected' : ''} data-ftp-entry={e.name}>
                  <td>
                    <input type="checkbox" checked={sel.has(e.name)} onChange={() => toggle(e.name)} aria-label={`Select ${e.name}`} />
                  </td>
                  <td>
                    <button className="link row" style={{ gap: 6, flexWrap: 'nowrap' }} onClick={() => (e.type === 'dir' ? go(full(e.name)) : openFile(full(e.name)))} onDoubleClick={() => e.type !== 'dir' && download(full(e.name))}>
                      {e.type === 'dir' ? <Folder size={13} /> : e.type === 'link' ? <Link2 size={13} /> : <File size={13} />} {e.name}
                    </button>
                  </td>
                  <td className="small muted">{e.type === 'dir' ? '' : fmtBytes(e.size)}</td>
                  <td className="mono small muted">{e.mode}</td>
                </tr>
              ))}
              {!entries.length && !loading && (
                <tr>
                  <td colSpan={4} className="muted small">
                    Empty folder. Drop files here to upload.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editing && (
          <div className="cmdr-ftp-editor">
            <div className="row between" style={{ gap: 6 }}>
              <span className="mono small">
                {editing.path} {editing.dirty && <span className="chip prio-high">unsaved</span>}
              </span>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn primary sm" disabled={!editing.dirty} onClick={save} data-ftp-save="">
                  <Save size={12} /> Save
                </button>
                <button className="btn ghost icon sm" onClick={() => (!editing.dirty || window.confirm('Discard changes?')) && setEditing(null)}>
                  <X size={13} />
                </button>
              </div>
            </div>
            <textarea className="textarea mono" value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value, dirty: true })} spellCheck={false} aria-label="File content" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() } }} />
          </div>
        )}
      </div>
    </div>
  )
})
