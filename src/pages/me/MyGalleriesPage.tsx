import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, ExternalLink, FolderOpen, Images, Plus, Star, Trash2, Upload } from 'lucide-react'
import { api, uploadRaw } from '../../api/client'
import { useAlbums, useGalleries, useMe } from '../../api/hooks'
import type { Gallery, MediaItem } from '../../api/types'
import { Modal } from '../../components/Modal'
import { useUI } from '../../store/ui'

/** My galleries: create (within the account's limit), rename, pick or upload a gallery image, choose the primary. */
export function MyGalleriesPage() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const { data: me } = useMe()
  const { data: galleries } = useGalleries()
  const mine = (galleries ?? []).filter((g) => g.isMine)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [tagline, setTagline] = useState('')
  const [imageFor, setImageFor] = useState<Gallery | null>(null)
  const [pickAlbum, setPickAlbum] = useState<number | null>(null)
  const [pickMedia, setPickMedia] = useState<MediaItem[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const { data: albumsData } = useAlbums({ sort: 'manual', mine: '1' })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['galleries'] })
    qc.invalidateQueries({ queryKey: ['gallery'] })
    qc.invalidateQueries({ queryKey: ['me'] })
  }
  const create = useMutation({
    mutationFn: () => api.post<{ gallery: Gallery }>('/api/galleries', { title, tagline }),
    onSuccess: () => {
      refresh()
      setCreateOpen(false)
      setTitle('')
      setTagline('')
      notify('Gallery created', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const update = useMutation({ mutationFn: (v: { id: number; patch: Record<string, unknown> }) => api.put(`/api/galleries/${v.id}`, v.patch), onSuccess: refresh, onError: (e: Error) => notify(e.message, 'error') })
  const primary = useMutation({ mutationFn: (id: number) => api.post(`/api/galleries/${id}/primary`, {}), onSuccess: () => { refresh(); notify('Primary gallery changed', 'success') } })
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/galleries/${id}`), onSuccess: () => { refresh(); notify('Gallery deleted; its albums moved to your primary gallery') }, onError: (e: Error) => notify(e.message, 'error') })
  const uploadCover = async (g: Gallery, file: File | undefined) => {
    if (!file) return
    try {
      await uploadRaw(`/api/galleries/${g.id}/cover`, file, file.type, { fileName: file.name })
      refresh()
      notify('Gallery image updated', 'success')
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  const loadAlbumMedia = (albumId: number) => {
    setPickAlbum(albumId)
    api.get<{ media: MediaItem[] }>(`/api/albums/${albumId}`).then((r) => setPickMedia(r.media.filter((m) => m.kind === 'image')))
  }
  const limit = me?.limits.maxGalleries ?? 1
  const canCreate = !!me && (me.perms.canCreateGalleries || mine.length === 0) && (limit === 0 || mine.length < limit)

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow">My space</div>
          <h1 style={{ margin: 0 }}>
            <FolderOpen size={22} /> My galleries
          </h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {limit === 0 ? 'Unlimited galleries.' : `${mine.length} of ${limit} galler${limit === 1 ? 'y' : 'ies'} used.`} Each gallery has its own name, image, public page and albums.
          </p>
        </div>
        <button className="btn primary" onClick={() => setCreateOpen(true)} disabled={!canCreate} title={canCreate ? '' : 'Your account cannot create more galleries. Ask the owner.'}>
          <Plus size={16} /> New gallery
        </button>
      </div>
      <div className="gallery-browser">
        {mine.map((g) => (
          <article key={g.id} className="card my-gallery">
            <div className="my-gallery-cover">
              {g.coverUrl ? <img src={g.coverUrl} alt="" /> : g.splash ? <img src={g.splash.thumbUrl ?? g.splash.url} alt="" /> : <Images size={36} strokeWidth={1.2} />}
              {g.isPrimary && (
                <span className="chip chip-accent" style={{ position: 'absolute', top: 10, left: 10 }}>
                  <Star size={11} fill="currentColor" /> Primary
                </span>
              )}
            </div>
            <div className="stack" style={{ gap: 8, padding: '10px 12px 12px' }}>
              <input className="input" defaultValue={g.title} onBlur={(e) => e.target.value.trim() && e.target.value !== g.title && update.mutate({ id: g.id, patch: { title: e.target.value.trim() } })} aria-label="Gallery name" />
              <input className="input" defaultValue={g.tagline} placeholder="Tagline" onBlur={(e) => e.target.value !== g.tagline && update.mutate({ id: g.id, patch: { tagline: e.target.value } })} aria-label="Gallery tagline" />
              <div className="muted small">
                {g.counts.albums} albums · {g.counts.media} items · /public/{g.slug}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => setImageFor(g)}>
                  <Camera size={13} /> Gallery image
                </button>
                <Link to={`/public/${g.slug}`} className="btn sm">
                  <ExternalLink size={13} /> Page
                </Link>
                {!g.isPrimary && (
                  <button className="btn ghost sm" onClick={() => primary.mutate(g.id)}>
                    <Star size={13} /> Make primary
                  </button>
                )}
                {!g.isPrimary && (
                  <button className="btn ghost sm danger" onClick={() => confirm(`Delete "${g.title}"? Its albums move to your primary gallery.`) && remove.mutate(g.id)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New gallery">
        <form className="stack" style={{ gap: 12 }} onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate() }}>
          <div className="field">
            <label>Name</label>
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Travel, Family, Client work…" required />
          </div>
          <div className="field">
            <label>Tagline (optional)</label>
            <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!title.trim() || create.isPending}>
              Create gallery
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!imageFor} onClose={() => { setImageFor(null); setPickAlbum(null) }} title={`Gallery image · ${imageFor?.title ?? ''}`} wide>
        {imageFor && (
          <div className="stack" style={{ gap: 12 }}>
            <p className="muted small" style={{ margin: 0 }}>
              Choose the picture that represents this gallery on your page and in listings: upload one, or pick a photo from any of your albums. Leave both empty to use the default.
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn primary sm" onClick={() => fileRef.current?.click()}>
                <Upload size={13} /> Upload an image
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => uploadCover(imageFor, e.target.files?.[0])} />
              {(imageFor.coverUrl || imageFor.splashMediaId) && (
                <button className="btn ghost sm" onClick={() => update.mutate({ id: imageFor.id, patch: { clearCover: true, splashMediaId: null } })}>
                  Use the default
                </button>
              )}
            </div>
            <div className="field">
              <label>Or pick from an album</label>
              <select className="select" value={pickAlbum ?? ''} onChange={(e) => e.target.value && loadAlbumMedia(Number(e.target.value))}>
                <option value="">Choose an album…</option>
                {(albumsData?.albums ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                    {a.gallery ? ` · ${a.gallery.title}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {pickAlbum != null && (
              <div className="splash-picker">
                {pickMedia.map((m) => (
                  <button key={m.id} className={imageFor.splashMediaId === m.id ? 'active' : ''} onClick={() => update.mutate({ id: imageFor.id, patch: { splashMediaId: m.id, clearCover: true } }, { onSuccess: () => notify('Gallery image set', 'success') })}>
                    <img src={m.thumbUrl ?? m.url} alt="" />
                  </button>
                ))}
                {pickMedia.length === 0 && <div className="muted small">No photos in that album.</div>}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
