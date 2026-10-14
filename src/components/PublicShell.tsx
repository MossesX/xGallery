import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useSettings } from '../api/hooks'
import { AmberMark, Wordmark } from '../brand/Logo'
import { ColorModeToggle } from './ColorModeToggle'
import { Toast } from './Toast'

/** Chrome for login-free pages. */
export function PublicShell({ children }: { children: ReactNode }) {
  const { data: site } = useSettings()
  const s = site?.settings
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/public" className="brand">
            <AmberMark size={34} />
            <Wordmark title={s?.siteTitle ?? 'xGallery'} brand={s?.brandName ?? 'AmberX'} />
          </Link>
          <nav className="nav">
            <Link to="/public" className="nav-link">
              Public galleries
            </Link>
            <ColorModeToggle />
            <Link to="/login" className="btn primary sm">
              Member sign in
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="footer">
        <div className="footer-inner">
          <span>
            {s?.siteTitle ?? 'xGallery'} · {s?.tagline}
          </span>
          <span className="muted small">Powered by {s?.brandName ?? 'AmberX'}</span>
        </div>
      </footer>
      <Toast />
    </div>
  )
}
