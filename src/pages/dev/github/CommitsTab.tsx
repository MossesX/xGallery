import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ExternalLink, GitCompareArrows, ShieldCheck } from 'lucide-react'
import { ago, short, useGh, type Commit, type FileDiff, type Overview } from '../../../api/github'
import { Dialog, Files } from './common'

export function CommitsTab() {
  const [params, setParams] = useSearchParams()
  const ov = useGh<Overview>('/overview')
  const [branch, setBranch] = useState(params.get('branch') ?? '')
  const [path, setPath] = useState('')
  const [page, setPage] = useState(1)
  const list = useGh<{ commits: Commit[]; next: number | null }>(`/commits?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&page=${page}`)
  const sha = params.get('sha')
  const [cmp, setCmp] = useState({ base: '', head: '' })
  const [showCmp, setShowCmp] = useState(false)
  const compare = useGh<{ status: string; ahead_by: number; behind_by: number; total_commits: number; commits: { sha: string; message: string; author: string }[]; files: FileDiff[]; url: string }>(showCmp && cmp.base && cmp.head ? `/compare?base=${encodeURIComponent(cmp.base)}&head=${encodeURIComponent(cmp.head)}` : null)
  const open = (s: string | null) => setParams((p) => { if (s) p.set('sha', s); else p.delete('sha'); return p }, { replace: true })
  return (
    <div className="stack" style={{ gap: 10 }} data-gh-commits="">
      <div className="row" style={{ gap: 6 }}>
        <input className="input sm mono" placeholder={`branch (${ov.data?.repo?.default_branch ?? 'default'})`} value={branch} onChange={(e) => { setBranch(e.target.value); setPage(1) }} style={{ width: 200 }} aria-label="Branch" />
        <input className="input sm mono" placeholder="path filter, e.g. server/src" value={path} onChange={(e) => { setPath(e.target.value); setPage(1) }} style={{ width: 240 }} aria-label="Path" />
        <span className="grow" />
        <button className="btn sm" onClick={() => setShowCmp(!showCmp)}>
          <GitCompareArrows size={12} /> Compare
        </button>
      </div>
      {showCmp && (
        <section className="card stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 6 }}>
            <input className="input sm mono" placeholder="base (main, tag, sha)" value={cmp.base} onChange={(e) => setCmp({ ...cmp, base: e.target.value })} aria-label="Base" />
            <span>…</span>
            <input className="input sm mono" placeholder="head (branch, sha)" value={cmp.head} onChange={(e) => setCmp({ ...cmp, head: e.target.value })} aria-label="Head" />
          </div>
          {compare.data && (
            <>
              <div className="row" style={{ gap: 6 }}>
                <span className="chip">{compare.data.status}</span> <span className="small">{compare.data.ahead_by} ahead · {compare.data.behind_by} behind · {compare.data.total_commits} commits · {compare.data.files.length} files</span>
                <a className="small" href={compare.data.url} target="_blank" rel="noreferrer">
                  on GitHub <ExternalLink size={10} />
                </a>
              </div>
              <Files files={compare.data.files} />
            </>
          )}
          {compare.error && <p className="muted small">{(compare.error as Error).message}</p>}
        </section>
      )}
      {list.error && <div className="dev-session-chip warn">{(list.error as Error).message}</div>}
      <div className="card table-card">
        <table className="table compact">
          <tbody>
            {(list.data?.commits ?? []).map((c) => (
              <tr key={c.sha} className="gh-row" onClick={() => open(c.sha)} data-gh-commit={short(c.sha)}>
                <td className="mono small">{short(c.sha)}</td>
                <td className="small">
                  <strong>{c.message.split('\n')[0]}</strong>
                  {c.message.includes('\n') && <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{c.message.split('\n').slice(1).join('\n').trim().slice(0, 200)}</div>}
                </td>
                <td className="small muted">
                  {c.author}
                  {c.login && c.login !== c.author ? ` (${c.login})` : ''} · {ago(c.date)} {c.verified && <ShieldCheck size={11} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          ← newer
        </button>
        <span className="muted small">page {page}</span>
        <button className="btn ghost sm" disabled={!list.data?.next} onClick={() => setPage(page + 1)}>
          older →
        </button>
      </div>
      {sha && <CommitDialog sha={sha} onClose={() => open(null)} />}
    </div>
  )
}

function CommitDialog({ sha, onClose }: { sha: string; onClose: () => void }) {
  const d = useGh<{ sha: string; message: string; author: { name: string; date: string }; login: string; stats: { additions: number; deletions: number; total: number }; files: FileDiff[]; url: string; parents: string[] }>(`/commits/${sha}`)
  return (
    <Dialog title={`Commit ${short(sha)}`} onClose={onClose} wide>
      {d.error && <p className="muted">{(d.error as Error).message}</p>}
      {d.data && (
        <div className="stack" style={{ gap: 8 }}>
          <pre className="vps-pre" style={{ maxHeight: 160 }}>{d.data.message}</pre>
          <div className="row small muted" style={{ gap: 8 }}>
            <span>{d.data.author?.name}{d.data.login ? ` (${d.data.login})` : ''}</span>
            <span>{ago(d.data.author?.date)}</span>
            <span style={{ color: 'var(--c-success)' }}>+{d.data.stats?.additions}</span>
            <span style={{ color: '#ef4444' }}>−{d.data.stats?.deletions}</span>
            <span>{d.data.files.length} files</span>
            <a href={d.data.url} target="_blank" rel="noreferrer">
              GitHub <ExternalLink size={10} />
            </a>
          </div>
          <Files files={d.data.files} />
        </div>
      )}
    </Dialog>
  )
}
