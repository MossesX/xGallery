import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, ExternalLink, Trash2 } from 'lucide-react'
import { api, uploadRaw } from '../../api/client'
import { keys, useGalleries, useMe } from '../../api/hooks'
import type { User } from '../../api/types'
import { useUI } from '../../store/ui'
import { ColorModeToggle } from '../../components/ColorModeToggle'
import { Avatar } from '../../components/Avatar'

/** Account profile: picture, name, bio, password and device appearance. */
export function ProfilePage() {
  const { data: user } = useMe()
  const { data: galleries } = useGalleries()
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name)
      setBio(user.bio)
    }
  }, [user])

  const invalidateSocial = () => {
    qc.invalidateQueries({ queryKey: ['galleries'] })
    qc.invalidateQueries({ queryKey: ['public-feed'] })
    qc.invalidateQueries({ queryKey: ['people'] })
  }
  const profile = useMutation({
    mutationFn: () => api.put<{ user: User }>('/api/auth/profile', { displayName, bio }),
    onSuccess: (r) => {
      qc.setQueryData(keys.me, r.user)
      invalidateSocial()
      notify('Profile updated', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const removeAvatar = useMutation({
    mutationFn: () => api.del<{ user: User }>('/api/social/avatar'),
    onSuccess: (r) => {
      qc.setQueryData(keys.me, r.user)
      invalidateSocial()
      notify('Picture removed')
    },
  })
  const password = useMutation({
    mutationFn: () => {
      if (next !== confirm) throw new Error('New passwords do not match')
      return api.post('/api/auth/password', { current, next })
    },
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setConfirm('')
      notify('Password changed. Other devices were signed out.', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return notify('Choose an image file', 'error')
    setUploading(true)
    try {
      const r = (await uploadRaw('/api/social/avatar', file, file.type, { fileName: file.name })) as { user: User }
      qc.setQueryData(keys.me, r.user)
      invalidateSocial()
      notify('Profile picture updated', 'success')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!user) return null
  const mine = galleries?.find((g) => g.isMine)

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div className="row between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div className="row" style={{ gap: 18 }}>
          <div className="avatar-edit">
            <Avatar name={user.display_name} size={88} src={user.avatarUrl} />
            <button className="btn icon sm avatar-edit-btn" title="Change picture" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Camera size={14} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
          </div>
          <div>
            <div className="eyebrow">Profile</div>
            <h1 style={{ margin: 0 }}>{user.display_name}</h1>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              @{user.username} · {user.role === 'owner' ? 'Owner' : user.role === 'admin' ? 'Administrator' : 'Member'} · joined {new Date(user.created_at).toLocaleDateString()}
            </p>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Camera size={14} /> {uploading ? 'Uploading…' : user.avatarUrl ? 'Change picture' : 'Add a picture'}
              </button>
              {user.avatarUrl && (
                <button className="btn ghost sm" onClick={() => removeAvatar.mutate()}>
                  <Trash2 size={14} /> Remove
                </button>
              )}
            </div>
          </div>
        </div>
        {mine && (
          <Link to={`/public/${mine.slug}`} className="btn">
            <ExternalLink size={14} /> View my public page
          </Link>
        )}
      </div>

      <div className="two-col">
        <form
          className="card stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            profile.mutate()
          }}
        >
          <h3>About you</h3>
          <div className="field">
            <label>Display name</label>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="field">
            <label>Bio</label>
            <textarea className="textarea" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A line about you, shown on your page" style={{ minHeight: 88 }} />
          </div>
          <div>
            <button className="btn primary" disabled={profile.isPending || !displayName.trim()}>
              Save profile
            </button>
          </div>
        </form>

        <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
          <form
            className="card stack"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              password.mutate()
            }}
          >
            <h3>Password</h3>
            <div className="field">
              <label>Current password</label>
              <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="field grow">
                <label>New password</label>
                <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              </div>
              <div className="field grow">
                <label>Confirm</label>
                <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            </div>
            <div>
              <button className="btn primary" disabled={password.isPending || !current || !next || !confirm}>
                Update password
              </button>
            </div>
          </form>
          <section className="card stack">
            <h3>Appearance on this device</h3>
            <ColorModeToggle labels />
          </section>
        </div>
      </div>
    </div>
  )
}
