import { useState } from 'react'
import { Bell, CheckCheck, RefreshCw, Users } from 'lucide-react'
import { ago, useGh } from '../../../api/github'
import { Busy, useGhAction } from './common'

interface N { id: string; reason: string; unread: boolean; updated_at: string; title: string; type: string; repo: string; url: string }
interface Collab { login: string; avatar: string; role: string; permissions: Record<string, boolean> }

/** The token user's GitHub inbox plus who has access to the repository. */
export function NotificationsTab() {
  const [all, setAll] = useState(false)
  const list = useGh<{ notifications: N[] }>(`/notifications?all=${all ? 1 : 0}`, { refetchInterval: 60_000 })
  const collabs = useGh<{ collaborators: Collab[] }>('/collaborators', { staleTime: 300_000 })
  const { run, busy } = useGhAction()
  const [invite, setInvite] = useState({ login: '', permission: 'push' })
  return (
    <div className="stack" style={{ gap: 10 }} data-gh-inbox="">
      <section className="card stack" style={{ gap: 8 }}>
        <div className="row between">
          <h3 style={{ margin: 0 }}>
            <Bell size={16} /> GitHub notifications
          </h3>
          <div className="row" style={{ gap: 4 }}>
            <label className="row small" style={{ gap: 4 }}>
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> include read
            </label>
            <button className="btn ghost sm" onClick={() => list.refetch()}>
              <RefreshCw size={12} />
            </button>
            <button className="btn sm" disabled={busy !== ''} onClick={() => run({ method: 'PUT', path: '/notifications/read', body: {}, label: 'All marked read', invalidate: ['/notifications'] })}>
              <CheckCheck size={12} /> Mark all read
            </button>
          </div>
        </div>
        {list.error && <div className="dev-session-chip warn">{(list.error as Error).message}</div>}
        <table className="table compact">
          <tbody>
            {(list.data?.notifications ?? []).map((n) => (
              <tr key={n.id} style={{ opacity: n.unread ? 1 : 0.6 }}>
                <td>
                  <span className="chip">{n.type}</span>
                </td>
                <td className="small">
                  <a href={n.url} target="_blank" rel="noreferrer">
                    {n.title}
                  </a>
                  <div className="muted">
                    {n.repo} · {n.reason.replace('_', ' ')} · {ago(n.updated_at)}
                  </div>
                </td>
                <td>
                  {n.unread && (
                    <button className="btn ghost sm" onClick={() => run({ method: 'PUT', path: '/notifications/read', body: { id: n.id }, label: 'Marked read', quiet: true, invalidate: ['/notifications'] })}>
                      read
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.data && !list.data.notifications.length && (
              <tr>
                <td className="muted small">Inbox zero.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>
          <Users size={16} /> Collaborators
        </h3>
        <div className="row" style={{ gap: 6 }}>
          {(collabs.data?.collaborators ?? []).map((c) => (
            <span key={c.login} className="chip" title={Object.entries(c.permissions ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ')}>
              {c.login} · {c.role || (c.permissions?.admin ? 'admin' : c.permissions?.push ? 'write' : 'read')}
              {!c.permissions?.admin && (
                <button className="tab-close" onClick={() => run({ method: 'DELETE', path: `/collaborators/${c.login}`, label: `${c.login} removed`, confirm: `Remove ${c.login} from the repository?`, invalidate: ['/collaborators'] })} aria-label={`Remove ${c.login}`}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: 4 }}>
          <input className="input sm" placeholder="github username" value={invite.login} onChange={(e) => setInvite({ ...invite, login: e.target.value })} style={{ width: 180 }} aria-label="Invite user" />
          <select className="select sm" value={invite.permission} onChange={(e) => setInvite({ ...invite, permission: e.target.value })} aria-label="Permission">
            {['pull', 'triage', 'push', 'maintain', 'admin'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <button className="btn sm" disabled={!invite.login || busy !== ''} onClick={async () => { const r = await run({ method: 'PUT', path: `/collaborators/${invite.login}`, body: { permission: invite.permission }, label: `${invite.login} invited`, invalidate: ['/collaborators'] }); if (r) setInvite({ login: '', permission: 'push' }) }}>
            <Busy on={busy !== ''}>Invite</Busy>
          </button>
        </div>
      </section>
    </div>
  )
}
