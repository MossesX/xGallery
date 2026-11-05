import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Clapperboard, Download, Eye, Globe, Heart, ImagePlus, Images, Link2, Lock, Play, Share2, Tv, Upload } from 'lucide-react'
import { useAlbum, useSettings, useCreateLink, useTogglePublic, keys } from '../api/hooks'
import { UploadList, UPLOAD_ACCEPT, useUploadQueue } from '../components/Uploader'
import { MediaLayout } from '../components/MediaLayout'
import { Lightbox } from '../components/Lightbox'
import { Comments } from '../components/Comments'
import { PlayPanel } from '../components/PlayPanel'
import { FavoriteButton } from '../components/FavoriteButton'
import { PageLoader } from '../components/Skeleton'
import { useUI } from '../store/ui'
import { ApiError } from '../api/client'

export function AlbumPage() {
  const { slug } = useParams()
  const { data: site } = useSettings()
  const { data, isLoading, error } = useAlbum(slug)
  const togglePublic = useTogglePublic()
  const createLink = useCreateLink()
  const notify = useUI((s) => s.notify)
  const [params, setParams] = useSearchParams()
  const openId = params.get('m')
  const [open, setOpen] = useState<number | null>(null)
  const qc = useQueryClient()
  const pickRef = useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = useState(false)
  // New photos and videos land in the grid as each one finishes uploading.
  const uploads = useUploadQueue(data?.album.id ?? 0, () => {
    qc.invalidateQueries({ queryKey: keys.album(slug ?? '') })
    qc.invalidateQueries({ queryKey: ['albums'] })
  })

  useEffect(() => {
    if (!data || !openId) return
    const idx = data.media.findIndex((m) => String(m.id) === openId)
    if (idx >= 0) setOpen(idx)
  }, [data, openId])

  if (isLoading || !site) return <PageLoader />
  if (error instanceof ApiError && error.status === 404) return <Navigate to="/" replace />
  if (!data) return <PageLoader />

  const { album, media, comments } = data
  const layout = album.layoutOverride ?? site.settings.defaultLayout
  // The hero needs a picture: skip videos that have no thumbnail.
  const heroItem = [album.cover, ...media].find((m) => m && (m.kind === 'image' || m.thumbUrl))

  const videos = media.filter((m) => m.kind === 'video')
  const playId = params.get('play') ? Number(params.get('play')) : null
  const setPlay = (id: number | null) => {
    const next = new URLSearchParams(params)
    if (id == null) next.delete('play')
    else {
      next.set('play', String(id))
      next.delete('m')
    }
    setParams(next, { replace: true })
  }
  const openAt = (i: number) => {
    setOpen(i)
    const next = new URLSearchParams(params)
    next.set('m', String(media[i].id))
    setParams(next, { replace: true })
  }
  const navigateLightbox = (i: number) => {
    setOpen(i)
    const next = new URLSearchParams(params)
    next.set('m', String(media[i].id))
    setParams(next, { replace: true })
  }
  const close = () => {
    setOpen(null)
    const next = new URLSearchParams(params)
    next.delete('m')
    setParams(next, { replace: true })
  }

  const canManage = !!data?.canManage
  const itemLink = (m: { id: number }) => createLink.mutate({ albumId: album.id, mediaId: m.id }, { onSuccess: (l) => notify(`Item link copied: ${l.fullUrl}`, 'success'), onError: (e: Error) => notify(e.message, 'error') })
  const dropProps = canManage
    ? {
        onDragOver: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDropping(true)
        },
        onDragLeave: (e: DragEvent) => {
          if (e.currentTarget === e.target) setDropping(false)
        },
        onDrop: (e: DragEvent) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          setDropping(false)
          uploads.addFiles(e.dataTransfer.files)
        },
      }
    : {}
  const privateLink = () =>
    createLink.mutate({ albumId: album.id }, { onSuccess: (l) => notify(`Private link copied: ${l.fullUrl}`, 'success'), onError: (e: Error) => notify(e.message, 'error') })
  const flipPublic = () => togglePublic.mutate({ albumId: album.id, makePublic: !album.isPublic }, { onSuccess: () => notify(album.isPublic ? 'Album is now for buddies & members' : 'Album is now public', 'success'), onError: (e: Error) => notify(e.message, 'error') })
  const share = async () => {
    const url = album.shareToken ? `${location.origin}/s/${album.shareToken}` : location.href
    try {
      await navigator.clipboard.writeText(url)
      notify(album.shareToken ? 'Public share link copied' : 'Link copied (members only)', 'success')
    } catch {
      notify(url)
    }
  }

  return (
    <main className={`page ${dropping ? 'album-dropping' : ''}`} data-album-id={album.id} data-album-slug={album.slug} data-album-title={album.title} data-album-public={album.isPublic ? '1' : '0'} data-album-manage={canManage ? '1' : '0'} {...dropProps}>
      {dropping && (
        <div className="album-drop-hint" aria-hidden>
          <ImagePlus size={28} /> Drop to add to “{album.title}”
        </div>
      )}
      <div className="row between" style={{ marginBottom: 'calc(var(--space) * 2)' }}>
        <Link to={album.gallery ? `/g/${album.gallery.slug}` : '/'} className="btn ghost sm">
          <ArrowLeft size={14} /> {album.gallery?.title ?? 'All galleries'}
        </Link>
        <div className="row">
          {canManage && (
            <button className="btn sm primary" onClick={() => pickRef.current?.click()} disabled={uploads.busy} title="Add photos and videos to this album (or drop them anywhere on the page)" data-album-add="">
              {uploads.busy ? <Upload size={14} /> : <ImagePlus size={14} />} {uploads.busy ? 'Uploading…' : 'Add photos & videos'}
            </button>
          )}
          <button className="btn sm" onClick={share}>
            <Share2 size={14} /> Share
          </button>
          <FavoriteButton album={album} />
          {site.settings.allowDownloads && media.length > 0 && (
            <a className="btn sm" href={`/api/albums/${album.id}/download.zip`} title="Download the whole album as a ZIP">
              <Download size={14} /> ZIP
            </a>
          )}
          {canManage && (
            <>
              <button className={`btn sm ${album.isPublic ? 'accent' : ''}`} onClick={flipPublic} disabled={togglePublic.isPending} title={album.isPublic ? 'Public: anyone can see this album. Click to make it buddies & members only.' : 'Make this album public (no login needed)'} aria-pressed={album.isPublic}>
                {album.isPublic ? <Globe size={14} /> : <Lock size={14} />} {album.isPublic ? 'Public' : 'Make public'}
              </button>
              <button className="btn sm" onClick={privateLink} disabled={createLink.isPending} title="Create a new unique private link; anyone with it can view this album">
                <Link2 size={14} /> Public link
              </button>
            </>
          )}
          {videos.length > 0 && (
            <button className="btn sm" onClick={() => setPlay(videos[0].id)}>
              <Tv size={14} /> Play videos
            </button>
          )}
          {media.length > 1 && (
            <button className="btn sm" onClick={() => navigateLightbox(0)}>
              <Play size={14} /> Slideshow
            </button>
          )}
        </div>
      </div>

      {layout.heroCover && heroItem ? (
        <section className="album-hero">
          <img src={heroItem.thumbUrl ?? heroItem.url} alt="" />
          <div className="shade" />
          <div className="content">
            <div className="row" style={{ gap: 6, marginBottom: 10 }}>
              {album.tags.map((t) => (
                <Link to={`/?tag=${encodeURIComponent(t)}`} className="chip chip-glass" key={t}>
                  #{t}
                </Link>
              ))}
              {album.visibility === 'public' && <span className="chip chip-glass">Public</span>}
            </div>
            <h1>{album.title}</h1>
            {album.description && <p className="lead">{album.description}</p>}
            <AlbumMeta album={album} />
          </div>
        </section>
      ) : (
        <header className="album-header">
          <div className="row" style={{ gap: 6, marginBottom: 10 }}>
            {album.tags.map((t) => (
              <Link to={`/?tag=${encodeURIComponent(t)}`} className="badge primary" key={t}>
                #{t}
              </Link>
            ))}
          </div>
          <h1>{album.title}</h1>
          {album.description && <p className="muted lead" style={{ maxWidth: 720 }}>{album.description}</p>}
          <AlbumMeta album={album} muted />
        </header>
      )}

      {playId != null && videos.some((v) => v.id === playId) && (
        <PlayPanel videos={videos} currentId={playId} onSelect={(id) => setPlay(id)} onClose={() => setPlay(null)} allowLikes={site.settings.allowLikes} allowDownloads={site.settings.allowDownloads} />
      )}

      {canManage && (
        <input
          ref={pickRef}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          hidden
          onChange={(e) => {
            if (e.target.files) uploads.addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      )}
      <UploadList items={uploads.items} />

      {canManage && media.length === 0 ? (
        <button className="dropzone" style={{ width: '100%' }} onClick={() => pickRef.current?.click()} data-album-empty-add="">
          <div className="dropzone-icon">
            <ImagePlus size={26} strokeWidth={1.4} />
          </div>
          <div>
            <strong>Add the first photos and videos</strong>
          </div>
          <div className="small muted">Tap to pick from your phone, or drop files anywhere on this page.</div>
        </button>
      ) : (
        <MediaLayout items={media} layout={layout} onOpen={openAt} />
      )}

      {canManage && media.length > 0 && (
        <button className="btn primary album-fab" onClick={() => pickRef.current?.click()} aria-label="Add photos and videos" title="Add photos and videos" data-album-fab="">
          <ImagePlus size={20} />
        </button>
      )}

      {site.settings.allowComments && (
        <section className="card discussion">
          <h3>Discussion</h3>
          <Comments albumId={album.id} initial={comments} />
        </section>
      )}

      {open != null && (
        <Lightbox items={media} index={open} onClose={close} onNavigate={navigateLightbox} allowComments={site.settings.allowComments} allowLikes={site.settings.allowLikes} allowDownloads={site.settings.allowDownloads} context={album.title} onPrivateLink={canManage ? itemLink : undefined} />
      )}
    </main>
  )
}

function AlbumMeta({ album, muted }: { album: { counts: { media: number; videos: number; likes: number }; views: number }; muted?: boolean }) {
  return (
    <div className={`row album-meta ${muted ? 'muted' : ''}`} style={{ gap: 16, marginTop: 10 }}>
      <span className="row" style={{ gap: 5 }}>
        <Images size={14} /> {album.counts.media} items
      </span>
      {album.counts.videos > 0 && (
        <span className="row" style={{ gap: 5 }}>
          <Clapperboard size={14} /> {album.counts.videos} videos
        </span>
      )}
      <span className="row" style={{ gap: 5 }}>
        <Heart size={14} /> {album.counts.likes}
      </span>
      <span className="row" style={{ gap: 5 }}>
        <Eye size={14} /> {album.views}
      </span>
    </div>
  )
}
