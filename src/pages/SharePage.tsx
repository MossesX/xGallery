import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock } from 'lucide-react'
import { api } from '../api/client'
import { keys, useSettings, useShare } from '../api/hooks'
import { MediaLayout } from '../components/MediaLayout'
import { Lightbox } from '../components/Lightbox'
import { PageLoader } from '../components/Skeleton'
import { PublicShell } from '../components/PublicShell'

/** Login-free view of an album through its share token; shared private albums ask for their PIN first. */
export function SharePage() {
  const { token } = useParams()
  const { data: site } = useSettings()
  const { data, isLoading, error } = useShare(token)
  const [open, setOpen] = useState<number | null>(null)

  if (isLoading || !site) return <PageLoader />

  const layout = data?.album.layoutOverride ?? site.settings.defaultLayout

  return (
    <PublicShell>
      <main className="page">
        {error || !data ? (
          <div className="empty">
            <p>This share link is not valid or has been turned off.</p>
          </div>
        ) : data.locked ? (
          <PinWall token={token!} title={data.album.title} description={data.album.description} snapshotUrl={data.snapshotUrl ?? null} />
        ) : (
          <>
            <header className="album-header">
              <div className="eyebrow">Shared gallery</div>
              <h1>{data.album.title}</h1>
              {data.album.description && <p className="muted lead" style={{ maxWidth: 720 }}>{data.album.description}</p>}
            </header>
            <MediaLayout items={data.media} layout={{ ...layout, showLikes: false }} onOpen={setOpen} />
            {open != null && (
              <Lightbox items={data.media} index={open} onClose={() => setOpen(null)} onNavigate={setOpen} allowComments={false} allowLikes={false} allowDownloads={site.settings.allowDownloads} readOnly />
            )}
          </>
        )}
      </main>
    </PublicShell>
  )
}

/** The blurred snapshot of the album page behind a PIN prompt. */
function PinWall({ token, title, description, snapshotUrl }: { token: string; title: string; description: string; snapshotUrl: string | null }) {
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
      await api.post(`/api/share/${token}/unlock`, { pin })
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
