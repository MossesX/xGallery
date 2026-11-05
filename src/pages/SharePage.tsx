import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Clapperboard, Images, KeyRound, Lock } from 'lucide-react'
import { api } from '../api/client'
import { keys, useSettings, useShare, type SharedGallery, type SharedGalleryAlbum } from '../api/hooks'
import { MediaThumb } from '../components/MediaThumb'
import { MediaLayout } from '../components/MediaLayout'
import { Lightbox } from '../components/Lightbox'
import { PageLoader } from '../components/Skeleton'
import { PublicShell } from '../components/PublicShell'

/**
 * Login-free view through a private link. One link type per token:
 * an item link opens xGallery's viewer on that one photo or video, an album link opens the album,
 * a gallery link lists the gallery's albums (each opens at /s/:token/:album). PIN albums ask first.
 */
export function SharePage() {
  const { token, album: albumSlug } = useParams()
  const { data: site } = useSettings()
  const { data, isLoading, error } = useShare(token, albumSlug)
  const [open, setOpen] = useState<number | null>(null)
  const focus = data?.focus ?? null

  // An item link lands straight in the viewer, playing the video or showing the photo.
  useEffect(() => {
    if (focus != null && data?.media?.length) setOpen(0)
  }, [focus, data?.media?.length])

  if (isLoading || !site) return <PageLoader />

  const fromGallery = data?.gallery && 'token' in data.gallery ? data.gallery : null
  const back = fromGallery ? (
    <Link to={`/s/${fromGallery.token}`} className="btn ghost sm" style={{ marginBottom: 'calc(var(--space) * 2)' }}>
      <ArrowLeft size={14} /> {fromGallery.title}
    </Link>
  ) : null

  let body: React.ReactNode
  if (error || !data) {
    body = (
      <div className="empty">
        <p>This share link is not valid or has been turned off.</p>
      </div>
    )
  } else if (data.albums && data.gallery && !('token' in data.gallery)) {
    body = <SharedGalleryView token={token!} gallery={data.gallery} albums={data.albums} />
  } else if (data.locked && data.album) {
    body = (
      <>
        {back}
        <PinWall token={token!} albumSlug={albumSlug} title={data.album.title} description={data.album.description} snapshotUrl={data.snapshotUrl ?? null} />
      </>
    )
  } else if (data.album && data.media) {
    const layout = data.album.layoutOverride ?? site.settings.defaultLayout
    const single = focus != null
    const item = single ? data.media[0] : null
    body = (
      <>
        {back}
        <header className="album-header" data-share-kind={single ? 'item' : 'album'}>
          <div className="eyebrow">{single ? `Shared ${item?.kind === 'video' ? 'video' : 'photo'} · ${data.album.title}` : 'Shared album'}</div>
          <h1>{single ? item?.title || data.album.title : data.album.title}</h1>
          {!single && data.album.description && <p className="muted lead" style={{ maxWidth: 720 }}>{data.album.description}</p>}
          {single && item?.description && <p className="muted lead" style={{ maxWidth: 720 }}>{item.description}</p>}
        </header>
        <MediaLayout items={data.media} layout={{ ...layout, showLikes: false }} onOpen={setOpen} />
        {open != null && (
          <Lightbox items={data.media} index={open} onClose={() => setOpen(null)} onNavigate={setOpen} allowComments={false} allowLikes={false} allowDownloads={site.settings.allowDownloads} readOnly />
        )}
      </>
    )
  }

  return (
    <PublicShell>
      <main className="page">{body}</main>
    </PublicShell>
  )
}

/** A gallery link: the gallery's albums as cards; PIN albums show a lock. */
function SharedGalleryView({ token, gallery, albums }: { token: string; gallery: SharedGallery; albums: SharedGalleryAlbum[] }) {
  return (
    <>
      <header className="album-header" data-share-kind="gallery">
        <div className="eyebrow">Shared gallery</div>
        <h1>{gallery.title}</h1>
        {gallery.tagline && <p className="muted lead" style={{ maxWidth: 720 }}>{gallery.tagline}</p>}
      </header>
      {albums.length === 0 ? (
        <div className="empty">No albums here yet.</div>
      ) : (
        <div className="album-grid">
          {albums.map((a) => (
            <Link to={`/s/${token}/${a.slug}`} className="album-card" key={a.id} data-shared-album={a.slug}>
              <div className="cover">
                {a.cover ? (
                  <MediaThumb item={a.cover} alt="" />
                ) : (
                  <div className="cover-placeholder">{a.locked ? <Lock size={36} strokeWidth={1.2} /> : <Images size={36} strokeWidth={1.2} />}</div>
                )}
                <div className="cover-bottom">
                  <span className="chip chip-glass">
                    <Images size={11} /> {a.count}
                  </span>
                  {a.videos > 0 && (
                    <span className="chip chip-glass">
                      <Clapperboard size={11} /> {a.videos}
                    </span>
                  )}
                  {a.locked && (
                    <span className="chip chip-glass">
                      <Lock size={11} /> PIN
                    </span>
                  )}
                </div>
              </div>
              <div className="body">
                <h3>{a.title}</h3>
                {a.description && <p className="muted small">{a.description}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

/** The blurred snapshot of the album page behind a PIN prompt. */
function PinWall({ token, albumSlug, title, description, snapshotUrl }: { token: string; albumSlug?: string; title: string; description: string; snapshotUrl: string | null }) {
  const qc = useQueryClient()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [bgOk, setBgOk] = useState(true)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await api.post(`/api/share/${token}/unlock`, { pin, album: albumSlug })
      await qc.invalidateQueries({ queryKey: keys.share(token) })
    } catch (ex) {
      setErr((ex as Error).message)
      setPin('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pin-wall" data-pin-wall="">
      {snapshotUrl && bgOk ? <img className="pin-wall-bg" src={snapshotUrl} alt="" aria-hidden onError={() => setBgOk(false)} data-pin-snapshot="" /> : <div className="pin-wall-fallback" />}
      <div className="pin-wall-shade" />
      <form className="pin-card" onSubmit={submit}>
        <div className="eyebrow">
          <Lock size={11} /> Private album
        </div>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {description && <p className="muted small" style={{ margin: 0 }}>{description}</p>}
        <p className="muted small" style={{ margin: 0 }}>Enter the PIN you were given to open this album.</p>
        <input className="input pin-input" inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} autoComplete="one-time-code" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" aria-label="PIN" autoFocus required data-pin-input="" />
        {err && <div className="dev-session-chip warn" data-pin-error="">{err}</div>}
        <button className="btn primary lg" disabled={busy || pin.length < 4} data-pin-submit="">
          <KeyRound size={14} /> {busy ? 'Checking…' : 'Open album'}
        </button>
      </form>
    </div>
  )
}
