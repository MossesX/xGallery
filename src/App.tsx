import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
import { useMe } from './api/hooks'
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
function Root() {
  const { data: user, isLoading } = useMe()
  if (isLoading) return <PageLoader />
  if (!user) return <PublicHomePage />
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
            <Route path="/s/:token" element={<SharePage />} />
            <Route path="/public" element={<PublicDirectoryPage />} />
            <Route path="/public/:slug" element={<PublicGalleryPage />} />
            <Route path="/public/:slug/:album" element={<PublicAlbumPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route path="/album/:slug" element={<AlbumPage />} />
                <Route path="/g/:slug" element={<GalleryPage />} />
                <Route path="/galleries" element={<GalleriesPage />} />
                <Route path="/favorites" element={<FavoritesPage />} />
                <Route path="/account" element={<Navigate to="/me" replace />} />
                <Route path="/me" element={<MeLayout />}>
                  <Route index element={<ProfilePage />} />
                  <Route path="gallery" element={<GallerySettingsPage />} />
                  <Route path="albums" element={<AlbumsPage />} />
                  <Route path="albums/:id" element={<AlbumEditorPage />} />
                  <Route path="buddies" element={<BuddiesPage />} />
                  <Route path="messages" element={<MessagesPage />} />
                  <Route path="messages/:id" element={<MessagesPage />} />
                </Route>
                <Route element={<RequireAuth role="admin" />}>
                  <Route path="/admin" element={<AdminLayout />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="gallery" element={<Navigate to="/me/gallery" replace />} />
                    <Route path="users" element={<UsersPage />} />
                    <Route path="albums" element={<Navigate to="/me/albums" replace />} />
                    <Route path="albums/:id" element={<AlbumEditorRedirect />} />
                    <Route path="themes" element={<ThemesPage />} />
                    <Route path="appearance" element={<AppearancePage />} />
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
