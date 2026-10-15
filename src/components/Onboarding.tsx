import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Camera, Check, FolderPlus, Images, Sparkles, Upload } from 'lucide-react'
import { api, uploadRaw } from '../api/client'
import { keys } from '../api/hooks'
import type { MediaItem, User } from '../api/types'
import { useUI } from '../store/ui'
import { Modal } from './Modal'
import { Uploader } from './Uploader'

/**
 * First-sign-in onboarding, shown right after a member picks their own password:
 *   1. a profile picture (tabs of ready-made avatars, or an upload),
 *   2. "create your public album now?" → a small wizard (details → photos → done), or just close.
 */

const COLORS = ['#ff7a1a', '#2563eb', '#16a34a', '#db2777', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626', '#0f766e', '#9333ea', '#ea580c', '#475569']
const SETS: { id: string; label: string; items: string[] }[] = [
  { id: 'faces', label: 'Faces', items: ['😀', '😎', '🤓', '🥳', '😇', '🤠', '🧐', '🤩', '😊', '🙃', '😺', '🤖'] },
  { id: 'animals', label: 'Animals', items: ['🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦉', '🐺', '🦄', '🐧', '🦋'] },
  { id: 'nature', label: 'Nature', items: ['🌵', '🌻', '🌙', '⭐', '🔥', '🌊', '🍀', '🌈', '🍄', '🌸', '🍁', '❄️'] },
  { id: 'fun', label: 'Hobbies', items: ['🎸', '🎨', '📷', '🚀', '🎲', '🏄', '⚽', '🎧', '🍕', '🧩', '🎯', '🛹'] },
]

const initialsOf = (name: string) => name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'

/** Draw an avatar tile to a 256px PNG (what gets uploaded). */
function renderAvatar(kind: 'emoji' | 'initials', text: string, color: string): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(128, 128, 128, 0, Math.PI * 2)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (kind === 'emoji') {
    ctx.font = '150px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
    ctx.fillText(text, 128, 140)
  } else {
    ctx.fillStyle = '#fff'
    ctx.font = '700 112px Sora, Inter, system-ui, sans-serif'
    ctx.fillText(text, 128, 132)
  }
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the picture'))), 'image/png'))
}

type Pick = { kind: 'emoji' | 'initials'; text: string; color: string }

export function OnboardingDialog({ user, onDone }: { user: User; onDone: (to?: string) => void }) {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const canAvatar = user.perms.canChangeProfile
  const canAlbum = user.perms.canUpload
  const [step, setStep] = useState<'avatar' | 'ask' | 'wizard'>(canAvatar ? 'avatar' : 'ask')
  useEffect(() => {
    if (!canAvatar && !canAlbum) onDone()
  }, [canAvatar, canAlbum, onDone])
  if (!canAvatar && !canAlbum) return null
  const next = () => (canAlbum ? setStep('ask') : onDone())
  return (
    <>
      {step === 'avatar' && <AvatarStep user={user} onSkip={next} onSaved={(u) => { qc.setQueryData(keys.me, u); notify('Profile picture saved', 'success'); next() }} />}
      {step === 'ask' && (
        <Modal open onClose={() => onDone()} title="Create your public album?">
          <div className="stack" style={{ gap: 12 }} data-onboard-ask="">
            <p className="muted" style={{ margin: 0 }}>
              Your public album is the one visitors see without signing in: the front window of your gallery. You can create it now in three quick steps, or later from My albums.
            </p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => onDone()} data-onboard-no="">
                Not now
              </button>
              <button className="btn primary" onClick={() => setStep('wizard')} data-onboard-yes="">
                <FolderPlus size={14} /> Yes, create it
              </button>
            </div>
          </div>
        </Modal>
      )}
      {step === 'wizard' && <AlbumWizard user={user} onDone={onDone} />}
    </>
  )
}

function AvatarStep({ user, onSkip, onSaved }: { user: User; onSkip: () => void; onSaved: (u: User) => void }) {
  const notify = useUI((s) => s.notify)
  const [tab, setTab] = useState<string>(SETS[0].id)
  const [pick, setPick] = useState<Pick | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const initials = initialsOf(user.display_name)
  const choose = (f: File | null) => {
    setFile(f)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(f ? URL.createObjectURL(f) : '')
  }
  const save = async () => {
    setBusy(true)
    try {
      const blob = file ?? (pick ? await renderAvatar(pick.kind, pick.text, pick.color) : null)
      if (!blob) return
      const r = (await uploadRaw('/api/social/avatar', blob, file ? file.type : 'image/png', { fileName: file ? file.name : 'avatar.png' })) as { user: User }
      onSaved(r.user)
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const tiles = tab === 'initials' ? COLORS.map((color) => ({ kind: 'initials' as const, text: initials, color })) : (SETS.find((s) => s.id === tab)?.items ?? []).map((text, i) => ({ kind: 'emoji' as const, text, color: COLORS[i % COLORS.length] }))
  return (
    <Modal open onClose={onSkip} title="Pick a profile picture" wide>
      <div className="stack" style={{ gap: 12 }} data-onboard-avatar="">
        <p className="muted" style={{ margin: 0 }}>Choose one from a collection or upload your own photo. You can change it any time from your profile.</p>
        <div className="segmented onboard-tabs" role="tablist">
          {[...SETS.map((s) => ({ id: s.id, label: s.label })), { id: 'initials', label: 'Initials' }, { id: 'upload', label: 'Upload' }].map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} data-avatar-tab={t.id}>
              {t.id === 'upload' && <Upload size={12} />} {t.label}
            </button>
          ))}
        </div>
        {tab === 'upload' ? (
          <div className="onboard-upload" onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()} data-avatar-upload="">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { setPick(null); choose(e.target.files?.[0] ?? null) }} />
            {preview ? <img src={preview} alt="" className="onboard-preview" /> : <Camera size={28} />}
            <span className="muted small">{file ? file.name : 'Click to choose a JPEG, PNG, WebP or GIF (under 6 MB)'}</span>
          </div>
        ) : (
          <div className="avatar-grid" role="listbox">
            {tiles.map((t, i) => {
              const selected = pick && pick.kind === t.kind && pick.text === t.text && pick.color === t.color
              return (
                <button key={`${t.text}${i}`} role="option" aria-selected={!!selected} className={`avatar-tile ${selected ? 'selected' : ''}`} style={{ background: t.color, color: '#fff' }} onClick={() => { setPick(t); choose(null) }} title={t.kind === 'emoji' ? t.text : initials} data-avatar-tile={`${t.kind}:${t.text}`}>
                  <span className={t.kind === 'emoji' ? 'avatar-emoji' : 'avatar-initials'}>{t.text}</span>
                  {selected && (
                    <span className="avatar-check">
                      <Check size={14} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onSkip} data-onboard-skip="">
            Skip for now
          </button>
          <button className="btn primary" onClick={save} disabled={busy || (!pick && !file)} data-onboard-save-avatar="">
            {busy ? 'Saving…' : 'Use this picture'} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </Modal>
  )
}

interface NewAlbum { id: number; slug: string; title: string; visibility: string }

function AlbumWizard({ user, onDone }: { user: User; onDone: (to?: string) => void }) {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const [stage, setStage] = useState<'details' | 'photos' | 'done'>('details')
  const [title, setTitle] = useState(`${user.display_name.split(' ')[0]}'s album`)
  const [description, setDescription] = useState('')
  const [makePublic, setMakePublic] = useState(user.perms.canPublish)
  const [album, setAlbum] = useState<NewAlbum | null>(null)
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ album: NewAlbum }>('/api/albums', { title: title.trim(), description: description.trim(), makePublic })
      setAlbum(r.album)
      qc.invalidateQueries({ queryKey: ['albums'] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      setStage('photos')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const finish = (open: boolean) => {
    qc.invalidateQueries({ queryKey: ['albums'] })
    onDone(open && album ? `/me/albums/${album.id}` : undefined)
  }
  const steps = ['Details', 'Photos', 'Done']
  const idx = stage === 'details' ? 0 : stage === 'photos' ? 1 : 2
  return (
    <Modal open onClose={() => finish(false)} title="Your public album" wide>
      <div className="stack" style={{ gap: 12 }} data-onboard-wizard={stage}>
        <ol className="onboard-steps">
          {steps.map((s, i) => (
            <li key={s} className={i === idx ? 'active' : i < idx ? 'done' : ''}>
              <span>{i < idx ? <Check size={12} /> : i + 1}</span> {s}
            </li>
          ))}
        </ol>
        {stage === 'details' && (
          <>
            <div className="field">
              <label htmlFor="ob-title">Album title</label>
              <input id="ob-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="ob-desc">Description (optional)</label>
              <textarea id="ob-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What is this album about?" />
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={makePublic} onChange={(e) => setMakePublic(e.target.checked)} disabled={!user.perms.canPublish} />
              <span>
                Make it my public album (visible without signing in){!user.perms.canPublish && <span className="muted small"> · your account cannot publish yet; it will be created as a draft</span>}
              </span>
            </label>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => finish(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={create} disabled={busy || !title.trim()} data-onboard-create="">
                {busy ? 'Creating…' : 'Create and add photos'} <ArrowRight size={14} />
              </button>
            </div>
          </>
        )}
        {stage === 'photos' && album && (
          <>
            <p className="muted" style={{ margin: 0 }}>
              <strong>{album.title}</strong> is ready{album.visibility === 'public' ? ' and public' : ' as a draft'}. Drop some photos or videos in now, or skip and add them later.
            </p>
            <Uploader albumId={album.id} onUploaded={(_m: MediaItem) => setCount((c) => c + 1)} />
            <div className="row between">
              <span className="muted small">{count ? `${count} item${count === 1 ? '' : 's'} uploaded` : 'Nothing uploaded yet'}</span>
              <button className="btn primary" onClick={() => setStage('done')} data-onboard-photos-next="">
                {count ? 'Continue' : 'Skip photos'} <ArrowRight size={14} />
              </button>
            </div>
          </>
        )}
        {stage === 'done' && album && (
          <>
            <div className="stack" style={{ alignItems: 'center', gap: 8, padding: '12px 0' }}>
              <Sparkles size={32} />
              <h3 style={{ margin: 0 }}>All set!</h3>
              <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
                {album.visibility === 'public' ? `${album.title} is now your public album with ${count} item${count === 1 ? '' : 's'}. Visitors see it on the front page of your gallery.` : `${album.title} was created as a draft with ${count} item${count === 1 ? '' : 's'}. Publish it from the album editor when you are ready.`}
              </p>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => finish(false)} data-onboard-finish="">
                Go to my home
              </button>
              <button className="btn primary" onClick={() => finish(true)} data-onboard-open-album="">
                <Images size={14} /> Open the album
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
