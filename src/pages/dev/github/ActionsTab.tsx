import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ExternalLink, Play, RefreshCw, RotateCw, ScrollText, Trash2, XCircle } from 'lucide-react'
import { ago, short, useGh, type Job, type Run } from '../../../api/github'
import { Busy, Dialog, RunChip, useGhAction } from './common'

interface Workflow { id: number; name: string; path: string; state: string; url: string; badge: string }

export function ActionsTab() {
  const [params, setParams] = useSearchParams()
  const wfs = useGh<{ workflows: Workflow[] }>('/actions/workflows', { staleTime: 120_000 })
  const [wf, setWf] = useState('')
  const [branch, setBranch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const runs = useGh<{ total: number; runs: Run[]; next: number | null }>(`/actions/runs?workflow=${encodeURIComponent(wf)}&branch=${encodeURIComponent(branch)}&status=${status}&page=${page}`, { refetchInterval: 20_000 })
  const { run, busy } = useGhAction()
  const sel = params.get('run')
  const open = (id: number | null) => setParams((p) => { if (id) p.set('run', String(id)); else p.delete('run'); return p }, { replace: true })
  const inv = ['/actions', '/overview']
  const [dispatch, setDispatch] = useState<Workflow | null>(null)
  const [dRef, setDRef] = useState('')
  const [dInputs, setDInputs] = useState('')
  return (
    <div className="stack" style={{ gap: 10 }} data-gh-actions="">
      <section className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Workflows</h3>
        <div className="row" style={{ gap: 4 }}>
          {(wfs.data?.workflows ?? []).map((w) => (
            <span key={w.id} className="gh-wf">
              <button className={`chip chip-tag ${wf === w.path.split('/').pop() ? 'active' : ''}`} onClick={() => { setWf(wf === w.path.split('/').pop() ? '' : w.path.split('/').pop()!); setPage(1) }} title={w.path}>
                {w.name} {w.state !== 'active' && `(${w.state})`}
              </button>
              <button className="btn ghost icon sm" title="Run workflow (workflow_dispatch)" onClick={() => { setDispatch(w); setDRef(''); setDInputs('') }} data-gh-dispatch={w.path.split('/').pop()}>
                <Play size={11} />
              </button>
              <button className="btn ghost icon sm" title={w.state === 'active' ? 'Disable' : 'Enable'} disabled={busy !== ''} onClick={() => run({ path: `/actions/workflows/${encodeURIComponent(w.path.split('/').pop()!)}/${w.state === 'active' ? 'disable' : 'enable'}`, label: `${w.name} ${w.state === 'active' ? 'disabled' : 'enabled'}`, invalidate: ['/actions/workflows'] })}>
                <XCircle size={11} />
              </button>
            </span>
          ))}
        </div>
      </section>
      <div className="row" style={{ gap: 6 }}>
        <input className="input sm mono" placeholder="branch" value={branch} onChange={(e) => { setBranch(e.target.value); setPage(1) }} style={{ width: 140 }} aria-label="Branch" />
        <select className="select sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} aria-label="Status" style={{ width: 160 }}>
          <option value="">any status</option>
          {['queued', 'in_progress', 'completed', 'success', 'failure', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="btn ghost sm" onClick={() => runs.refetch()}>
          <RefreshCw size={12} />
        </button>
        <span className="muted small">{runs.data ? `${runs.data.total} runs` : ''}</span>
      </div>
      {runs.error && <div className="dev-session-chip warn">{(runs.error as Error).message}</div>}
      <div className="card table-card">
        <table className="table compact">
          <tbody>
            {(runs.data?.runs ?? []).map((r) => (
              <tr key={r.id} className="gh-row" onClick={() => open(r.id)} data-gh-run={r.id}>
                <td>
                  <RunChip status={r.status} conclusion={r.conclusion} />
                </td>
                <td className="small">
                  <strong>{r.name}</strong> #{r.run_number}
                  {r.attempt > 1 && <span className="muted"> (attempt {r.attempt})</span>}
                  <div className="muted">{r.title}</div>
                </td>
                <td className="small muted">
                  {r.event} · {r.branch} · <span className="mono">{short(r.sha)}</span> · {r.actor}
                  <div>{ago(r.updated_at)}</div>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                    {r.status === 'completed' ? (
                      <>
                        <button className="btn ghost icon sm" title="Re-run all jobs" disabled={busy !== ''} onClick={() => run({ path: `/actions/runs/${r.id}/rerun`, label: 'Re-run requested', invalidate: inv, key: `rr${r.id}` })}>
                          <Busy on={busy === `rr${r.id}`}>
                            <RotateCw size={12} />
                          </Busy>
                        </button>
                        {r.conclusion === 'failure' && (
                          <button className="btn ghost sm" disabled={busy !== ''} onClick={() => run({ path: `/actions/runs/${r.id}/rerun-failed`, label: 'Re-running failed jobs', invalidate: inv })}>
                            failed only
                          </button>
                        )}
                      </>
                    ) : (
                      <button className="btn ghost sm danger" disabled={busy !== ''} onClick={() => run({ path: `/actions/runs/${r.id}/cancel`, label: 'Cancel requested', confirm: `Cancel run #${r.run_number}?`, invalidate: inv })}>
                        cancel
                      </button>
                    )}
                    <button className="btn ghost icon sm danger" title="Delete run" disabled={busy !== '' || r.status !== 'completed'} onClick={() => run({ path: `/actions/runs/${r.id}/delete`, label: 'Run deleted', confirm: `Delete run #${r.run_number} and its logs?`, invalidate: inv })}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
        <span className="muted small">page {page}</span>
        <button className="btn ghost sm" disabled={!runs.data?.next} onClick={() => setPage(page + 1)}>→</button>
      </div>
      {sel && <RunDialog id={Number(sel)} onClose={() => open(null)} />}
      {dispatch && (
        <Dialog title={`Run ${dispatch.name}`} onClose={() => setDispatch(null)}>
          <div className="stack" style={{ gap: 8 }}>
            <p className="muted small" style={{ margin: 0 }}>Sends a workflow_dispatch event; the workflow must declare that trigger.</p>
            <input className="input mono" placeholder="ref (default branch)" value={dRef} onChange={(e) => setDRef(e.target.value)} aria-label="Ref" />
            <textarea className="textarea mono" rows={3} placeholder={'inputs, one per line: key=value'} value={dInputs} onChange={(e) => setDInputs(e.target.value)} aria-label="Inputs" />
            <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={busy === 'dispatch'} onClick={async () => { const inputs = Object.fromEntries(dInputs.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])); const r = await run({ path: `/actions/workflows/${encodeURIComponent(dispatch.path.split('/').pop()!)}/dispatch`, body: { ref: dRef, inputs }, label: `${dispatch.name} started`, invalidate: inv, key: 'dispatch' }); if (r) setDispatch(null) }} data-gh-dispatch-go="">
              <Busy on={busy === 'dispatch'}>
                <Play size={13} />
              </Busy>{' '}
              Run workflow
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function RunDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const d = useGh<{ run: Run; jobs: Job[]; artifacts: { id: number; name: string; size: number; expired: boolean; created_at: string }[] }>(`/actions/runs/${id}`, { refetchInterval: 10_000 })
  const [job, setJob] = useState<number | null>(null)
  const logs = useGh<{ logs: string; lines: number; truncated: boolean }>(job ? `/actions/jobs/${job}/logs?tail=1500` : null, { staleTime: 60_000 })
  const { run, busy } = useGhAction()
  const r = d.data?.run
  return (
    <Dialog title={r ? `${r.name} #${r.run_number}` : `Run ${id}`} onClose={onClose} wide>
      {d.error && <p className="muted">{(d.error as Error).message}</p>}
      {r && (
        <div className="stack" style={{ gap: 8 }} data-gh-run-dialog="">
          <div className="row" style={{ gap: 6 }}>
            <RunChip status={r.status} conclusion={r.conclusion} />
            <span className="small">{r.title}</span>
            <span className="small muted">
              {r.event} · {r.branch} · <span className="mono">{short(r.sha)}</span> · {r.actor} · started {ago(r.run_started_at)}
            </span>
            <a href={r.url} target="_blank" rel="noreferrer" className="small">
              GitHub <ExternalLink size={10} />
            </a>
            <span className="grow" />
            {r.status === 'completed' ? (
              <button className="btn sm" disabled={busy !== ''} onClick={() => run({ path: `/actions/runs/${id}/rerun`, label: 'Re-run requested', invalidate: ['/actions', '/overview'] })}>
                <RotateCw size={12} /> Re-run
              </button>
            ) : (
              <button className="btn sm danger" disabled={busy !== ''} onClick={() => run({ path: `/actions/runs/${id}/cancel`, label: 'Cancel requested', invalidate: ['/actions', '/overview'] })}>
                Cancel
              </button>
            )}
          </div>
          <div className="gh-jobs">
            {d.data!.jobs.map((j) => (
              <div key={j.id} className={`gh-job ${job === j.id ? 'active' : ''}`}>
                <button className="gh-job-head" onClick={() => setJob(job === j.id ? null : j.id)} data-gh-job={j.name}>
                  <RunChip status={j.status} conclusion={j.conclusion} /> <strong>{j.name}</strong>
                  <span className="muted small">
                    {j.runner} {j.completed_at && j.started_at ? `· ${Math.round((Date.parse(j.completed_at) - Date.parse(j.started_at)) / 1000)}s` : ''}
                  </span>
                  <span className="grow" />
                  <ScrollText size={12} />
                </button>
                <ol className="gh-steps">
                  {j.steps.map((s) => (
                    <li key={s.number} className={s.conclusion === 'failure' ? 'fail' : s.conclusion === 'success' ? 'ok' : s.conclusion === 'skipped' ? 'skip' : ''}>
                      <span className="gh-step-dot" /> {s.name}
                      {s.completed_at && s.started_at && <span className="muted small"> {Math.round((Date.parse(s.completed_at) - Date.parse(s.started_at)) / 1000)}s</span>}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          {job && (
            <>
              <div className="row small muted" style={{ gap: 6 }}>
                <span>Log of job {d.data!.jobs.find((j) => j.id === job)?.name}</span>
                {logs.data?.truncated && <span>(last 1500 of {logs.data.lines} lines)</span>}
              </div>
              <pre className="vps-pre tall" data-gh-log="">{logs.data?.logs ?? (logs.isLoading ? 'Loading…' : (logs.error as Error | null)?.message ?? '')}</pre>
            </>
          )}
          {d.data!.artifacts.length > 0 && (
            <div className="row" style={{ gap: 4 }}>
              <span className="small muted">Artifacts:</span>
              {d.data!.artifacts.map((a) => (
                <span key={a.id} className="chip" title={`${Math.round(a.size / 1024)} KB · ${ago(a.created_at)}`}>
                  {a.name} {a.expired && '(expired)'}
                  <button className="tab-close" onClick={() => run({ method: 'DELETE', path: `/actions/artifacts/${a.id}`, label: 'Artifact deleted', confirm: `Delete artifact ${a.name}?`, invalidate: ['/actions/runs'] })} aria-label="Delete artifact">
                    <Trash2 size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
