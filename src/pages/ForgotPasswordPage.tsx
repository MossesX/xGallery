import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Check, KeyRound } from 'lucide-react'
import { api } from '../api/client'
import { PublicShell } from '../components/PublicShell'

/** Visitors who lost their password: the owner is alerted and resets it by hand. */
export function ForgotPasswordPage() {
  const [who, setWho] = useState('')
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const req = useMutation({ mutationFn: () => api.post('/api/auth/forgot', { username: who, message }), onSuccess: () => setSent(true) })
  return (
    <PublicShell>
      <main className="page narrow">
        <div className="login-card request-card">
          {sent ? (
            <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 10 }}>
              <span className="avatar" style={{ width: 56, height: 56, background: 'var(--c-success)', color: '#fff' }}>
                <Check size={26} />
              </span>
              <h2 style={{ margin: 0 }}>The owner has been alerted</h2>
              <p className="muted">They will reset your password and reach you with a new one.</p>
              <Link to="/login" className="btn primary">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form className="stack" style={{ gap: 12 }} onSubmit={(e: FormEvent) => { e.preventDefault(); req.mutate() }}>
              <div>
                <div className="eyebrow">
                  <KeyRound size={11} /> Forgot password
                </div>
                <h1 style={{ margin: 0 }}>Ask the owner for a reset</h1>
                <p className="muted" style={{ margin: '6px 0 0' }}>Passwords are reset by the site owner personally. Tell them who you are and they will send you a new one.</p>
              </div>
              {req.error && <div className="error">{(req.error as Error).message}</div>}
              <div className="field">
                <label htmlFor="fp-who">Username, email or phone</label>
                <input id="fp-who" className="input" value={who} onChange={(e) => setWho(e.target.value)} autoFocus required />
              </div>
              <div className="field">
                <label htmlFor="fp-msg">Anything to add (optional)</label>
                <textarea id="fp-msg" className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} style={{ minHeight: 70 }} />
              </div>
              <button className="btn primary lg" disabled={req.isPending || !who.trim()}>
                Alert the owner
              </button>
              <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>
                Remembered it? <Link to="/login">Sign in</Link>
              </p>
            </form>
          )}
        </div>
      </main>
    </PublicShell>
  )
}
