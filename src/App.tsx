import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type React from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { ThemeProvider } from './components/ThemeProvider'
import { AppShell } from './components/AppShell'
import { RequireAuth } from './components/RequireAuth'
import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { AlbumPage } from './pages/AlbumPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { SharePage } from './pages/SharePage'
import { GalleryPage } from './pages/GalleryPage'
import { PublicAlbumPage, PublicDirectoryPage, PublicGalleryPage } from './pages/PublicGalleryPage'
import { GalleriesPage } from './pages/GalleriesPage'
import { PublicHomePage } from './pages/PublicHomePage'
import { useMe, useSettings } from './api/hooks'
import { DevLayout } from './pages/dev/DevLayout'
import { DevOverviewPage } from './pages/dev/DevOverviewPage'
import { DevAssistantPage } from './pages/dev/DevAssistantPage'
import { DevCodePage } from './pages/dev/DevCodePage'
import { DevRestorePage } from './pages/dev/DevRestorePage'
import { DevSessionsPage } from './pages/dev/DevSessionsPage'
import { DevSettingsPage } from './pages/dev/DevSettingsPage'
import { DevContextMenuPage, DevCssPage, DevFeaturesPage, DevFooterPage, DevHomePage, DevLayoutPage, DevNavigationPage, DevToolbarPage } from './pages/dev/DevDesignPages'
import { PageLoader } from './components/Skeleton'
import { GallerySettingsPage } from './pages/admin/GallerySettingsPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { DashboardPage } from './pages/admin/DashboardPage'
import { UsersPage } from './pages/admin/UsersPage'
import { AlbumsPage } from './pages/admin/AlbumsPage'
import { AlbumEditorPage } from './pages/admin/AlbumEditorPage'
import { ThemesPage } from './pages/admin/ThemesPage'
import { AppearancePage } from './pages/admin/AppearancePage'
import { ApiError } from './api/client'
import { MeLayout } from './pages/me/MeLayout'
import { ProfilePage } from './pages/me/ProfilePage'
import { BuddiesPage } from './pages/me/BuddiesPage'
import { MessagesPage } from './pages/me/MessagesPage'
import { AssistantSettingsPage } from './pages/admin/AssistantSettingsPage'
import { InboxPage } from './pages/admin/InboxPage'
import { ActivityPage } from './pages/admin/ActivityPage'
import { RequestAccountPage } from './pages/RequestAccountPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { PhotosPage } from './pages/PhotosPage'
import { NotificationsPage } from './pages/me/NotificationsPage'
import { MyGalleriesPage } from './pages/me/MyGalleriesPage'
import { NotificationsAdminPage } from './pages/admin/NotificationsAdminPage'
import { NewAlbumsPage } from './pages/admin/NewAlbumsPage'
import { GalleryTreePage } from './pages/admin/GalleryTreePage'
import { PoliciesPage } from './pages/admin/PoliciesPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
})

function AlbumEditorRedirect() {
  const { id } = useParams()
  return <Navigate to={`/me/albums/${id}`} replace />
}

/** The root: anonymous visitors browse public albums; members get their home. */
/** When the owner closes public browsing, visitors are sent to sign in instead of the public pages. */
function BrowsingGate({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useMe()
  const { data: site, isLoading: siteLoading } = useSettings()
  if (isLoading || siteLoading) return <PageLoader />
  if (!user && site?.policy && !site.policy.publicBrowsing) return <Navigate to="/login" replace />
  return <>{children}</>
}

function Root() {
  const { data: user, isLoading } = useMe()
  const { data: site, isLoading: siteLoading } = useSettings()
  if (isLoading || siteLoading) return <PageLoader />
  if (!user && site?.policy && !site.policy.publicBrowsing) return <Navigate to="/login" replace />
  if (!user) return <PublicHomePage />
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />
  return (
    <AppShell>
      <HomePage />
    </AppShell>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Root />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/request-account" element={<RequestAccountPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="/contact" element={<RequestAccountPage />} />
            <Route path="/s/:token" element={<SharePage />} />
            <Route path="/public" element={<BrowsingGate><PublicDirectoryPage /></BrowsingGate>} />
            <Route path="/public/:slug" element={<BrowsingGate><PublicGalleryPage /></BrowsingGate>} />
            <Route path="/public/:slug/:album" element={<BrowsingGate><PublicAlbumPage /></BrowsingGate>} />
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route path="/album/:slug" element={<AlbumPage />} />
                <Route path="/g/:slug" element={<GalleryPage />} />
                <Route path="/galleries" element={<GalleriesPage />} />
                <Route path="/photos" element={<PhotosPage />} />
                <Route path="/favorites" element={<FavoritesPage />} />
                <Route path="/account" element={<Navigate to="/me" replace />} />
                <Route path="/me" element={<MeLayout />}>
                  <Route index element={<ProfilePage />} />
                  <Route path="gallery" element={<GallerySettingsPage />} />
                  <Route path="albums" element={<AlbumsPage />} />
                  <Route path="albums/:id" element={<AlbumEditorPage />} />
                  <Route path="buddies" element={<BuddiesPage />} />
                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route path="galleries" element={<MyGalleriesPage />} />
                  <Route path="messages" element={<MessagesPage />} />
                  <Route path="messages/:id" element={<MessagesPage />} />
                </Route>
                <Route path="/dev" element={<DevLayout />}>
                  <Route index element={<DevOverviewPage />} />
                  <Route path="assistant" element={<DevAssistantPage />} />
                  <Route path="code" element={<DevCodePage />} />
                  <Route path="restore" element={<DevRestorePage />} />
                  <Route path="sessions" element={<DevSessionsPage />} />
                  <Route path="settings" element={<DevSettingsPage />} />
                  <Route path="themes" element={<ThemesPage />} />
                  <Route path="appearance" element={<AppearancePage />} />
                  <Route path="navigation" element={<DevNavigationPage />} />
                  <Route path="toolbar" element={<DevToolbarPage />} />
                  <Route path="footer" element={<DevFooterPage />} />
                  <Route path="home" element={<DevHomePage />} />
                  <Route path="context-menu" element={<DevContextMenuPage />} />
                  <Route path="layout" element={<DevLayoutPage />} />
                  <Route path="css" element={<DevCssPage />} />
                  <Route path="features" element={<DevFeaturesPage />} />
                </Route>
                <Route element={<RequireAuth role="admin" />}>
                  <Route path="/admin" element={<AdminLayout />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="gallery" element={<Navigate to="/me/gallery" replace />} />
                    <Route path="users" element={<UsersPage />} />
                    <Route path="albums" element={<Navigate to="/me/albums" replace />} />
                    <Route path="albums/:id" element={<AlbumEditorRedirect />} />
                    <Route path="themes" element={<Navigate to="/dev/themes" replace />} />
                    <Route path="appearance" element={<Navigate to="/dev/appearance" replace />} />
                    <Route element={<RequireAuth role="owner" />}>
                      <Route path="assistant" element={<AssistantSettingsPage />} />
                      <Route path="inbox" element={<InboxPage />} />
                      <Route path="activity" element={<ActivityPage />} />
                      <Route path="notifications" element={<NotificationsAdminPage />} />
                      <Route path="new-albums" element={<NewAlbumsPage />} />
                      <Route path="tree" element={<GalleryTreePage />} />
                      <Route path="policies" element={<PoliciesPage />} />
                    </Route>
                  </Route>
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
