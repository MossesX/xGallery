import { Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Banner, Footer } from './Banner'
import { Toast } from './Toast'
import { AssistantPanel } from './AssistantPanel'
import { ContextMenu } from './ContextMenu'
import { DesignMode } from './DesignMode'
import { CustomStyles } from '../ui/config'

export function AppShell({ children }: { children?: ReactNode }) {
  return (
    <div className="shell">
      <Banner />
      {children ?? <Outlet />}
      <Footer />
      <Toast />
      <AssistantPanel />
      <ContextMenu />
      <DesignMode />
      <CustomStyles />
    </div>
  )
}
