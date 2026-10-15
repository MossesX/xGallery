import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useLogin, useMe, useSettings } from '../api/hooks'
import { PublicShell } from '../components/PublicShell'
import { AmberMark } from '../brand/Logo'

export function LoginPage() {
  const { data: user, isLoading } = useMe()
  const { data } = useSettings()
  const login = useLogin()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  if (isLoading) return null
  if (user) return <Navigate to={from} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await login.mutateAsync({ username, password })
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
            No account? <Link to="/request-account">Request one from the owner</Link>, or <Link to="/">browse public albums</Link>. <Link to="/forgot-password">Forgot your password?</Link>
          </p>
        </form>
      </main>
    </PublicShell>
  )
}
