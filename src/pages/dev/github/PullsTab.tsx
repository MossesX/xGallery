import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, ExternalLink, GitMerge, MessageSquare, Plus, RefreshCw, X } from 'lucide-react'
import { ago, short, useGh, type Comment, type FileDiff, type Overview, type Pull } from '../../../api/github'
import { Body, Busy, Dialog, Files, RunChip, StateChip, useGhAction } from './common'

export function PullsTab() {
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open')
  const [page, setPage] = useState(1)
  const list = useGh<{ pulls: Pull[]; next: number | null }>(`/pulls?state=${state}&page=${page}`)
  const ov = useGh<Overview>('/overview')
  const n = params.get('n')
  const newFrom = params.get('new')
  const [create, setCreate] = useState(newFrom != null)
  const [form, setForm] = useState({ title: '', body: '', head: newFrom ?? '', base: '', draft: false })
  const { run, busy } = useGhAction()
  const open = (num: number | null) => setParams((p) => { if (num) p.set('n', String(num)); else p.delete('n'); p.delete('new'); return p }, { replace: true })
  return (
    <div className="stack" style={{ gap: 10 }} data-gh-pulls="">
      <div className="row" style={{ gap: 6 }}>
        <div className="segmented">
          {(['open', 'closed', 'all'] as const).map((s) => (
            <button key={s} className={state === s ? 'active' : ''} onClick={() => { setState(s); setPage(1) }}>
              {s}
            </button>
          ))}
        </div>
        <button className="btn ghost sm" onClick={() => list.refetch()}>
          <RefreshCw size={12} />
        </button>
        <span className="grow" />
        <button className="btn primary sm" onClick={() => setCreate(true)} data-gh-new-pr="">
          <Plus size={12} /> New pull request
        </button>
      </div>
      {list.error && <div className="dev-session-chip warn">{(list.error as Error).message}</div>}
      <div className="card table-card">
        <table className="table compact">
          <tbody>
            {(list.data?.pulls ?? []).map((p) => (
              <tr key={p.number} className="gh-row" onClick={() => open(p.number)} data-gh-pr={p.number}>
                <td>
                  <StateChip state={p.state} merged={p.merged} draft={p.draft} />
                </td>
                <td className="small">
                  <strong>#{p.number}</strong> {p.title} {p.labels.map((l) => <span key={l} className="chip">{l}</span>)}
                  <div className="muted mono">
                    {p.head} → {p.base}
                  </div>
                </td>
                <td className="small muted">
                  {p.author} · {ago(p.updated_at)}
                  <div>
                    {p.comments + p.review_comments} <MessageSquare size={10} />
                  </div>
                </td>
              </tr>
            ))}
            {list.data && !list.data.pulls.length && (
              <tr>
                <td className="muted small">No {state === 'all' ? '' : state} pull requests.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
        <span className="muted small">page {page}</span>
        <button className="btn ghost sm" disabled={!list.data?.next} onClick={() => setPage(page + 1)}>→</button>
      </div>
      {n && <PullDialog n={Number(n)} onClose={() => open(null)} />}
      {create && (
        <Dialog title="New pull request" onClose={() => { setCreate(false); open(null) }} wide>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 6 }}>
              <input className="input sm mono grow" placeholder="head branch" value={form.head} onChange={(e) => setForm({ ...form, head: e.target.value })} aria-label="Head branch" />
              <span>→</span>
              <input className="input sm mono grow" placeholder={`base (${ov.data?.repo?.default_branch ?? 'default'})`} value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })} aria-label="Base branch" />
            </div>
            <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="PR title" />
            <textarea className="textarea" rows={6} placeholder="Description (markdown)" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} aria-label="PR body" />
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={form.draft} onChange={(e) => setForm({ ...form, draft: e.target.checked })} /> Draft
            </label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" disabled={!form.title || !form.head || busy === 'create'} onClick={async () => { const r = (await run({ path: '/pulls', body: form, label: 'Pull request opened', invalidate: ['/pulls', '/overview'], key: 'create' })) as { pull?: Pull } | null; if (r?.pull) { setCreate(false); open(r.pull.number) } }} data-gh-create-pr="">
                <Busy on={busy === 'create'}>
                  <Plus size={13} />
                </Busy>{' '}
                Create
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function PullDialog({ n, onClose }: { n: number; onClose: () => void }) {
  const d = useGh<{ pull: Pull; files: FileDiff[]; reviews: { id: number; author: string; state: string; body: string; submitted_at: string }[]; reviewComments: (Comment & { path: string; line: number })[]; comments: Comment[]; checks: { id: number; name: string; status: string; conclusion: string | null; url: string; app: string }[] }>(`/pulls/${n}`, { refetchInterval: 30_000 })
  const { run, busy } = useGhAction()
  const [tab, setTab] = useState<'conversation' | 'files' | 'checks'>('conversation')
  const [comment, setComment] = useState('')
  const [method, setMethod] = useState<'squash' | 'merge' | 'rebase'>('squash')
  const p = d.data?.pull
  const inv = ['/pulls', '/overview']
  return (
    <Dialog title={p ? `#${p.number} ${p.title}` : `Pull request #${n}`} onClose={onClose} wide>
      {d.error && <p className="muted">{(d.error as Error).message}</p>}
      {p && (
        <div className="stack" style={{ gap: 8 }} data-gh-pr-dialog="">
          <div className="row" style={{ gap: 6 }}>
            <StateChip state={p.state} merged={p.merged} draft={p.draft} />
            <span className="mono small">
              {p.head} → {p.base}
            </span>
            <span className="small muted">
              {p.author} · {p.commits} commits · {p.changed_files} files · <span style={{ color: 'var(--c-success)' }}>+{p.additions}</span> <span style={{ color: '#ef4444' }}>−{p.deletions}</span>
            </span>
            {p.mergeable_state && <span className={`chip ${p.mergeable_state === 'clean' ? 'st-done' : p.mergeable_state === 'dirty' ? 'st-blocked' : ''}`}>{p.mergeable_state}</span>}
            <a href={p.url} target="_blank" rel="noreferrer" className="small">
              GitHub <ExternalLink size={10} />
            </a>
          </div>
          {p.state === 'open' && (
            <div className="row" style={{ gap: 4 }}>
              <select className="select sm" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} aria-label="Merge method">
                <option value="squash">squash and merge</option>
                <option value="merge">merge commit</option>
                <option value="rebase">rebase and merge</option>
              </select>
              <button className="btn primary sm" disabled={busy !== '' || p.draft} onClick={() => run({ path: `/pulls/${n}/merge`, body: { method, deleteBranch: true, branch: p.head }, label: `#${n} merged`, confirm: `Merge #${n} (${method}) into ${p.base} and delete ${p.head}?`, invalidate: inv, key: 'merge' })} data-gh-merge="">
                <Busy on={busy === 'merge'}>
                  <GitMerge size={12} />
                </Busy>{' '}
                Merge
              </button>
              {p.mergeable_state === 'behind' && (
                <button className="btn sm" disabled={busy !== ''} onClick={() => run({ path: `/pulls/${n}/update-branch`, label: 'Branch updated from base', invalidate: inv })}>
                  update branch
                </button>
              )}
              <button className="btn sm" disabled={busy !== ''} onClick={() => run({ path: `/pulls/${n}/reviews`, body: { event: 'APPROVE', body: comment }, label: 'Approved', invalidate: inv })}>
                <Check size={12} /> Approve
              </button>
              <button className="btn sm" disabled={busy !== '' || !comment} onClick={() => run({ path: `/pulls/${n}/reviews`, body: { event: 'REQUEST_CHANGES', body: comment }, label: 'Changes requested', invalidate: inv })}>
                Request changes
              </button>
              <span className="grow" />
              <button className="btn ghost sm danger" disabled={busy !== ''} onClick={() => run({ method: 'PATCH', path: `/pulls/${n}`, body: { state: 'closed' }, label: `#${n} closed`, confirm: `Close #${n} without merging?`, invalidate: inv })}>
                <X size={12} /> Close
              </button>
            </div>
          )}
          {p.state === 'closed' && !p.merged && (
            <button className="btn sm" disabled={busy !== ''} onClick={() => run({ method: 'PATCH', path: `/pulls/${n}`, body: { state: 'open' }, label: `#${n} reopened`, invalidate: inv })} style={{ alignSelf: 'flex-start' }}>
              Reopen
            </button>
          )}
          <div className="segmented">
            <button className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}>conversation ({d.data!.comments.length + d.data!.reviews.length})</button>
            <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>files ({d.data!.files.length})</button>
            <button className={tab === 'checks' ? 'active' : ''} onClick={() => setTab('checks')}>checks ({d.data!.checks.length})</button>
          </div>
          {tab === 'conversation' && (
            <div className="stack" style={{ gap: 8 }}>
              <Body text={p.body} />
              {[...d.data!.comments.map((c) => ({ ...c, kind: 'comment' as const, state: '' })), ...d.data!.reviews.filter((r) => r.body || r.state !== 'COMMENTED').map((r) => ({ id: r.id, author: r.author, body: r.body, created_at: r.submitted_at, url: '', kind: 'review' as const, state: r.state }))]
                .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
                .map((c) => (
                  <div key={`${c.kind}${c.id}`} className="gh-comment">
                    <div className="row small" style={{ gap: 6 }}>
                      <strong>{c.author}</strong>
                      {c.kind === 'review' && <span className={`chip ${c.state === 'APPROVED' ? 'st-done' : c.state === 'CHANGES_REQUESTED' ? 'st-blocked' : ''}`}>{c.state.toLowerCase().replace('_', ' ')}</span>}
                      <span className="muted">{ago(c.created_at)}</span>
                    </div>
                    <Body text={c.body} />
                  </div>
                ))}
              {d.data!.reviewComments.length > 0 && (
                <details>
                  <summary className="small muted">{d.data!.reviewComments.length} inline review comments</summary>
                  {d.data!.reviewComments.map((c) => (
                    <div key={c.id} className="gh-comment">
                      <div className="small">
                        <strong>{c.author}</strong> on <span className="mono">{c.path}:{c.line}</span> · {ago(c.created_at)}
                      </div>
                      <Body text={c.body} />
                    </div>
                  ))}
                </details>
              )}
              <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                <textarea className="textarea grow" rows={3} placeholder="Comment (also used as the review text above)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
                <button className="btn sm" disabled={!comment || busy !== ''} onClick={async () => { const r = await run({ path: `/issues/${n}/comments`, body: { body: comment }, label: 'Comment posted', invalidate: ['/pulls'] }); if (r) setComment('') }}>
                  <MessageSquare size={12} /> Comment
                </button>
              </div>
            </div>
          )}
          {tab === 'files' && <Files files={d.data!.files} />}
          {tab === 'checks' && (
            <table className="table compact">
              <tbody>
                {d.data!.checks.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <RunChip status={c.status} conclusion={c.conclusion} />
                    </td>
                    <td className="small">
                      {c.name} <span className="muted">· {c.app}</span>
                    </td>
                    <td>
                      <a className="small" href={c.url} target="_blank" rel="noreferrer">
                        <ExternalLink size={10} />
                      </a>
                    </td>
                  </tr>
                ))}
                {!d.data!.checks.length && (
                  <tr>
                    <td className="muted small">No checks on {short(p.headSha)}.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Dialog>
  )
}
