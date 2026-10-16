import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useLogin, useMe, useSettings } from '../api/hooks'
import { useUiConfig } from '../ui/config'
import { PublicShell } from '../components/PublicShell'
import { useUI } from '../store/ui'
import { AmberMark } from '../brand/Logo'
import { OwnerRecoveryDialog } from '../components/OwnerRecoveryDialog'

export function LoginPage() {
  const { data: user, isLoading } = useMe()
  const { data } = useSettings()
  const ui = useUiConfig()
  const login = useLogin()
  const sessionEnded = useUI((s) => s.sessionEnded)
  const setSessionEnded = useUI((s) => s.setSessionEnded)
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [recovering, setRecovering] = useState(false)
  const from = (location.state as { from?: string } | null)?.from ?? (data?.panel?.mode ? '/dev' : '/')
  const closed = (location.state as { reason?: string } | null)?.reason === 'closed'

  if (isLoading) return null
  if (user) return <Navigate to={from} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // Username "password" + password "reset" opens owner recovery instead of signing in.
    if (username.trim().toLowerCase() === 'password' && password === 'reset') {
      setPassword('')
      setRecovering(true)
      return
    }
    try {
      await login.mutateAsync({ username, password })
      setSessionEnded(false)
      navigate(from, { replace: true })
    } catch {
      /* error shown below */
    }
  }

  return (
    <PublicShell>
      <main className="page login-page">
        <form className="card pad-lg stack login-card" onSubmit={submit} style={{ gap: 'calc(var(--space) * 2)' }}>
          <div className="row" style={{ gap: 12 }}>
            <AmberMark size={40} accent="#ff7a1a" />
            <div>
              <div className="eyebrow">{data?.settings.brandName ?? 'AmberX'} members</div>
              <h2 style={{ margin: 0 }}>Sign in</h2>
            </div>
          </div>
          {closed && !login.error && <div className="error" data-browsing-closed="">Public browsing is switched off, so visitors must sign in. Owner: turn it back on in Owner console → Policies → Site switches → "Visitors may browse public albums without signing in".</div>}
          {sessionEnded && !login.error && <div className="error" data-session-ended="">Your session has ended (signed out elsewhere, a password reset, or it expired). Sign in again to continue where you were.</div>}
          {login.error && <div className="error">{login.error.message}</div>}
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" className="input" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn primary lg" disabled={login.isPending || !username || !password}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="muted small" style={{ margin: 0 }}>
            No account? {data?.policy?.acceptRequests === false ? 'The owner is not taking requests right now.' : <><Link to="/request-account">Request one from the owner</Link>{data?.policy?.publicBrowsing === false ? '' : <>, or <Link to="/">browse public albums</Link></>}.</>} {ui.flags.forgotPassword !== false && <Link to="/forgot-password">Forgot your password?</Link>}
          </p>
        </form>
        {recovering && <OwnerRecoveryDialog onClose={() => setRecovering(false)} />}
      </main>
    </PublicShell>
  )
}
