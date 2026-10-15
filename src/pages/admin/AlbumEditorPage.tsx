import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowLeftRight, Camera, Copy, ExternalLink, Globe, GripVertical, KeyRound, Link2, Link2Off, Lock, Pencil, Star, Trash2 } from 'lucide-react'
import { api, ApiError, uploadRaw } from '../../api/client'
import { renderAlbumSnapshot } from '../../lib/snapshot'
import { useAlbum, useBuddies, useGalleries, useMe, useSettings, useUsers, useAlbumLinks, useCreateLink } from '../../api/hooks'
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
  const { data: galleriesAll } = useGalleries()
  const { data: collabData } = useQuery({ queryKey: ['album-collaborators', id], queryFn: () => api.get<{ collaborators: { id: number }[] }>(`/api/albums/${id}/collaborators`).then((r) => r.collaborators.map((c) => c.id)), enabled: !!id })
  const [collab, setCollab] = useState<number[] | null>(null)
  const saveCollab = useMutation({ mutationFn: (ids: number[]) => api.put(`/api/albums/${id}/collaborators`, { userIds: ids }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['album-collaborators', id] }); notify('Collaborators saved', 'success') }, onError: (e: Error) => notify(e.message, 'error') })
  const [restricted, setRestricted] = useState(false)
  const [allowed, setAllowed] = useState<number[]>([])
  const [accessDirty, setAccessDirty] = useState(false)
  const [pinDialog, setPinDialog] = useState<'set' | 'change' | null>(null)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [snapBusy, setSnapBusy] = useState(false)
  const lastSig = useRef('')

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

  /** Picture of the album page used as the blurred backdrop of the PIN prompt; refreshed whenever a shared album changes. */
  const takeSnapshot = useCallback(async () => {
    if (!data) return
    setSnapBusy(true)
    try {
      const cols = (data.album.layoutOverride ?? site?.settings.defaultLayout)?.columns
      const blob = await renderAlbumSnapshot({ title: data.album.title, description: data.album.description }, media, { columns: cols })
      await uploadRaw(`/api/albums/${id}/snapshot`, blob, 'image/jpeg', {})
      refresh()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSnapBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, media, id, site])
  useEffect(() => {
    if (!data?.album.isShared) return
    const sig = [data.album.title, data.album.description, media.map((m) => m.id).join(',')].join('|')
    if (!lastSig.current) {
      lastSig.current = sig
      if (data.album.snapshotUrl && !data.album.snapshotStale) return
    } else if (lastSig.current === sig) return
    else lastSig.current = sig
    const t = setTimeout(() => void takeSnapshot(), 1500)
    return () => clearTimeout(t)
  }, [data?.album.isShared, data?.album.title, data?.album.description, data?.album.snapshotUrl, data?.album.snapshotStale, media, takeSnapshot])

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
      <Modal open={pinDialog != null} onClose={() => setPinDialog(null)} title={pinDialog === 'change' ? 'Change the PIN' : 'Share behind a PIN'}>
        <form
          className="stack"
          style={{ gap: 10 }}
          data-pin-dialog=""
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (pin !== pin2) return notify('The two PINs do not match', 'error')
            patch.mutate(
              { visibility: 'shared', pin },
              {
                onSuccess: () => {
                  setPinDialog(null)
                  setPin('')
                  setPin2('')
                  notify(pinDialog === 'change' ? 'PIN changed' : 'Album is now shared behind a PIN', 'success')
                  if (pinDialog !== 'change' && !(links ?? []).some((l) => !l.revokedAt)) createLink.mutate({ albumId: album.id, label: 'PIN link' }, { onSuccess: (l) => notify(`Private link created: ${l.fullUrl}`, 'success') })
                },
              },
            )
          }}
        >
          <p className="muted small" style={{ margin: 0 }}>
            {pinDialog === 'change' ? 'Pick a new PIN; existing viewers will have to enter it again.' : 'The album becomes private and reachable only through a private link plus this PIN (4 to 8 digits). A snapshot of the page is taken for the lock screen.'}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <div className="field grow">
              <label htmlFor="pin-1">PIN</label>
              <input id="pin-1" className="input pin-input" inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus required autoComplete="off" />
            </div>
            <div className="field grow">
              <label htmlFor="pin-2">Again</label>
              <input id="pin-2" className="input pin-input" inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} required autoComplete="off" />
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setPinDialog(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={pin.length < 4 || patch.isPending} data-pin-save="">
              <Lock size={14} /> {pinDialog === 'change' ? 'Change PIN' : 'Share with PIN'}
            </button>
          </div>
        </form>
      </Modal>
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
          <select className="select" value={album.visibility} onChange={(e) => (e.target.value === 'shared' ? setPinDialog('set') : patch.mutate({ visibility: e.target.value }))} style={{ width: 'auto' }} aria-label="Visibility">
            <option value="draft">Draft (hidden)</option>
            <option value="published">Buddies &amp; members</option>
            <option value="public">Public (no login)</option>
            <option value="shared">Shared private (link + PIN)</option>
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
          {(galleriesAll ?? []).filter((g) => g.isMine || me?.role === 'owner').length > 1 && (
            <section className="card stack" style={{ gap: 'calc(var(--space) * 1.5)' }}>
              <h3 style={{ margin: 0 }}>Gallery</h3>
              <select className="select" value={album.galleryId} onChange={(e) => patch.mutate({ galleryId: Number(e.target.value) }, { onSuccess: () => notify('Album moved', 'success') })} aria-label="Gallery">
                {(galleriesAll ?? []).filter((g) => g.isMine || me?.role === 'owner').map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                    {g.isPrimary ? ' · primary' : ''}
                  </option>
                ))}
              </select>
            </section>
          )}

          <section className="card stack" style={{ gap: 'calc(var(--space) * 1.5)' }}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>Shared album</h3>
              <span className="badge">{(collab ?? collabData ?? []).length} collaborators</span>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Collaborators can add their own photos and videos to this album, like a shared album. Pick from your buddies.
            </p>
            <CheckList options={(buddyLists?.buddies ?? []).map((b) => ({ id: b.id, label: b.displayName, hint: `@${b.username}` }))} selected={collab ?? collabData ?? []} onChange={setCollab} emptyText="Add buddies first to share an album with them." />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary sm" onClick={() => saveCollab.mutate(collab ?? collabData ?? [])} disabled={collab == null || saveCollab.isPending}>
                Save collaborators
              </button>
            </div>
          </section>

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
            {album.isShared && (
              <div className="card stack" style={{ gap: 8 }} data-shared-pin="">
                <div className="row between">
                  <span className="badge accent">
                    <Lock size={11} /> PIN protected
                  </span>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn sm" onClick={() => setPinDialog('change')} data-change-pin="">
                      <KeyRound size={13} /> Change PIN
                    </button>
                    <button className="btn sm" onClick={() => void takeSnapshot()} disabled={snapBusy} data-refresh-snapshot="">
                      <Camera size={13} /> {snapBusy ? 'Rendering…' : 'Refresh snapshot'}
                    </button>
                  </div>
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  Anyone opening a private link sees a blurred picture of this page and a PIN prompt; the album opens after the right PIN. The picture is taken again whenever the album changes.
                </p>
                {album.snapshotUrl ? <img className="snapshot-preview" src={album.snapshotUrl} alt="Lock screen preview" data-snapshot-preview="" /> : <span className="muted small">Snapshot not taken yet.</span>}
              </div>
            )}
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
