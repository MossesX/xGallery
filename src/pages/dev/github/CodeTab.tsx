import { useState } from 'react'
import { ArrowUp, ExternalLink, File, FileText, Folder, Save, Search, Trash2, X } from 'lucide-react'
import { ago, short, useGh, type Overview } from '../../../api/github'
import { Busy, useGhAction } from './common'

interface Entry { name: string; path: string; type: 'file' | 'dir' | 'symlink' | 'submodule'; size: number; sha: string }
interface FileData { path: string; type: 'file'; sha: string; size: number; binary: boolean; content: string; url: string; download: string }
interface DirData { path: string; type: 'dir'; entries: Entry[] }

/** Browse any branch and commit file changes straight to GitHub (the deploy workflow picks them up on the default branch). */
export function CodeTab() {
  const ov = useGh<Overview>('/overview')
  const [ref, setRef] = useState('')
  const [path, setPath] = useState('')
  const [file, setFile] = useState<{ path: string; sha: string; content: string; dirty: boolean; isNew?: boolean } | null>(null)
  const [message, setMessage] = useState('')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const dir = useGh<DirData | FileData>(`/contents?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`)
  const results = useGh<{ total: number; items: { name: string; path: string; url: string; sha: string }[] }>(search ? `/search?q=${encodeURIComponent(search)}` : null)
  const history = useGh<{ commits: { sha: string; message: string; author: string; date: string }[] }>(file && !file.isNew ? `/commits?path=${encodeURIComponent(file.path)}&branch=${encodeURIComponent(ref)}&per_page=5` : null)
  const { run, busy } = useGhAction()
  const openFile = async (p: string) => {
    const r = await fetch(`/api/dev/github/contents?path=${encodeURIComponent(p)}&ref=${encodeURIComponent(ref)}`, { credentials: 'include' })
    const d = (await r.json()) as FileData & { error?: string }
    if (!r.ok) return alert(d.error ?? 'Could not read the file')
    if (d.binary) return alert('Binary file: open it on GitHub instead')
    setFile({ path: d.path, sha: d.sha, content: d.content, dirty: false })
    setMessage('')
  }
  const save = async () => {
    if (!file) return
    const r = (await run({ method: 'PUT', path: '/contents', body: { path: file.path, content: file.content, sha: file.isNew ? '' : file.sha, branch: ref, message }, label: `Committed ${file.path}`, invalidate: ['/contents', '/commits', '/overview'], key: 'save' })) as { sha?: string } | null
    if (r?.sha) setFile({ ...file, sha: r.sha, dirty: false, isNew: false })
  }
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const entries = dir.data?.type === 'dir' ? dir.data.entries : []
  return (
    <div className="vps-files" data-gh-code="">
      <div className="stack" style={{ gap: 8, minWidth: 0 }}>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn ghost icon sm" title="Up" disabled={!path} onClick={() => setPath(parent)}>
            <ArrowUp size={13} />
          </button>
          <input className="input sm mono" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={ov.data?.repo?.default_branch ?? 'branch'} style={{ width: 120 }} aria-label="Ref" />
          <span className="mono small grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>/{path}</span>
          <button className="btn sm" onClick={() => { const name = window.prompt('New file path', path ? `${path}/new-file.md` : 'new-file.md'); if (name) { setFile({ path: name.replace(/^\/+/, ''), sha: '', content: '', dirty: true, isNew: true }); setMessage(`Add ${name}`) } }}>
            <FileText size={12} /> New file
          </button>
        </div>
        <form className="row" style={{ gap: 4 }} onSubmit={(e) => { e.preventDefault(); setSearch(q) }}>
          <input className="input sm grow" placeholder="search code in the repository" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search code" />
          <button className="btn sm" type="submit">
            <Search size={12} />
          </button>
          {search && (
            <button className="btn ghost sm" type="button" onClick={() => { setSearch(''); setQ('') }}>
              <X size={12} />
            </button>
          )}
        </form>
        {search && results.data && (
          <div className="card stack" style={{ gap: 2 }}>
            <span className="small muted">{results.data.total} results</span>
            {results.data.items.map((i) => (
              <button key={i.sha + i.path} className="link small mono" style={{ textAlign: 'left' }} onClick={() => openFile(i.path)}>
                {i.path}
              </button>
            ))}
          </div>
        )}
        {dir.error && <div className="dev-session-chip warn">{(dir.error as Error).message}</div>}
        <div className="card table-card vps-file-list">
          <table className="table compact">
            <tbody>
              {entries.map((e) => (
                <tr key={e.path} data-gh-entry={e.name}>
                  <td>
                    <button className="link row" style={{ gap: 6, flexWrap: 'nowrap' }} onClick={() => (e.type === 'dir' ? setPath(e.path) : openFile(e.path))}>
                      {e.type === 'dir' ? <Folder size={14} /> : <File size={14} />} {e.name}
                    </button>
                  </td>
                  <td className="small muted">{e.type === 'file' ? `${Math.round(e.size / 1024)} KB` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        {file ? (
          <>
            <div className="row between">
              <span className="mono small">
                {file.path} {file.dirty && <span className="chip prio-high">unsaved</span>} {file.isNew && <span className="chip">new</span>}
              </span>
              <div className="row" style={{ gap: 4 }}>
                {!file.isNew && (
                  <a className="btn ghost icon sm" href={`https://github.com/${ov.data?.repo?.full_name}/blob/${ref || ov.data?.repo?.default_branch}/${file.path}`} target="_blank" rel="noreferrer" title="On GitHub">
                    <ExternalLink size={12} />
                  </a>
                )}
                {!file.isNew && (
                  <button className="btn ghost icon sm danger" title="Delete file (commits)" disabled={busy !== ''} onClick={async () => { const r = await run({ method: 'DELETE', path: '/contents', body: { path: file.path, sha: file.sha, branch: ref, message: `Delete ${file.path}` }, label: `Deleted ${file.path}`, confirm: `Commit the deletion of ${file.path}?`, invalidate: ['/contents', '/commits', '/overview'] }); if (r) setFile(null) }}>
                    <Trash2 size={12} />
                  </button>
                )}
                <button className="btn ghost icon sm" onClick={() => (!file.dirty || window.confirm('Discard unsaved changes?')) && setFile(null)}>
                  <X size={13} />
                </button>
              </div>
            </div>
            <textarea className="textarea mono vps-editor" value={file.content} onChange={(e) => setFile({ ...file, content: e.target.value, dirty: true })} spellCheck={false} aria-label="File content" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() } }} />
            <div className="row" style={{ gap: 6 }}>
              <input className="input sm grow" placeholder={`Commit message (Update ${file.path.split('/').pop()})`} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Commit message" />
              <button className="btn primary sm" disabled={!file.dirty || busy === 'save'} onClick={save} data-gh-commit-file="">
                <Busy on={busy === 'save'}>
                  <Save size={12} />
                </Busy>{' '}
                Commit to {ref || ov.data?.repo?.default_branch}
              </button>
            </div>
            {history.data && history.data.commits.length > 0 && (
              <div className="small muted">
                History: {history.data.commits.map((c) => <span key={c.sha} title={c.message}><span className="mono">{short(c.sha)}</span> {ago(c.date)} · </span>)}
              </div>
            )}
          </>
        ) : (
          <div className="card muted small" style={{ minHeight: 200 }}>
            Click a file to edit it; "Commit" writes it straight to the branch on GitHub (a push to the default branch triggers the deploy workflow). For larger changes use the Developer AI or Code editor with checkpoints, then commit from there.
          </div>
        )}
      </div>
    </div>
  )
}
