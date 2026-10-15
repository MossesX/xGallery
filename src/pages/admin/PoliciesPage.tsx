import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers, Plus, Save, ShieldCheck, Trash2, Users } from 'lucide-react'
import { api } from '../../api/client'
import { useGroups, usePolicy } from '../../api/hooks'
import type { Group, Limits, Perms, SitePolicy } from '../../api/types'
import { CheckList } from '../../components/CheckList'
import { Modal } from '../../components/Modal'
import { useUI } from '../../store/ui'

const PERM_KEYS: (keyof Perms)[] = ['canUpload', 'canPublish', 'canComment', 'canReact', 'canMessage', 'canBuddies', 'canShareLinks', 'canCreateGalleries', 'canChangeProfile', 'canDownload', 'canUseAssistant']
const LIMIT_KEYS: (keyof Limits)[] = ['maxGalleries', 'maxAlbums', 'maxMediaPerAlbum', 'maxUploadMb', 'storageQuotaMb', 'maxPrivateLinks', 'messagesPerHour']

/** A three-state control: inherit / allow / deny. */
export function TriState({ value, onChange, labels = ['Inherit', 'Allow', 'Deny'] }: { value: boolean | null | undefined; onChange: (v: boolean | null) => void; labels?: [string, string, string] }) {
  const cur = value == null ? 'inherit' : value ? 'allow' : 'deny'
  return (
    <span className="tristate" role="radiogroup">
      {(['inherit', 'allow', 'deny'] as const).map((k, i) => (
        <button key={k} type="button" role="radio" aria-checked={cur === k} className={`tristate-btn ${cur === k ? `is-${k}` : ''}`} onClick={() => onChange(k === 'inherit' ? null : k === 'allow')}>
          {labels[i]}
        </button>
      ))}
    </span>
  )
}

/** Owner only: site-wide switches and defaults, plus groups that override them for their members. */
export function PoliciesPage() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const { data } = usePolicy()
  const { data: groups } = useGroups()
  const [draft, setDraft] = useState<SitePolicy | null>(null)
  const [editing, setEditing] = useState<Group | null>(null)
  const [gDraft, setGDraft] = useState<{ name: string; description: string; priority: number; perms: Partial<Record<keyof Perms, boolean | null>>; limits: Partial<Record<keyof Limits, number | null>>; memberIds: number[] } | null>(null)
  const [newName, setNewName] = useState('')
  useEffect(() => {
    if (data && !draft) setDraft(data.policy)
  }, [data, draft])
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: { id: number; username: string; display_name: string; role: string }[] }>('/api/users').then((r) => r.users) })
  const { data: members } = useQuery({ queryKey: ['group-members', editing?.id], queryFn: () => api.get<{ members: { id: number }[] }>(`/api/policy/groups/${editing!.id}/members`).then((r) => r.members.map((m) => m.id)), enabled: !!editing })
  useEffect(() => {
    if (editing && members) setGDraft({ name: editing.name, description: editing.description, priority: editing.priority, perms: { ...editing.perms }, limits: { ...editing.limits }, memberIds: members })
  }, [editing, members])

  const save = useMutation({
    mutationFn: (patch: Partial<SitePolicy>) => api.put<{ policy: SitePolicy }>('/api/policy', patch),
    onSuccess: (r) => {
      setDraft(r.policy)
      qc.invalidateQueries({ queryKey: ['policy'] })
      qc.invalidateQueries({ queryKey: ['me'] })
      notify('Policy saved', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const createGroup = useMutation({
    mutationFn: () => api.post<{ group: Group }>('/api/policy/groups', { name: newName }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setNewName('')
      setEditing(r.group)
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const saveGroup = useMutation({
    mutationFn: () => api.put<{ group: Group }>(`/api/policy/groups/${editing!.id}`, gDraft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      setEditing(null)
      notify('Group saved', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const deleteGroup = useMutation({
    mutationFn: (id: number) => api.del(`/api/policy/groups/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      notify('Group deleted')
    },
  })

  if (!data || !draft) return null
  const permLabels = data.permLabels
  const limitLabels = data.limitLabels

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div>
        <div className="eyebrow">Owner only</div>
        <h1 style={{ margin: 0 }}>
          <ShieldCheck size={22} /> Policies
        </h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Site-wide defaults apply to everyone. Groups override them for their members. Per-account overrides in Members → Manage win over both.
        </p>
      </div>

      <div className="two-col">
        <section className="card stack" style={{ gap: 12 }}>
          <h3 style={{ margin: 0 }}>Default permissions</h3>
          <p className="muted small" style={{ margin: 0 }}>What every account may do unless a group or a per-account override says otherwise.</p>
          <div className="stack" style={{ gap: 6 }}>
            {PERM_KEYS.map((k) => (
              <label className="checkbox between" key={k}>
                <span style={{ textTransform: 'capitalize' }}>{permLabels[k] ?? k}</span>
                <input type="checkbox" checked={draft.perms[k]} onChange={(e) => setDraft({ ...draft, perms: { ...draft.perms, [k]: e.target.checked } })} />
              </label>
            ))}
          </div>
          <h3 style={{ margin: '8px 0 0' }}>Default limits</h3>
          <div className="limits-grid">
            {LIMIT_KEYS.map((k) => (
              <label className="field" key={k}>
                <span className="small">{limitLabels[k] ?? k}</span>
                <input className="input" type="number" min={0} value={draft.limits[k]} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, [k]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
          <div>
            <button className="btn primary" onClick={() => save.mutate({ perms: draft.perms, limits: draft.limits })} disabled={save.isPending}>
              <Save size={14} /> Save defaults
            </button>
          </div>
        </section>

        <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
          <section className="card stack" style={{ gap: 12 }}>
            <h3 style={{ margin: 0 }}>Site switches</h3>
            <label className="checkbox between">
              <span>Accept account requests from visitors</span>
              <input type="checkbox" checked={draft.acceptRequests} onChange={(e) => setDraft({ ...draft, acceptRequests: e.target.checked })} />
            </label>
            <label className="checkbox between">
              <span>Visitors may browse public albums without signing in</span>
              <input type="checkbox" checked={draft.publicBrowsing} onChange={(e) => setDraft({ ...draft, publicBrowsing: e.target.checked })} />
            </label>
            <label className="checkbox between">
              <span>New and reset passwords must be changed at first sign-in</span>
              <input type="checkbox" checked={draft.forcePasswordChange} onChange={(e) => setDraft({ ...draft, forcePasswordChange: e.target.checked })} />
            </label>
            <label className="checkbox between">
              <span>Hold members' comments until the album owner approves</span>
              <input type="checkbox" checked={draft.moderateComments} onChange={(e) => setDraft({ ...draft, moderateComments: e.target.checked })} />
            </label>
            <div className="field">
              <label>Private messaging</label>
              <select className="select" value={draft.messaging} onChange={(e) => setDraft({ ...draft, messaging: e.target.value as SitePolicy['messaging'] })}>
                <option value="anyone">Anyone can message anyone</option>
                <option value="buddies">Buddies only (the owner can always be reached)</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="field grow">
                <label>Default album visibility</label>
                <select className="select" value={draft.defaultVisibility} onChange={(e) => setDraft({ ...draft, defaultVisibility: e.target.value as SitePolicy['defaultVisibility'] })}>
                  <option value="draft">Draft (only the owner)</option>
                  <option value="published">Buddies &amp; members</option>
                  <option value="public">Public</option>
                </select>
              </div>
              <div className="field grow">
                <label>Minimum password length</label>
                <input className="input" type="number" min={6} max={64} value={draft.minPasswordLength} onChange={(e) => setDraft({ ...draft, minPasswordLength: Number(e.target.value) })} />
              </div>
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="field grow">
                <label>Sign-in attempts per 15 min</label>
                <input className="input" type="number" min={3} value={draft.loginAttempts} onChange={(e) => setDraft({ ...draft, loginAttempts: Number(e.target.value) })} />
              </div>
              <div className="field grow">
                <label>Session length, days</label>
                <input className="input" type="number" min={1} max={365} value={draft.sessionDays} onChange={(e) => setDraft({ ...draft, sessionDays: Number(e.target.value) })} />
              </div>
            </div>
            <div className="field">
              <label>Allowed upload types (comma separated prefixes)</label>
              <input className="input" value={draft.allowedTypes.join(', ')} onChange={(e) => setDraft({ ...draft, allowedTypes: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} placeholder="image/, video/" />
            </div>
            <div className="field">
              <label>Groups new members join automatically</label>
              <CheckList options={(groups ?? []).map((g) => ({ id: g.id, label: g.name }))} selected={draft.defaultGroupIds} onChange={(defaultGroupIds) => setDraft({ ...draft, defaultGroupIds })} emptyText="No groups yet." />
            </div>
            <div>
              <button className="btn primary" onClick={() => save.mutate({ acceptRequests: draft.acceptRequests, publicBrowsing: draft.publicBrowsing, forcePasswordChange: draft.forcePasswordChange, moderateComments: draft.moderateComments, messaging: draft.messaging, defaultVisibility: draft.defaultVisibility, minPasswordLength: draft.minPasswordLength, loginAttempts: draft.loginAttempts, sessionDays: draft.sessionDays, allowedTypes: draft.allowedTypes, defaultGroupIds: draft.defaultGroupIds })} disabled={save.isPending}>
                <Save size={14} /> Save switches
              </button>
            </div>
          </section>

          <section className="card stack" style={{ gap: 12 }}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>
                <Layers size={15} /> Groups
              </h3>
            </div>
            <p className="muted small" style={{ margin: 0 }}>A group sets overrides for its members. Higher priority groups win when a member is in several.</p>
            <div className="row">
              <input className="input grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New group name, e.g. Trusted uploaders" />
              <button className="btn sm" onClick={() => createGroup.mutate()} disabled={!newName.trim() || createGroup.isPending}>
                <Plus size={14} /> Create
              </button>
            </div>
            {!groups?.length ? (
              <div className="muted small">No groups yet.</div>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {groups.map((g) => (
                  <div key={g.id} className="row between group-row">
                    <div>
                      <strong>{g.name}</strong> <span className="muted small">· priority {g.priority} · {g.members} member{g.members === 1 ? '' : 's'} · {Object.keys(g.perms).length + Object.keys(g.limits).length} overrides</span>
                      {g.description && <div className="muted small">{g.description}</div>}
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn sm" onClick={() => setEditing(g)}>
                        <Users size={13} /> Edit
                      </button>
                      <button className="btn ghost icon sm danger" title="Delete" onClick={() => confirm(`Delete group "${g.name}"? Members keep their accounts.`) && deleteGroup.mutate(g.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Group: ${editing?.name ?? ''}`}>
        {editing && gDraft && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="field grow">
                <label>Name</label>
                <input className="input" value={gDraft.name} onChange={(e) => setGDraft({ ...gDraft, name: e.target.value })} />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label>Priority</label>
                <input className="input" type="number" value={gDraft.priority} onChange={(e) => setGDraft({ ...gDraft, priority: Number(e.target.value) })} />
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <input className="input" value={gDraft.description} onChange={(e) => setGDraft({ ...gDraft, description: e.target.value })} />
            </div>
            <div className="field">
              <label>Permission overrides</label>
              <div className="stack" style={{ gap: 4 }}>
                {PERM_KEYS.map((k) => (
                  <div className="row between" key={k}>
                    <span className="small" style={{ textTransform: 'capitalize' }}>{permLabels[k] ?? k}</span>
                    <TriState value={gDraft.perms[k]} onChange={(v) => setGDraft({ ...gDraft, perms: { ...gDraft.perms, [k]: v } })} />
                  </div>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Limit overrides (blank = inherit)</label>
              <div className="limits-grid">
                {LIMIT_KEYS.map((k) => (
                  <label className="field" key={k}>
                    <span className="small">{limitLabels[k] ?? k}</span>
                    <input className="input" type="number" min={0} value={gDraft.limits[k] ?? ''} placeholder="inherit" onChange={(e) => setGDraft({ ...gDraft, limits: { ...gDraft.limits, [k]: e.target.value === '' ? null : Number(e.target.value) } })} />
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Members</label>
              <CheckList options={(users ?? []).filter((u) => u.role !== 'owner').map((u) => ({ id: u.id, label: u.display_name, hint: `@${u.username}` }))} selected={gDraft.memberIds} onChange={(memberIds) => setGDraft({ ...gDraft, memberIds })} emptyText="No members yet." />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => saveGroup.mutate()} disabled={saveGroup.isPending || !gDraft.name.trim()}>
                <Save size={14} /> Save group
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
