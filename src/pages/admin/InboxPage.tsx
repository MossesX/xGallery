import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Inbox, Mail, RotateCcw, Trash2, UserPlus, X } from 'lucide-react'
import { api } from '../../api/client'
import { useInbox } from '../../api/hooks'
import type { InboxItem } from '../../api/types'
import { Modal } from '../../components/Modal'
import { useUI } from '../../store/ui'
import { timeAgo } from '../../lib/media'

type Filter = 'open' | 'all'

/** Owner only: account requests from visitors and contact messages from members, kept apart from private messages. */
export function InboxPage() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const [filter, setFilter] = useState<Filter>('open')
  const { data: items, isLoading } = useInbox(filter === 'open' ? 'open' : '')
  const [approving, setApproving] = useState<InboxItem | null>(null)
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [creds, setCreds] = useState<{ username: string; password: string } | null>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['inbox'] })
    qc.invalidateQueries({ queryKey: ['inbox-unread'] })
    qc.invalidateQueries({ queryKey: ['users'] })
  }
  useEffect(() => {
    api.put('/api/inbox/read', {}).then(() => qc.invalidateQueries({ queryKey: ['inbox-unread'] })).catch(() => {})
  }, [qc])

  const act = useMutation({
    mutationFn: (v: { id: number; action: string; username?: string; role?: string; note?: string }) => api.put<{ item: InboxItem; credentials: { username: string; password: string } | null }>(`/api/inbox/${v.id}`, v),
    onSuccess: (r) => {
      refresh()
      if (r.credentials) {
        setCreds(r.credentials)
        setApproving(null)
      }
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/inbox/${id}`), onSuccess: refresh })

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow">Owner only</div>
          <h1 style={{ margin: 0 }}>Inbox</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Account requests from visitors and notes from members. Your private messages live in My space.
          </p>
        </div>
        <div className="feed-tabs">
          <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>
            Open
          </button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            Everything
          </button>
        </div>
      </div>

      {isLoading ? null : !items?.length ? (
        <div className="empty">
          <Inbox size={40} strokeWidth={1.2} />
          <p style={{ marginTop: 12 }}>{filter === 'open' ? 'Nothing waiting for you.' : 'The inbox is empty.'}</p>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {items.map((it) => (
            <article className={`card inbox-item ${it.status !== 'open' ? 'is-closed' : ''} ${!it.readAt ? 'is-unread' : ''}`} key={it.id}>
              <div className="row between" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {it.kind === 'account_request' ? (
                      <span className="chip">
                        <UserPlus size={11} /> Account request
                      </span>
                    ) : (
                      <span className="chip">
                        <Mail size={11} /> Message
                      </span>
                    )}
                    {it.status === 'open' ? <span className="badge primary">Open</span> : it.status === 'approved' ? <span className="badge success">Approved</span> : it.status === 'done' ? <span className="badge success">Done</span> : <span className="badge">Dismissed</span>}
                    <span className="muted small">{timeAgo(it.createdAt)}</span>
                  </div>
                  <strong>
                    {it.name}
                    {it.from ? ` · @${it.from.username}` : ''}
                  </strong>
                  <span className="muted small">
                    {it.contact}
                    {it.usernameWanted ? ` · wants @${it.usernameWanted}` : ''}
                  </span>
                  {it.body && <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{it.body}</p>}
                  {it.note && <p className="muted small" style={{ margin: '6px 0 0' }}>Note: {it.note}</p>}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {it.status === 'open' && it.kind === 'account_request' && (
                    <button className="btn primary sm" onClick={() => { setApproving(it); setUsername(it.usernameWanted || ''); setRole('user') }}>
                      <Check size={14} /> Approve
                    </button>
                  )}
                  {it.status === 'open' && it.kind === 'contact' && (
                    <button className="btn primary sm" onClick={() => act.mutate({ id: it.id, action: 'done' })}>
                      <Check size={14} /> Done
                    </button>
                  )}
                  {it.status === 'open' ? (
                    <button className="btn sm" onClick={() => act.mutate({ id: it.id, action: 'dismiss' })}>
                      <X size={14} /> Dismiss
                    </button>
                  ) : (
                    <button className="btn ghost sm" onClick={() => act.mutate({ id: it.id, action: 'reopen' })}>
                      <RotateCcw size={14} /> Reopen
                    </button>
                  )}
                  {it.from && (
                    <a className="btn ghost sm" href={`/me/messages/${it.from.id}`}>
                      Reply privately
                    </a>
                  )}
                  <button className="btn ghost icon sm danger" title="Delete" onClick={() => confirm('Delete this item?') && remove.mutate(it.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={!!approving} onClose={() => setApproving(null)} title="Approve account request">
        {approving && (
          <div className="stack" style={{ gap: 'calc(var(--space) * 2)' }}>
            <p className="muted small" style={{ margin: 0 }}>
              Creates a member account for <strong>{approving.name}</strong> ({approving.contact}). The password is generated and shown once; the account stays pending until they sign in.
            </p>
            <div className="field">
              <label>Username</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="auto from their name" />
            </div>
            <div className="field">
              <label>Role</label>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
                <option value="user">Member</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setApproving(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => act.mutate({ id: approving.id, action: 'approve', username: username.trim() || undefined, role })} disabled={act.isPending}>
                <UserPlus size={14} /> Create account
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!creds} onClose={() => setCreds(null)} title="Account created">
        {creds && (
          <div className="stack" style={{ gap: 'calc(var(--space) * 2)' }}>
            <p className="muted small" style={{ margin: 0 }}>
              Send these to the person. The password is not stored in readable form, so copy it now.
            </p>
            <div className="row">
              <input className="input grow" readOnly value={creds.username} />
              <button className="btn icon" onClick={() => navigator.clipboard.writeText(creds.username).then(() => notify('Copied', 'success'))}>
                <Copy size={14} />
              </button>
            </div>
            <div className="row">
              <input className="input grow" readOnly value={creds.password} />
              <button className="btn icon" onClick={() => navigator.clipboard.writeText(creds.password).then(() => notify('Copied', 'success'))}>
                <Copy size={14} />
              </button>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={() => setCreds(null)}>
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
