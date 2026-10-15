import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowLeftRight, Copy, ExternalLink, Globe, GripVertical, Link2, Link2Off, Lock, Pencil, Star, Trash2 } from 'lucide-react'
import { api, ApiError } from '../../api/client'
import { useAlbum, useBuddies, useMe, useSettings, useUsers, useAlbumLinks, useCreateLink } from '../../api/hooks'
import { CheckList } from '../../components/CheckList'
import type { Album, LayoutConfig, MediaItem } from '../../api/types'
import { MediaThumb } from '../../components/MediaThumb'
import { Modal } from '../../components/Modal'
import { LayoutEditor } from '../../components/LayoutEditor'
import { Uploader } from '../../components/Uploader'
import { PageLoader } from '../../components/Skeleton'
import { formatBytes, formatDuration } from '../../lib/media'
import { useUI } from '../../store/ui'

type Draft = Pick<Album, 'title' | 'slug' | 'description' | 'tags'>

export function AlbumEditorPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const { data: site } = useSettings()
  const { data, isLoading, error } = useAlbum(id)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [tagText, setTagText] = useState('')
  const [editing, setEditing] = useState<MediaItem | null>(null)
  const [layoutDraft, setLayoutDraft] = useState<LayoutConfig | null>(null)
  const [media, setMedia] = useState<MediaItem[]>([])
  const [dragId, setDragId] = useState<number | null>(null)
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin' || me?.role === 'owner'
  const { data: users } = useUsers(isAdmin)
  const { data: buddyLists } = useBuddies(!!me)
  const [restricted, setRestricted] = useState(false)
  const [allowed, setAllowed] = useState<number[]>([])
  const [accessDirty, setAccessDirty] = useState(false)

  useEffect(() => {
    if (data && !draft) {
      setDraft({ title: data.album.title, slug: data.album.slug, description: data.album.description, tags: data.album.tags })
      setTagText(data.album.tags.join(', '))
    }
  }, [data, draft])
  useEffect(() => setMedia(data?.media ?? []), [data?.media])
  useEffect(() => {
    if (data && !accessDirty) {
      setRestricted(data.album.restricted)
      setAllowed(data.album.allowedUserIds ?? [])
    }
  }, [data, accessDirty])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['album'] })
    qc.invalidateQueries({ queryKey: ['albums'] })
  }
  const patch = useMutation({
    mutationFn: (p: Record<string, unknown>) => api.put<{ album: Album }>(`/api/albums/${id}`, p),
    onSuccess: refresh,
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const { data: links } = useAlbumLinks(id ? Number(id) : null)
  const createLink = useCreateLink()
  const [linkLabel, setLinkLabel] = useState('')
  const revokeLink = useMutation({
    mutationFn: (linkId: number) => api.del(`/api/albums/${id}/links/${linkId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['album-links', Number(id)] })
      notify('Link revoked')
    },
  })
  const updateMedia = useMutation({
    mutationFn: (v: { id: number; title: string; description: string }) => api.put(`/api/media/${v.id}`, v),
    onSuccess: () => {
      refresh()
      setEditing(null)
    },
  })
  const removeMedia = useMutation({ mutationFn: (mid: number) => api.del(`/api/media/${mid}`), onSuccess: refresh })
  const saveAccess = useMutation({
    mutationFn: () => api.put(`/api/albums/${id}/access`, { restricted, userIds: allowed }),
    onSuccess: () => {
      refresh()
      setAccessDirty(false)
      notify('Album access saved', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const setPublic = useMutation({
    mutationFn: (enable: boolean) => api.put(`/api/galleries/${data!.album.galleryId}`, { publicAlbumId: enable ? data!.album.id : null }),
    onSuccess: () => {
      refresh()
      qc.invalidateQueries({ queryKey: ['gallery'] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      notify('Gallery public album updated', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const reorder = useMutation({ mutationFn: (ids: number[]) => api.put('/api/media/reorder', { ids }), onSuccess: refresh })

  if (isLoading || !site) return <PageLoader />
  if (error instanceof ApiError && error.status === 404) return <Navigate to="/me/albums" replace />
  if (!data || !draft) return <PageLoader />
  const { album } = data

  const saveDetails = () => {
    const tags = tagText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    patch.mutate({ ...draft, tags }, { onSuccess: () => notify('Album saved', 'success') })
  }

  const onDrop = (targetId: number) => {
    if (dragId == null || dragId === targetId) return
    const from = media.findIndex((m) => m.id === dragId)
    const to = media.findIndex((m) => m.id === targetId)
    const next = [...media]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setMedia(next)
    setDragId(null)
    reorder.mutate(next.map((m) => m.id))
  }

  const members = (users ?? []).filter((u) => u.role === 'user' && (u.galleryIds ?? []).includes(album.galleryId))
  const memberOptions = members.map((u) => ({ id: u.id, label: u.display_name, hint: `@${u.username}${u.status === 'pending' ? ' · pending' : ''}` }))
  for (const b of buddyLists?.buddies ?? []) if (!memberOptions.some((o) => o.id === b.id)) memberOptions.push({ id: b.id, label: b.displayName, hint: `@${b.username} · buddy` })

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div className="row between">
        <div>
          <Link to="/me/albums" className="btn ghost sm" style={{ marginLeft: -10 }}>
            <ArrowLeft size={14} /> Albums
          </Link>
          <h1 style={{ margin: '6px 0 0' }}>{album.title}</h1>
        </div>
        <div className="row">
          <Link to={`/album/${album.slug}`} className="btn">
            <ExternalLink size={14} /> View
          </Link>
          <button className={`btn ${album.featured ? 'accent' : ''}`} onClick={() => patch.mutate({ featured: !album.featured })}>
            <Star size={14} fill={album.featured ? 'currentColor' : 'none'} /> {album.featured ? 'Featured' : 'Feature'}
          </button>
          <select className="select" value={album.visibility} onChange={(e) => patch.mutate({ visibility: e.target.value })} style={{ width: 'auto' }} aria-label="Visibility">
            <option value="draft">Draft (hidden)</option>
            <option value="published">Buddies &amp; members</option>
            <option value="public">Public (no login)</option>
          </select>
        </div>
      </div>

      <div className="two-col">
        <section className="card stack" style={{ gap: 'calc(var(--space) * 2)' }}>
          <h3>Details</h3>
          <div className="field">
            <label>Title</label>
            <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div className="field">
            <label>URL slug</label>
            <input className="input" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea className="textarea" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
          <div className="field">
            <label>Tags (comma separated)</label>
            <input className="input" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="travel, portraits, 35mm" />
          </div>
          <div>
            <button className="btn primary" onClick={saveDetails} disabled={!draft.title.trim() || patch.isPending}>
              Save details
            </button>
          </div>
        </section>

        <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
          <section className="card stack" style={{ gap: 'calc(var(--space) * 1.5)' }}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>Private links</h3>
              <span className="badge">{(links ?? []).filter((l) => !l.revokedAt).length} active</span>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Anyone holding a private link can view this album without signing in, whatever its visibility. Every link you create is unique, so you can hand out one per person and revoke them individually.
            </p>
            <div className="row">
              <input className="input grow" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Label (optional), e.g. for Grandma" />
              <button className="btn primary sm" onClick={() => createLink.mutate({ albumId: album.id, label: linkLabel }, { onSuccess: (l) => { setLinkLabel(''); notify(`New private link copied: ${l.fullUrl}`, 'success') }, onError: (e: Error) => notify(e.message, 'error') })} disabled={createLink.isPending}>
                <Link2 size={14} /> New link
              </button>
            </div>
            {(links ?? []).filter((l) => !l.revokedAt).map((l) => (
              <div className="row" key={l.id} style={{ gap: 6 }}>
                <input className="input grow" readOnly value={`${location.origin}${l.url}`} onFocus={(e) => e.target.select()} title={l.label} />
                <span className="muted small" style={{ whiteSpace: 'nowrap' }}>
                  {l.label ? `${l.label} · ` : ''}
                  {l.views} view{l.views === 1 ? '' : 's'}
                </span>
                <button className="btn icon sm" title="Copy" onClick={() => navigator.clipboard.writeText(`${location.origin}${l.url}`).then(() => notify('Link copied', 'success'))}>
                  <Copy size={14} />
                </button>
                <button className="btn ghost icon sm danger" title="Revoke" onClick={() => confirm('Revoke this link? Anyone using it will lose access.') && revokeLink.mutate(l.id)}>
                  <Link2Off size={14} />
                </button>
              </div>
            ))}
            {album.shareToken && (
              <p className="muted small" style={{ margin: 0 }}>
                Legacy link {`${location.origin}/s/${album.shareToken}`} still works.
              </p>
            )}
          </section>

          <section className="card stack" style={{ gap: 'calc(var(--space) * 1.5)' }}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>Who can see this album</h3>
              {album.isPublic ? <span className="badge success">{album.isHook ? 'Public album' : 'Public'}</span> : restricted ? <span className="badge accent">Selected members</span> : <span className="badge">Buddies &amp; members</span>}
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={restricted} onChange={(e) => { setRestricted(e.target.checked); setAccessDirty(true) }} /> <Lock size={14} /> Limit to selected people
            </label>
            {restricted && (
              <CheckList options={memberOptions} selected={allowed} onChange={(ids) => { setAllowed(ids); setAccessDirty(true) }} emptyText="No buddies or members yet. Add buddies first." />
            )}
            <div className="row between">
              <button className="btn sm" onClick={() => setPublic.mutate(!album.isHook)} disabled={setPublic.isPending} title="The public album is the one visitors see first on the gallery's public page, without logging in">
                <Globe size={14} /> {album.isHook ? 'Unset as public album' : 'Make this the public album'}
              </button>
              <button className="btn primary sm" onClick={() => saveAccess.mutate()} disabled={!accessDirty || saveAccess.isPending}>
                Save access
              </button>
            </div>
          </section>

          <section className="card stack" style={{ gap: 'calc(var(--space) * 1.5)' }}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>Layout</h3>
              {album.layoutOverride ? <span className="badge accent">Override: {album.layoutOverride.kind}</span> : <span className="badge">Inherits default ({site.settings.defaultLayout.kind})</span>}
            </div>
            {layoutDraft ? (
              <>
                <LayoutEditor value={layoutDraft} onChange={setLayoutDraft} />
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn" onClick={() => setLayoutDraft(null)}>
                    Cancel
                  </button>
                  <button className="btn primary" onClick={() => patch.mutate({ layoutOverride: layoutDraft }, { onSuccess: () => setLayoutDraft(null) })}>
                    Save override
                  </button>
                </div>
              </>
            ) : (
              <div className="row">
                <button className="btn sm" onClick={() => setLayoutDraft(album.layoutOverride ?? site.settings.defaultLayout)}>
                  <Pencil size={14} /> {album.layoutOverride ? 'Edit override' : 'Override layout'}
                </button>
                {album.layoutOverride && (
                  <button className="btn ghost sm" onClick={() => patch.mutate({ layoutOverride: null })}>
                    <ArrowLeftRight size={14} /> Use default
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="card stack" style={{ gap: 'calc(var(--space) * 2)' }}>
        <div className="row between">
          <h3 style={{ margin: 0 }}>Media ({media.length})</h3>
          <span className="muted small">Drag tiles to reorder · star sets the cover</span>
        </div>
        <Uploader albumId={album.id} onUploaded={refresh} />
        <div className="media-admin-grid">
          {media.map((m) => (
            <div
              key={m.id}
              className={`media-admin-item ${album.coverMediaId === m.id ? 'cover' : ''} ${dragId === m.id ? 'dragging' : ''}`}
              draggable
              onDragStart={() => setDragId(m.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(m.id)}
            >
              <div className="thumb">
                <MediaThumb item={m} />
                {m.kind === 'video' && <span className="kind-badge">{formatDuration(m.duration ?? undefined) || 'video'}</span>}
                <span className="grip">
                  <GripVertical size={14} />
                </span>
              </div>
              <div className="meta">
                <strong className="ellipsis" style={{ display: 'block' }}>
                  {m.title || 'Untitled'}
                </strong>
                <span className="muted">
                  {m.width}×{m.height} · {formatBytes(m.size)} · {m.likes} ♥
                </span>
              </div>
              <div className="actions">
                <button className="btn ghost icon sm" title="Set as cover" onClick={() => patch.mutate({ coverMediaId: m.id })}>
                  <Star size={14} fill={album.coverMediaId === m.id ? 'currentColor' : 'none'} />
                </button>
                <button className="btn ghost icon sm" title="Edit" onClick={() => setEditing(m)}>
                  <Pencil size={14} />
                </button>
                <button className="btn ghost icon sm danger" title="Delete" onClick={() => confirm(`Delete "${m.title}"?`) && removeMedia.mutate(m.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit media">
        {editing && (
          <form
            className="stack"
            style={{ gap: 'calc(var(--space) * 2)' }}
            onSubmit={(e) => {
              e.preventDefault()
              updateMedia.mutate({ id: editing.id, title: editing.title, description: editing.description })
            }}
          >
            <div className="modal-preview">
              <MediaThumb item={editing} />
            </div>
            <div className="field">
              <label>Title</label>
              <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div className="field">
              <label>Description / caption</label>
              <textarea className="textarea" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn primary" disabled={updateMedia.isPending}>
                Save
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
