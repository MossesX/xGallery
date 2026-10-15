import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ExternalLink, MessageSquare, Plus, RefreshCw, Tag, Trash2 } from 'lucide-react'
import { ago, useGh, type Comment, type Issue } from '../../../api/github'
import { Body, Busy, Dialog, StateChip, useGhAction } from './common'

interface Label { name: string; color: string; description: string }

export function IssuesTab() {
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open')
  const [label, setLabel] = useState('')
  const [page, setPage] = useState(1)
  const list = useGh<{ issues: Issue[]; next: number | null }>(`/issues?state=${state}&labels=${encodeURIComponent(label)}&page=${page}`)
  const labels = useGh<{ labels: Label[] }>('/labels', { staleTime: 120_000 })
  const n = params.get('n')
  const [create, setCreate] = useState(false)
  const [form, setForm] = useState({ title: '', body: '', labels: [] as string[] })
  const [newLabel, setNewLabel] = useState({ name: '', color: 'ff7a1a' })
  const { run, busy } = useGhAction()
  const open = (num: number | null) => setParams((p) => { if (num) p.set('n', String(num)); else p.delete('n'); return p }, { replace: true })
  return (
    <div className="stack" style={{ gap: 10 }} data-gh-issues="">
      <div className="row" style={{ gap: 6 }}>
        <div className="segmented">
          {(['open', 'closed', 'all'] as const).map((s) => (
            <button key={s} className={state === s ? 'active' : ''} onClick={() => { setState(s); setPage(1) }}>
              {s}
            </button>
          ))}
        </div>
        <select className="select sm" value={label} onChange={(e) => { setLabel(e.target.value); setPage(1) }} aria-label="Label filter">
          <option value="">any label</option>
          {(labels.data?.labels ?? []).map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
        <button className="btn ghost sm" onClick={() => list.refetch()}>
          <RefreshCw size={12} />
        </button>
        <span className="grow" />
        <button className="btn primary sm" onClick={() => setCreate(true)} data-gh-new-issue="">
          <Plus size={12} /> New issue
        </button>
      </div>
      {list.error && <div className="dev-session-chip warn">{(list.error as Error).message}</div>}
      <div className="card table-card">
        <table className="table compact">
          <tbody>
            {(list.data?.issues ?? []).map((i) => (
              <tr key={i.number} className="gh-row" onClick={() => open(i.number)} data-gh-issue={i.number}>
                <td>
                  <StateChip state={i.state} />
                </td>
                <td className="small">
                  <strong>#{i.number}</strong> {i.title}{' '}
                  {i.labels.map((l) => (
                    <span key={l.name} className="chip" style={{ borderColor: `#${l.color}`, color: `#${l.color}` }}>
                      {l.name}
                    </span>
                  ))}
                  {i.assignees.length > 0 && <div className="muted">assigned: {i.assignees.join(', ')}</div>}
                </td>
                <td className="small muted">
                  {i.author} · {ago(i.updated_at)}
                  <div>
                    {i.comments} <MessageSquare size={10} />
                  </div>
                </td>
              </tr>
            ))}
            {list.data && !list.data.issues.length && (
              <tr>
                <td className="muted small">No {state === 'all' ? '' : state} issues.</td>
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
      <section className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>
          <Tag size={14} /> Labels
        </h3>
        <div className="row" style={{ gap: 4 }}>
          {(labels.data?.labels ?? []).map((l) => (
            <span key={l.name} className="chip" style={{ borderColor: `#${l.color}`, color: `#${l.color}` }} title={l.description}>
              {l.name}
              <button className="tab-close" onClick={() => run({ method: 'DELETE', path: `/labels/${encodeURIComponent(l.name)}`, label: `Label ${l.name} deleted`, confirm: `Delete label ${l.name}?`, invalidate: ['/labels', '/issues'] })} aria-label={`Delete label ${l.name}`}>
                <Trash2 size={9} />
              </button>
            </span>
          ))}
          <input className="input sm" placeholder="new label" value={newLabel.name} onChange={(e) => setNewLabel({ ...newLabel, name: e.target.value })} style={{ width: 130 }} aria-label="New label" />
          <input className="input sm mono" value={newLabel.color} onChange={(e) => setNewLabel({ ...newLabel, color: e.target.value.replace('#', '') })} style={{ width: 80 }} aria-label="Label colour" />
          <button className="btn sm" disabled={!newLabel.name || busy !== ''} onClick={async () => { const r = await run({ path: '/labels', body: newLabel, label: `Label ${newLabel.name} created`, invalidate: ['/labels'] }); if (r) setNewLabel({ name: '', color: 'ff7a1a' }) }}>
            <Plus size={11} />
          </button>
        </div>
      </section>
      {n && <IssueDialog n={Number(n)} labels={labels.data?.labels ?? []} onClose={() => open(null)} />}
      {create && (
        <Dialog title="New issue" onClose={() => setCreate(false)} wide>
          <div className="stack" style={{ gap: 8 }}>
            <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Issue title" autoFocus />
            <textarea className="textarea" rows={8} placeholder="Description (markdown)" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} aria-label="Issue body" />
            <div className="row" style={{ gap: 4 }}>
              {(labels.data?.labels ?? []).map((l) => (
                <button key={l.name} className={`chip chip-tag ${form.labels.includes(l.name) ? 'active' : ''}`} onClick={() => setForm({ ...form, labels: form.labels.includes(l.name) ? form.labels.filter((x) => x !== l.name) : [...form.labels, l.name] })}>
                  {l.name}
                </button>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" disabled={!form.title || busy === 'create'} onClick={async () => { const r = (await run({ path: '/issues', body: form, label: 'Issue opened', invalidate: ['/issues', '/overview'], key: 'create' })) as { issue?: Issue } | null; if (r?.issue) { setCreate(false); setForm({ title: '', body: '', labels: [] }); open(r.issue.number) } }} data-gh-create-issue="">
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

function IssueDialog({ n, labels, onClose }: { n: number; labels: Label[]; onClose: () => void }) {
  const d = useGh<{ issue: Issue; comments: Comment[] }>(`/issues/${n}`, { refetchInterval: 30_000 })
  const { run, busy } = useGhAction()
  const [comment, setComment] = useState('')
  const [edit, setEdit] = useState<{ title: string; body: string } | null>(null)
  const i = d.data?.issue
  const inv = ['/issues', '/overview']
  return (
    <Dialog title={i ? `#${i.number} ${i.title}` : `Issue #${n}`} onClose={onClose} wide>
      {d.error && <p className="muted">{(d.error as Error).message}</p>}
      {i && (
        <div className="stack" style={{ gap: 8 }} data-gh-issue-dialog="">
          <div className="row" style={{ gap: 6 }}>
            <StateChip state={i.state} />
            <span className="small muted">
              {i.author} opened {ago(i.created_at)} · {i.comments} comments
            </span>
            {i.assignees.length > 0 && <span className="small">assigned: {i.assignees.join(', ')}</span>}
            <a href={i.url} target="_blank" rel="noreferrer" className="small">
              GitHub <ExternalLink size={10} />
            </a>
            <span className="grow" />
            {i.state === 'open' ? (
              <>
                <button className="btn sm" disabled={busy !== ''} onClick={() => run({ method: 'PATCH', path: `/issues/${n}`, body: { state: 'closed', state_reason: 'completed' }, label: `#${n} closed`, invalidate: inv })} data-gh-close-issue="">
                  Close as completed
                </button>
                <button className="btn ghost sm" disabled={busy !== ''} onClick={() => run({ method: 'PATCH', path: `/issues/${n}`, body: { state: 'closed', state_reason: 'not_planned' }, label: `#${n} closed`, invalidate: inv })}>
                  not planned
                </button>
              </>
            ) : (
              <button className="btn sm" disabled={busy !== ''} onClick={() => run({ method: 'PATCH', path: `/issues/${n}`, body: { state: 'open' }, label: `#${n} reopened`, invalidate: inv })}>
                Reopen
              </button>
            )}
            <button className="btn ghost sm" onClick={() => setEdit(edit ? null : { title: i.title, body: i.body })}>
              {edit ? 'cancel' : 'edit'}
            </button>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {labels.map((l) => {
              const on = i.labels.some((x) => x.name === l.name)
              return (
                <button key={l.name} className={`chip chip-tag ${on ? 'active' : ''}`} disabled={busy !== ''} onClick={() => run({ method: 'PATCH', path: `/issues/${n}`, body: { labels: on ? i.labels.filter((x) => x.name !== l.name).map((x) => x.name) : [...i.labels.map((x) => x.name), l.name] }, label: 'Labels updated', quiet: true, invalidate: inv })}>
                  {l.name}
                </button>
              )
            })}
            <input className="input sm" placeholder="assign @user (Enter)" style={{ width: 160 }} aria-label="Assign" onKeyDown={(e) => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.replace('@', '').trim(); if (v) { run({ method: 'PATCH', path: `/issues/${n}`, body: { assignees: [...i.assignees, v] }, label: `Assigned ${v}`, invalidate: inv }); (e.target as HTMLInputElement).value = '' } } }} />
          </div>
          {edit ? (
            <div className="stack" style={{ gap: 6 }}>
              <input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label="Title" />
              <textarea className="textarea" rows={8} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} aria-label="Body" />
              <button className="btn primary sm" style={{ alignSelf: 'flex-end' }} disabled={busy !== ''} onClick={async () => { const r = await run({ method: 'PATCH', path: `/issues/${n}`, body: edit, label: 'Issue updated', invalidate: inv }); if (r) setEdit(null) }}>
                Save
              </button>
            </div>
          ) : (
            <Body text={i.body} />
          )}
          {d.data!.comments.map((c) => (
            <div key={c.id} className="gh-comment">
              <div className="row small" style={{ gap: 6 }}>
                <strong>{c.author}</strong>
                <span className="muted">{ago(c.created_at)}</span>
                <span className="grow" />
                <button className="btn ghost icon sm danger" title="Delete comment" onClick={() => run({ method: 'DELETE', path: `/comments/${c.id}`, label: 'Comment deleted', confirm: 'Delete this comment?', invalidate: ['/issues'] })}>
                  <Trash2 size={11} />
                </button>
              </div>
              <Body text={c.body} />
            </div>
          ))}
          <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
            <textarea className="textarea grow" rows={3} placeholder="Comment" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
            <button className="btn sm" disabled={!comment || busy !== ''} onClick={async () => { const r = await run({ path: `/issues/${n}/comments`, body: { body: comment }, label: 'Comment posted', invalidate: ['/issues'] }); if (r) setComment('') }} data-gh-comment="">
              <MessageSquare size={12} /> Comment
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
