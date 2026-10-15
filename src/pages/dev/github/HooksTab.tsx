import { CheckCircle2, Plug, RefreshCw, Trash2, Webhook, Zap } from 'lucide-react'
import { ago, useGh, type GhEvent } from '../../../api/github'
import { Busy, useGhAction } from './common'

interface Hook { id: number; url: string; events: string[]; active: boolean; ours: boolean; last: { code: number | null; status: string; message: string | null } | null; updated_at: string }

/** The webhook that keeps this server (and so every client, phone included) current the instant something happens on GitHub. */
export function HooksTab() {
  const hooks = useGh<{ hooks: Hook[]; webhookUrl: string; events: string[] }>('/hooks')
  const events = useGh<{ events: GhEvent[] }>('/events', { refetchInterval: 6_000, staleTime: 0 })
  const { run, busy } = useGhAction()
  const ours = hooks.data?.hooks.find((h) => h.ours)
  return (
    <div className="stack" style={{ gap: 10 }} data-gh-hooks="">
      <section className="card stack" style={{ gap: 8 }}>
        <div className="row between">
          <h3 style={{ margin: 0 }}>
            <Webhook size={16} /> Webhook → this server
          </h3>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn ghost sm" onClick={() => hooks.refetch()}>
              <RefreshCw size={12} />
            </button>
            <button className="btn primary sm" disabled={busy !== ''} onClick={() => run({ path: '/hooks/install', label: ours ? 'Webhook updated' : 'Webhook installed', invalidate: ['/hooks', '/events'], key: 'install' })} data-gh-install-hook="">
              <Busy on={busy === 'install'}>
                <Plug size={12} />
              </Busy>{' '}
              {ours ? 'Re-apply webhook' : 'Install webhook'}
            </button>
          </div>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          GitHub posts pushes, workflow runs, pull requests, issues, comments, releases, branches and stars to <span className="mono">{hooks.data?.webhookUrl}</span>, signed with a secret only this server knows. Each delivery refreshes the server's snapshot and lands in the activity feed; failed deploys and new PRs/issues also notify the owner in the site's bell.
        </p>
        {hooks.error && <div className="dev-session-chip warn">{(hooks.error as Error).message}</div>}
        <table className="table compact">
          <tbody>
            {(hooks.data?.hooks ?? []).map((h) => (
              <tr key={h.id} data-gh-hook={h.id}>
                <td className="mono small">
                  {h.url} {h.ours && <span className="chip st-done"><CheckCircle2 size={10} /> this panel</span>}
                </td>
                <td className="small">
                  {h.active ? <span className="chip st-done">active</span> : <span className="chip">inactive</span>} {h.events.length} events
                  {h.last && <div className="muted">last delivery: {h.last.code ?? '—'} {h.last.message ?? h.last.status}</div>}
                </td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn ghost sm" disabled={busy !== ''} onClick={() => run({ path: `/hooks/${h.id}/ping`, label: 'Ping sent; it should appear in the feed in a moment', invalidate: ['/events'] })}>
                      <Zap size={11} /> ping
                    </button>
                    <button className="btn ghost icon sm danger" disabled={busy !== ''} onClick={() => run({ method: 'DELETE', path: `/hooks/${h.id}`, label: 'Webhook removed', confirm: 'Remove this webhook?', invalidate: ['/hooks'] })}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {hooks.data && !hooks.data.hooks.length && (
              <tr>
                <td className="muted small">No webhooks on the repository yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <section className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Deliveries received</h3>
        {events.data?.events.length ? (
          <ul className="gh-feed" data-gh-deliveries="">
            {events.data.events.map((e) => (
              <li key={e.id}>
                <span className="chip">{e.event}{e.action ? ` · ${e.action}` : ''}</span> <a href={e.url} target="_blank" rel="noreferrer">{e.summary}</a> <span className="muted small">{e.actor} · {ago(e.ts)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>Nothing yet. Install the webhook and press ping.</p>
        )}
      </section>
    </div>
  )
}
