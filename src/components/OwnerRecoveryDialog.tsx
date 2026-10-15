import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, LifeBuoy, X } from 'lucide-react'
import { api } from '../api/client'
import { keys } from '../api/hooks'
import { useUI } from '../store/ui'

/**
 * Owner password recovery, opened from the sign-in page by typing username "password" and password
 * "reset". A recovery key proves it is the owner: the RESET_OWNER_PASSWORD deploy secret, or one of
 * the single-use recovery codes generated in the owner console. On success the owner is signed in.
 */
export function OwnerRecoveryDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const notify = useUI((s) => s.notify)
  const setSessionEnded = useUI((s) => s.setSessionEnded)
  const info = useQuery({ queryKey: ['owner-recovery'], queryFn: () => api.get<{ viaSecret: boolean; codesLeft: number; owner: string | null }>('/api/auth/owner-recovery'), staleTime: 0 })
  const [key, setKey] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const reset = useMutation({
    mutationFn: () => {
      if (pw !== confirm) throw new Error('The two passwords do not match')
      return api.post<{ ok: boolean; via: string; user: { username: string } }>('/api/auth/owner-recovery', { key, password: pw })
    },
    onSuccess: async (r) => {
      setSessionEnded(false)
      await qc.invalidateQueries({ queryKey: keys.me })
      notify(`Owner password reset for @${r.user.username}; you are signed in`, 'success')
      onClose()
      navigate('/admin', { replace: true })
    },
    onError: () => setKey(''),
  })
  const none = info.data && !info.data.viaSecret && info.data.codesLeft === 0
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="owner-recovery-title" data-owner-recovery="">
      <form className="modal card pad-lg stack" style={{ gap: 12, maxWidth: 520 }} onSubmit={(e: FormEvent) => { e.preventDefault(); reset.mutate() }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="eyebrow">
              <LifeBuoy size={11} /> Owner recovery
            </div>
            <h2 id="owner-recovery-title" style={{ margin: 0 }}>Reset the owner password</h2>
          </div>
          <button type="button" className="btn ghost icon sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {info.data?.owner ? <>This resets the password of the owner account <strong>@{info.data.owner}</strong> and signs out every other session.</> : 'This resets the owner password and signs out every other session.'} Prove it is you with a recovery key:
        </p>
        <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            the value of the <span className="mono">RESET_OWNER_PASSWORD</span> repository secret{info.data ? (info.data.viaSecret ? ' (set on this server)' : ' (not set on this server right now)') : ''}, or
          </li>
          <li>
            one of the recovery codes generated in Owner console → Policies{info.data ? ` (${info.data.codesLeft} unused)` : ''}.
          </li>
        </ul>
        {none && <div className="error" data-owner-recovery-none="">No recovery key exists yet. Set the RESET_OWNER_PASSWORD secret on GitHub and deploy, or run the docker command from the README on the server.</div>}
        {reset.error && <div className="error" data-owner-recovery-error="">{(reset.error as Error).message}</div>}
        <div className="field">
          <label htmlFor="rec-key">Recovery key</label>
          <input id="rec-key" className="input mono" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} autoFocus required data-owner-recovery-key="" />
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field grow">
            <label htmlFor="rec-pw">New owner password</label>
            <input id="rec-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} data-owner-recovery-password="" />
          </div>
          <div className="field grow">
            <label htmlFor="rec-confirm">Confirm</label>
            <input id="rec-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required data-owner-recovery-confirm="" />
          </div>
        </div>
        <button className="btn primary lg" disabled={reset.isPending || !key || pw.length < 8 || !confirm} data-owner-recovery-submit="">
          <KeyRound size={15} /> {reset.isPending ? 'Resetting…' : 'Reset password and sign in'}
        </button>
        <p className="muted small" style={{ margin: 0 }}>Every attempt is logged and the owner is notified; five wrong keys block this for 15 minutes.</p>
      </form>
    </div>
  )
}
