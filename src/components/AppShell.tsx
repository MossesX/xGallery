import { Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Banner, Footer } from './Banner'
import { Toast } from './Toast'
import { AssistantPanel } from './AssistantPanel'
import { ContextMenu } from './ContextMenu'

export function AppShell({ children }: { children?: ReactNode }) {
  return (
    <div className="shell">
      <Banner />
      {children ?? <Outlet />}
      <Footer />
      <Toast />
      <AssistantPanel />
      <ContextMenu />
    </div>
  )
}
