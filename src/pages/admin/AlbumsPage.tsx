import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Globe, GripVertical, Plus, Star, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import { useAlbums, useMe } from '../../api/hooks'
import type { Album } from '../../api/types'
import { Modal } from '../../components/Modal'
import { MediaThumb } from '../../components/MediaThumb'
import { useUI } from '../../store/ui'

export function AlbumsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const { data: me } = useMe()
  const { data } = useAlbums({ sort: 'manual', mine: '1' })
  const [list, setList] = useState<Album[]>([])
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [makePublic, setMakePublic] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  // One entry per gallery the admin manages (usually one): its current public album, if any.
  const galleries = list.reduce<{ id: number; title: string; hook: Album | null; albums: Album[] }[]>((acc, a) => {
    let g = acc.find((x) => x.id === a.galleryId)
    if (!g) {
      g = { id: a.galleryId, title: a.gallery?.title ?? 'My gallery', hook: null, albums: [] }
      acc.push(g)
    }
    g.albums.push(a)
    if (a.isHook) g.hook = a
    return acc
  }, [])
  const noPublicAlbum = galleries.length === 0 || galleries.every((g) => !g.hook)
  useEffect(() => setList(data?.albums ?? []), [data])
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['albums'] })
    qc.invalidateQueries({ queryKey: ['album'] })
  }

  const create = useMutation({
    mutationFn: () => api.post<{ album: Album }>('/api/albums', { title, makePublic: noPublicAlbum && makePublic }),
    onSuccess: (r) => {
      refresh()
      qc.invalidateQueries({ queryKey: ['galleries'] })
      qc.invalidateQueries({ queryKey: ['gallery'] })
      setOpen(false)
      setTitle('')
      setMakePublic(false)
      if (r.album.isHook) notify(`"${r.album.title}" is now the public album`, 'success')
      navigate(`/me/albums/${r.album.id}`)
    },
  })
  const setHook = useMutation({
    mutationFn: (v: { galleryId: number; albumId: number | null }) => api.put(`/api/galleries/${v.galleryId}`, { publicAlbumId: v.albumId }),
    onSuccess: (_r, v) => {
      refresh()
      qc.invalidateQueries({ queryKey: ['galleries'] })
      qc.invalidateQueries({ queryKey: ['gallery'] })
      notify(v.albumId ? 'Public album updated' : 'Public album cleared', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const patch = useMutation({
    mutationFn: (v: { id: number; patch: Record<string, unknown> }) => api.put(`/api/albums/${v.id}`, v.patch),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/albums/${id}`),
    onSuccess: () => {
      refresh()
      notify('Album deleted')
    },
  })
  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.put('/api/albums/reorder', { ids }),
    onSuccess: refresh,
  })

  const onDrop = (targetId: number) => {
    if (dragId == null || dragId === targetId) return
    const from = list.findIndex((a) => a.id === dragId)
    const to = list.findIndex((a) => a.id === targetId)
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setList(next)
    setDragId(null)
    reorder.mutate(next.map((a) => a.id))
  }

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div className="row between">
        <div>
          <div className="eyebrow">Content</div>
          <h1 style={{ margin: 0 }}>Albums</h1>
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>
          <Plus size={16} /> New album
        </button>
      </div>
      {galleries.map((g) => (
        <section className="card public-album-panel" key={g.id}>
          <div className="row between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div className="stack" style={{ gap: 4, minWidth: 260 }}>
              <div className="eyebrow">{galleries.length > 1 ? g.title : 'Open to everyone'}</div>
              <h3 style={{ margin: 0 }}>
                <Globe size={16} /> Public album{g.hook ? ': ' : ''}
                {g.hook && (
                  <Link to={`/me/albums/${g.hook.id}`} style={{ color: 'inherit' }}>
                    {g.hook.title}
                  </Link>
                )}
              </h3>
              <p className="muted small" style={{ margin: 0 }}>
                {g.hook
                  ? 'Visitors see this album first on your public page, without logging in. Other albums set to Public are listed below it.'
                  : 'No public album yet. Pick one here, use the globe on a row, or create a new album and tick "make it the public album". Choosing an album makes it public.'}
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <select className="select" value={g.hook?.id ?? ''} onChange={(e) => setHook.mutate({ galleryId: g.id, albumId: e.target.value ? Number(e.target.value) : null })} aria-label="Public album" style={{ width: 'auto', minWidth: 220 }}>
                <option value="">None (no public album)</option>
                {g.albums.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                    {a.visibility === 'public' ? '' : ' · will become public'}
                  </option>
                ))}
              </select>
              {g.hook && (
                <>
                  <Link to={`/public/${g.hook.gallery?.slug ?? ''}`} className="btn" target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> Public page
                  </Link>
                  <button className="btn ghost" onClick={() => setHook.mutate({ galleryId: g.id, albumId: null })} disabled={setHook.isPending}>
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      ))}
      <p className="muted small">
        Draft = only you. Buddies &amp; members = your buddies and anyone granted access. Public = everyone, no login. Drag rows to set the order on your page; the globe marks the public album.
      </p>
      {list.length === 0 ? (
        <div className="empty">No albums yet. Create one to start uploading.</div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }} />
                <th>Album</th>
                <th>Items</th>
                <th>Layout</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr
                  key={a.id}
                  draggable
                  onDragStart={() => setDragId(a.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(a.id)}
                  className={dragId === a.id ? 'dragging' : ''}
                >
                  <td className="muted" style={{ cursor: 'grab' }}>
                    <GripVertical size={16} />
                  </td>
                  <td>
                    <div className="row" style={{ gap: 12 }}>
                      <div className="mini-cover">{a.cover && <MediaThumb item={a.cover} alt="" />}</div>
                      <div>
                        <Link to={`/me/albums/${a.id}`} style={{ color: 'inherit', fontWeight: 600 }}>
                          {a.title}
                        </Link>
                        <div className="muted small">
                          /album/{a.slug} {a.featured && <span className="badge accent">Featured</span>}
                          {a.isHook && <span className="badge success">Public album</span>}
                          {a.restricted && <span className="badge">Restricted</span>}
                          {me?.role === 'owner' && a.gallery && a.gallery.owner?.id !== me.id && <span className="badge primary">{a.gallery.title}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {a.counts.media}
                    {a.counts.videos > 0 && <span className="muted small"> · {a.counts.videos} video</span>}
                  </td>
                  <td>{a.layoutOverride ? <span className="badge accent">{a.layoutOverride.kind} (override)</span> : <span className="badge">Default</span>}</td>
                  <td>{a.visibility === 'public' ? <span className="badge success">Public</span> : a.visibility === 'published' ? <span className="badge primary">Buddies</span> : <span className="badge">Draft</span>}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                      <button className="btn ghost icon sm" title={a.featured ? 'Unfeature' : 'Feature on home'} onClick={() => patch.mutate({ id: a.id, patch: { featured: !a.featured } })}>
                        <Star size={14} fill={a.featured ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        className={`btn ghost icon sm ${a.isHook ? 'is-hook' : ''}`}
                        title={a.isHook ? 'This is the public album · click to unset' : 'Set as the public album (visible without login)'}
                        aria-label={a.isHook ? 'Unset public album' : 'Set as public album'}
                        aria-pressed={a.isHook}
                        onClick={() => setHook.mutate({ galleryId: a.galleryId, albumId: a.isHook ? null : a.id })}
                        disabled={setHook.isPending}
                      >
                        <Globe size={14} />
                      </button>
                      <select className="select" value={a.visibility} onChange={(e) => patch.mutate({ id: a.id, patch: { visibility: e.target.value } })} style={{ width: 'auto', padding: '3px 6px' }} aria-label="Visibility">
                        <option value="draft">Draft</option>
                        <option value="published">Buddies &amp; members</option>
                        <option value="public">Public</option>
                      </select>
                      <button className="btn ghost icon sm danger" title="Delete" onClick={() => confirm(`Delete "${a.title}" and all its media? This cannot be undone.`) && remove.mutate(a.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New album">
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            create.mutate()
          }}
          style={{ gap: 'calc(var(--space) * 2)' }}
        >
          {create.error && <div className="error">{create.error.message}</div>}
          <div className="field">
            <label>Title</label>
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer in Lisbon" />
          </div>
          {noPublicAlbum && (
            <label className="checkbox public-option">
              <input type="checkbox" checked={makePublic} onChange={(e) => setMakePublic(e.target.checked)} />
              <span>
                <Globe size={14} /> Make it the public album
                <span className="muted small" style={{ display: 'block', marginLeft: 0 }}>Your gallery has no public album yet. This one would be visible to everyone, without logging in.</span>
              </span>
            </label>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!title.trim() || create.isPending}>
              Create
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
