import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ExternalLink, GitBranch, Loader2, Rocket, Star } from 'lucide-react'
import { ago, short, useGh, type Overview } from '../../../api/github'
import { Busy, Kv, RunChip, useGhAction } from './common'

export function OverviewTab() {
  const ov = useGh<Overview>('/overview', { refetchInterval: 30_000 })
  const { run, busy } = useGhAction()
  const [, setParams] = useSearchParams()
  const go = (tab: string, extra: Record<string, string> = {}) => setParams((p) => { p.set('tab', tab); for (const [k, v] of Object.entries(extra)) p.set(k, v); return p })
  const o = ov.data
  if (ov.error) return <div className="dev-session-chip warn">{(ov.error as Error).message}</div>
  if (!o) return <p className="muted">Loading…</p>
  const live = o.live
  return (
    <div className="stack" style={{ gap: 12 }} data-gh-overview="">
      {o.error && (
        <div className="dev-session-chip warn">
          <AlertTriangle size={12} /> {o.error} {o.fetchedAt ? `(showing data from ${ago(o.fetchedAt)})` : ''}
        </div>
      )}
      <div className="vps-grid-2">
        <section className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>
              <Rocket size={16} /> Live site
            </h3>
            <button className="btn primary sm" disabled={busy !== '' || !o.repo} onClick={() => run({ path: '/deploy', label: 'Deploy workflow dispatched', confirm: `Deploy ${o.repo?.default_branch} to the VPS now?`, key: 'deploy' })} data-gh-deploy="">
              <Busy on={busy === 'deploy'}>
                <Rocket size={12} />
              </Busy>{' '}
              Deploy {o.repo?.default_branch ?? ''}
            </button>
          </div>
          <Kv
            items={[
              ['Running', <span className="mono">{live.version === 'dev' ? 'development build' : short(live.version)}</span>],
              ['Latest commit', o.headCommit ? <span><span className="mono">{short(o.headSha)}</span> {o.headCommit.message} <span className="muted small">· {o.headCommit.author}, {ago(o.headCommit.date)}</span></span> : '—'],
              ['Status', live.deploying ? <span className="chip st-in_progress"><Loader2 size={11} className="spin" /> deploying</span> : live.upToDate == null ? <span className="chip">unknown</span> : live.upToDate ? <span className="chip st-done"><CheckCircle2 size={11} /> up to date</span> : <span className="chip prio-high">behind: {short(o.headSha)} is not deployed</span>],
              ['Last deploy', live.lastDeploy ? <span><RunChip status={live.lastDeploy.status} conclusion={live.lastDeploy.conclusion} /> #{live.lastDeploy.run_number} {ago(live.lastDeploy.updated_at)} <a href={live.lastDeploy.url} target="_blank" rel="noreferrer"><ExternalLink size={10} /></a></span> : '—'],
              ['Snapshot', <span className="muted small">{ago(o.fetchedAt)} · refreshed by webhook, timer and on demand</span>],
            ]}
          />
        </section>
        <section className="card stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>Repository</h3>
          {o.repo ? (
            <Kv
              items={[
                ['Name', <a href={o.repo.url} target="_blank" rel="noreferrer">{o.repo.full_name} <ExternalLink size={10} /></a>],
                ['Visibility', <span className="chip">{o.repo.visibility || (o.repo.private ? 'private' : 'public')}</span>],
                ['Default branch', <button className="link" onClick={() => go('branches')}><GitBranch size={11} /> {o.repo.default_branch} · {o.branches} branch{o.branches === 1 ? '' : 'es'}</button>],
                ['Activity', `pushed ${ago(o.repo.pushed_at)} · ${o.repo.language || '—'} · ${Math.round(o.repo.size / 1024)} MB`],
                ['Stars / forks', <span><Star size={11} /> {o.repo.stars} · {o.repo.forks} forks</span>],
                ['Latest release', o.release ? <button className="link" onClick={() => go('releases')}>{o.release.tag} {o.release.name ? `· ${o.release.name}` : ''} {o.release.prerelease ? '(pre-release)' : ''} · {ago(o.release.published_at)}</button> : 'none'],
              ]}
            />
          ) : (
            <p className="muted small">Pick a repository and token in Settings.</p>
          )}
        </section>
      </div>
      <div className="vps-grid-2">
        <section className="card stack" style={{ gap: 6 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>Recent workflow runs</h3>
            <button className="link small" onClick={() => go('actions')}>all runs</button>
          </div>
          <table className="table compact">
            <tbody>
              {o.runs.slice(0, 8).map((r) => (
                <tr key={r.id} className="gh-row" onClick={() => go('actions', { run: String(r.id) })} data-gh-run={r.id}>
                  <td>
                    <RunChip status={r.status} conclusion={r.conclusion} />
                  </td>
                  <td className="small">
                    <strong>{r.name}</strong> #{r.run_number}
                    <div className="muted">{r.title}</div>
                  </td>
                  <td className="small muted">
                    {r.branch} · {r.actor} · {ago(r.updated_at)}
                  </td>
                </tr>
              ))}
              {!o.runs.length && (
                <tr>
                  <td className="muted small">No runs yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="card stack" style={{ gap: 6 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>Recent commits on {o.repo?.default_branch}</h3>
            <button className="link small" onClick={() => go('commits')}>history</button>
          </div>
          <table className="table compact">
            <tbody>
              {o.commits.slice(0, 8).map((c) => (
                <tr key={c.sha} className="gh-row" onClick={() => go('commits', { sha: c.sha })}>
                  <td className="mono small">{short(c.sha)}</td>
                  <td className="small">{c.message}</td>
                  <td className="small muted">
                    {c.author} · {ago(c.date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <div className="vps-grid-2">
        <section className="card stack" style={{ gap: 6 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>Open pull requests ({o.pulls.length})</h3>
            <button className="link small" onClick={() => go('pulls')}>all</button>
          </div>
          {o.pulls.length ? (
            <table className="table compact">
              <tbody>
                {o.pulls.slice(0, 6).map((p) => (
                  <tr key={p.number} className="gh-row" onClick={() => go('pulls', { n: String(p.number) })}>
                    <td className="small">
                      <strong>#{p.number}</strong> {p.title} {p.draft && <span className="chip">draft</span>}
                      <div className="muted">
                        {p.head} → {p.base} · {p.author} · {ago(p.updated_at)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>None open.</p>
          )}
        </section>
        <section className="card stack" style={{ gap: 6 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>Open issues ({o.issues.length})</h3>
            <button className="link small" onClick={() => go('issues')}>all</button>
          </div>
          {o.issues.length ? (
            <table className="table compact">
              <tbody>
                {o.issues.slice(0, 6).map((i) => (
                  <tr key={i.number} className="gh-row" onClick={() => go('issues', { n: String(i.number) })}>
                    <td className="small">
                      <strong>#{i.number}</strong> {i.title} {i.labels.map((l) => <span key={l} className="chip">{l}</span>)}
                      <div className="muted">
                        {i.author} · {i.comments} comment{i.comments === 1 ? '' : 's'} · {ago(i.updated_at)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>None open.</p>
          )}
        </section>
      </div>
      <section className="card stack" style={{ gap: 6 }} data-gh-feed="">
        <div className="row between">
          <h3 style={{ margin: 0 }}>Activity feed (webhook)</h3>
          <Link className="link small" to="?tab=hooks">webhook setup</Link>
        </div>
        {o.events.length ? (
          <ul className="gh-feed">
            {o.events.slice(0, 20).map((e) => (
              <li key={e.id}>
                <span className="chip">{e.event}</span> <a href={e.url} target="_blank" rel="noreferrer">{e.summary}</a> <span className="muted small">{ago(e.ts)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>Nothing received yet. Install the webhook (Webhooks tab) and GitHub will push every event here, so the panel and the phone app stay current without polling.</p>
        )}
      </section>
    </div>
  )
}
