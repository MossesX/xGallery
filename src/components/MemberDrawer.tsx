import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, ExternalLink, Images, KeyRound, LogOut, MessageCircle, Save, Sparkles, Trash2, UserCheck, UserX, X } from 'lucide-react'
import { api } from '../api/client'
import { keys, useMe } from '../api/hooks'
import type { Perms, Role, User } from '../api/types'
import { Avatar } from './Avatar'
import { CheckList } from './CheckList'
import { useUI } from '../store/ui'
import { formatBytes } from '../lib/media'

interface Detail {
  user: User
  albums: { id: number; slug: string; title: string; visibility: string; updatedAt: number }[]
  recentComments: { id: number; body: string; createdAt: number }[]
}

export const PERM_LABELS: Record<keyof Perms, string> = {
  canUpload: 'Create albums and upload media',
  canPublish: 'Make albums public',
  canComment: 'Comment on albums and media',
  canReact: 'Like media and save albums',
  canMessage: 'Send private messages',
  canBuddies: 'Send buddy requests',
}

/** Owner-only: the full control panel for one account. */
export function MemberDrawer({ userId, galleries, onClose }: { userId: number | null; galleries: { id: number; label: string; hint?: string }[]; onClose: () => void }) {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const { data: me } = useMe()
  const { data, isLoading } = useQuery({ queryKey: ['user-detail', userId], queryFn: () => api.get<Detail>(`/api/users/${userId}`), enabled: userId != null })
  const [draft, setDraft] = useState<{ displayName: string; username: string; bio: string; role: Role; status: 'active' | 'pending'; galleryIds: number[]; perms: Perms } | null>(null)
  const [password, setPassword] = useState('')
  useEffect(() => {
    if (data) setDraft({ displayName: data.user.display_name, username: data.user.username, bio: data.user.bio, role: data.user.role, status: data.user.status, galleryIds: data.user.galleryIds ?? [], perms: data.user.perms })
  }, [data])
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['user-detail', userId] })
    qc.invalidateQueries({ queryKey: keys.users })
    qc.invalidateQueries({ queryKey: ['galleries'] })
  }
  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.put(`/api/users/${userId}`, patch),
    onSuccess: () => {
      refresh()
      notify('Account updated', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const signOut = useMutation({
    mutationFn: () => api.post<{ sessions: number }>(`/api/users/${userId}/signout`, {}),
    onSuccess: (r) => {
      refresh()
      notify(`Signed out of ${r.sessions} session${r.sessions === 1 ? '' : 's'}`, 'success')
    },
  })
  const impersonate = useMutation({
    mutationFn: () => api.post(`/api/users/${userId}/impersonate`, {}),
    onSuccess: () => {
      qc.clear()
      window.location.assign('/')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const remove = useMutation({
    mutationFn: () => api.del(`/api/users/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.users })
      notify('Account deleted')
      onClose()
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })

  if (userId == null) return null
  const u = data?.user
  const self = u?.id === me?.id
  const isOwner = u?.role === 'owner'

  return (
    <>
      <div className="assistant-backdrop" onClick={onClose} />
      <aside className="member-drawer" aria-label="Account control panel">
        <header className="assistant-head">
          <div className="assistant-title" style={{ color: 'inherit' }}>
            {u && <Avatar name={u.display_name} size={34} src={u.avatarUrl} />}
            <span>
              <strong>{u?.display_name ?? '…'}</strong>
              <span className="muted small">{u ? `@${u.username} · ${u.role === 'owner' ? 'Owner' : u.role === 'admin' ? 'Administrator' : 'Member'}` : ''}</span>
            </span>
          </div>
          <button className="btn ghost icon sm" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {isLoading || !u || !draft ? (
          <div className="muted small" style={{ padding: 16 }}>
            Loading…
          </div>
        ) : (
          <div className="assistant-body member-body">
            <section className="member-stats">
              <div>
                <strong>{u.counts?.albums ?? 0}</strong>
                <span>albums</span>
              </div>
              <div>
                <strong>{u.counts?.publicAlbums ?? 0}</strong>
                <span>public</span>
              </div>
              <div>
                <strong>{u.counts?.media ?? 0}</strong>
                <span>media</span>
              </div>
              <div>
                <strong>{formatBytes(u.counts?.bytes ?? 0)}</strong>
                <span>storage</span>
              </div>
              <div>
                <strong>{u.likes ?? 0}</strong>
                <span>likes</span>
              </div>
              <div>
                <strong>{u.comments ?? 0}</strong>
                <span>comments</span>
              </div>
              <div>
                <strong>{u.counts?.buddies ?? 0}</strong>
                <span>buddies</span>
              </div>
              <div>
                <strong>{u.counts?.sessions ?? 0}</strong>
                <span>sessions</span>
              </div>
            </section>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {u.ownGallerySlug && (
                <Link to={`/public/${u.ownGallerySlug}`} className="btn sm" target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> Public page
                </Link>
              )}
              {!self && (
                <Link to={`/me/messages/${u.id}`} className="btn sm">
                  <MessageCircle size={13} /> Message
                </Link>
              )}
              {!self && !isOwner && (
                <button className="btn sm" onClick={() => confirm(`Sign in as ${u.display_name}? You will see the site exactly as they do. Use "Return to Brett" in the banner to come back.`) && impersonate.mutate()} disabled={impersonate.isPending || !!u.disabled}>
                  <Eye size={13} /> Sign in as
                </button>
              )}
              <button className="btn sm" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
                <LogOut size={13} /> Sign out everywhere
              </button>
            </div>

            <section className="card stack" style={{ gap: 10 }}>
              <h3 style={{ margin: 0 }}>Identity</h3>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="field grow">
                  <label>Display name</label>
                  <input className="input" value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
                </div>
                <div className="field grow">
                  <label>Login name</label>
                  <input className="input" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} disabled={isOwner && !self} />
                </div>
              </div>
              <div className="field">
                <label>Bio</label>
                <textarea className="textarea" value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} style={{ minHeight: 60 }} />
              </div>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="field grow">
                  <label>Role</label>
                  <select className="select" value={draft.role} disabled={self} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
                    <option value="user">Member</option>
                    <option value="admin">Administrator</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
                <div className="field grow">
                  <label>Status</label>
                  <select className="select" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as 'active' | 'pending' })}>
                    <option value="active">Active</option>
                    <option value="pending">Pending first login</option>
                  </select>
                </div>
              </div>
              <div className="row between">
                {u.avatarUrl ? (
                  <button className="btn ghost sm" onClick={() => update.mutate({ clearAvatar: true })}>
                    Remove picture
                  </button>
                ) : (
                  <span />
                )}
                <button className="btn primary sm" onClick={() => update.mutate({ displayName: draft.displayName, username: draft.username, bio: draft.bio, role: draft.role, status: draft.status })} disabled={update.isPending}>
                  <Save size={13} /> Save identity
                </button>
              </div>
            </section>

            {!isOwner && (
              <section className="card stack" style={{ gap: 10 }}>
                <div className="row between">
                  <h3 style={{ margin: 0 }}>Access</h3>
                  {u.disabled ? <span className="badge">Disabled</span> : <span className="badge success">Enabled</span>}
                </div>
                <label className="checkbox">
                  <input type="checkbox" checked={!!u.aiEnabled} onChange={(e) => update.mutate({ aiEnabled: e.target.checked })} /> <Sparkles size={14} /> May use the AI assistant {u.role === 'admin' ? '(administrators included)' : ''}
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={!u.disabled} disabled={self} onChange={(e) => update.mutate({ disabled: !e.target.checked })} /> {u.disabled ? <UserX size={14} /> : <UserCheck size={14} />} Account enabled (sign-in allowed)
                </label>
                <div className="field" style={{ marginTop: 4 }}>
                  <label>Capabilities</label>
                  <div className="stack" style={{ gap: 6 }}>
                    {(Object.keys(PERM_LABELS) as (keyof Perms)[]).map((k) => (
                      <label className="checkbox" key={k}>
                        <input type="checkbox" checked={draft.perms[k]} onChange={(e) => setDraft({ ...draft, perms: { ...draft.perms, [k]: e.target.checked } })} /> {PERM_LABELS[k]}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn primary sm" onClick={() => update.mutate({ perms: draft.perms })} disabled={update.isPending}>
                    <Save size={13} /> Save capabilities
                  </button>
                </div>
              </section>
            )}

            <section className="card stack" style={{ gap: 10 }}>
              <h3 style={{ margin: 0 }}>Galleries this account can see</h3>
              <CheckList options={galleries} selected={draft.galleryIds} onChange={(galleryIds) => setDraft({ ...draft, galleryIds })} emptyText="No galleries yet." />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn primary sm" onClick={() => update.mutate({ galleryIds: draft.galleryIds })} disabled={update.isPending}>
                  <Save size={13} /> Save access
                </button>
              </div>
            </section>

            <section className="card stack" style={{ gap: 10 }}>
              <h3 style={{ margin: 0 }}>
                <KeyRound size={14} /> Password
              </h3>
              <div className="row">
                <input className="input grow" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (8+ characters)" />
                <button className="btn sm" onClick={() => update.mutate({ password }, { onSuccess: () => setPassword('') })} disabled={password.length < 8 || update.isPending}>
                  Reset
                </button>
              </div>
              <p className="muted small" style={{ margin: 0 }}>Resetting signs the account out everywhere and marks it pending until the next sign-in.</p>
            </section>

            {data.albums.length > 0 && (
              <section className="card stack" style={{ gap: 6 }}>
                <h3 style={{ margin: 0 }}>
                  <Images size={14} /> Albums
                </h3>
                {data.albums.slice(0, 12).map((a) => (
                  <div key={a.id} className="row between small">
                    <Link to={`/album/${a.slug}`}>{a.title}</Link>
                    <span className={`badge ${a.visibility === 'public' ? 'success' : a.visibility === 'published' ? 'primary' : ''}`}>{a.visibility === 'published' ? 'buddies' : a.visibility}</span>
                  </div>
                ))}
              </section>
            )}

            <div className="muted small">
              Joined {new Date(u.created_at).toLocaleDateString()} · last seen {u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : 'never'}
              {u.counts?.aiConversations ? ` · ${u.counts.aiConversations} assistant conversations` : ''}
            </div>
            {!self && !isOwner && (
              <button className="btn danger" onClick={() => confirm(`Delete ${u.display_name} (@${u.username}) with their gallery, albums, media, comments and messages? This cannot be undone.`) && remove.mutate()} disabled={remove.isPending}>
                <Trash2 size={14} /> Delete account and everything they uploaded
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  )
}
