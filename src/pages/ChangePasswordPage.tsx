import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { api } from '../api/client'
import { keys, useMe } from '../api/hooks'
import type { User } from '../api/types'
import { PublicShell } from '../components/PublicShell'
import { useUI } from '../store/ui'

/** Shown until a member whose password must be changed picks a new one. */
export function ChangePasswordPage() {
  const { data: user } = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const notify = useUI((s) => s.notify)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const change = useMutation({
    mutationFn: () => {
      if (next !== confirm) throw new Error('The two new passwords do not match')
      return api.post('/api/auth/password', { current, next })
    },
    onSuccess: async () => {
      const me = await api.get<{ user: User | null }>('/api/auth/me')
      qc.setQueryData(keys.me, me.user)
      qc.invalidateQueries({ queryKey: ['session'] })
      notify('Password changed. Welcome!', 'success')
      navigate('/', { replace: true })
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  return (
    <PublicShell>
      <main className="page narrow">
        <form className="login-card request-card" onSubmit={(e: FormEvent) => { e.preventDefault(); change.mutate() }}>
          <div className="stack" style={{ gap: 12 }}>
            <div>
              <div className="eyebrow">
                <KeyRound size={11} /> First sign-in
              </div>
              <h1 style={{ margin: 0 }}>Choose your own password</h1>
              <p className="muted" style={{ margin: '6px 0 0' }}>
                {user ? `Hi ${user.display_name.split(' ')[0]}. ` : ''}The password you were given is temporary. Pick a new one to continue.
              </p>
            </div>
            <div className="field">
              <label htmlFor="cp-current">Temporary password</label>
              <input id="cp-current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus required />
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="field grow">
                <label htmlFor="cp-next">New password</label>
                <input id="cp-next" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
              </div>
              <div className="field grow">
                <label htmlFor="cp-confirm">Confirm</label>
                <input id="cp-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
            </div>
            <button className="btn primary lg" disabled={change.isPending || !current || !next || !confirm}>
              Save password and continue
            </button>
          </div>
        </form>
      </main>
    </PublicShell>
  )
}
