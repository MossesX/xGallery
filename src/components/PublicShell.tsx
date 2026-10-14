import type { ReactNode } from 'react'
import { Banner, Footer } from './Banner'
import { Toast } from './Toast'

/** Chrome for login-free pages: the same AmberX banner, with sign-in instead of the account controls. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <Banner />
      {children}
      <Footer />
      <Toast />
    </div>
  )
}
