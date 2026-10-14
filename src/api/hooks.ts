import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Album, BuddyLists, Comment, Conversation, Gallery, MediaItem, Message, Person, PublicFeed, SiteSettings, Stats, Theme, ThemeDraft, Unread, User } from './types'

export const keys = {
  me: ['me'] as const,
  settings: ['settings'] as const,
  albums: (params: Record<string, string | undefined>) => ['albums', params] as const,
  album: (key: string) => ['album', key] as const,
  favorites: ['favorites'] as const,
  themes: ['themes'] as const,
  users: ['users'] as const,
  stats: ['stats'] as const,
  mediaComments: (id: number) => ['media-comments', id] as const,
  share: (token: string) => ['share', token] as const,
  galleries: ['galleries'] as const,
  gallery: (key: string) => ['gallery', key] as const,
  publicGallery: (slug: string) => ['public-gallery', slug] as const,
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<{ user: User | null }>('/api/auth/me').then((r) => r.user), staleTime: 60_000 })
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.get<{ settings: SiteSettings; theme: Theme | null }>('/api/settings'), staleTime: 60_000 })
}

export function useAlbums(params: { q?: string; tag?: string; sort?: string; gallery?: string; mine?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString()
  return useQuery({
    queryKey: keys.albums(params),
    queryFn: () => api.get<{ albums: Album[]; tags: { name: string; count: number }[] }>(`/api/albums${qs ? `?${qs}` : ''}`),
    placeholderData: (prev) => prev,
  })
}

export function useAlbum(key: string | undefined) {
  return useQuery({
    queryKey: keys.album(key ?? ''),
    queryFn: () => api.get<{ album: Album; media: MediaItem[]; comments: Comment[]; canManage: boolean }>(`/api/albums/${encodeURIComponent(key ?? '')}`),
    enabled: !!key,
  })
}

export function useFavorites() {
  return useQuery({ queryKey: keys.favorites, queryFn: () => api.get<{ albums: Album[] }>('/api/albums/favorites').then((r) => r.albums) })
}

export function useThemes() {
  return useQuery({ queryKey: keys.themes, queryFn: () => api.get<{ themes: Theme[] }>('/api/themes').then((r) => r.themes) })
}

export function useUsers(enabled = true) {
  return useQuery({ queryKey: keys.users, queryFn: () => api.get<{ users: User[] }>('/api/users').then((r) => r.users), enabled })
}

/* ---------- social ---------- */

export function usePeople(q = '', enabled = true) {
  return useQuery({ queryKey: ['people', q], queryFn: () => api.get<{ people: Person[] }>(`/api/social/people${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => r.people), enabled, placeholderData: (prev) => prev })
}

export function usePerson(id: number | null | undefined) {
  return useQuery({ queryKey: ['person', id], queryFn: () => api.get<{ person: Person }>(`/api/social/people/${id}`).then((r) => r.person), enabled: id != null })
}

export function useBuddies(enabled = true) {
  return useQuery({ queryKey: ['buddies'], queryFn: () => api.get<BuddyLists>('/api/social/buddies'), enabled })
}

export function useBuddyAction() {
  const qc = useQueryClient()
  const done = () => {
    qc.invalidateQueries({ queryKey: ['buddies'] })
    qc.invalidateQueries({ queryKey: ['people'] })
    qc.invalidateQueries({ queryKey: ['person'] })
    qc.invalidateQueries({ queryKey: ['unread'] })
    qc.invalidateQueries({ queryKey: ['albums'] })
    qc.invalidateQueries({ queryKey: ['galleries'] })
  }
  return useMutation({
    mutationFn: (v: { id: number; action: 'request' | 'accept' | 'remove' }) =>
      v.action === 'request' ? api.post<{ person: Person }>(`/api/social/buddies/${v.id}`, {}) : v.action === 'accept' ? api.put<{ person: Person }>(`/api/social/buddies/${v.id}/accept`, {}) : api.del<{ person: Person | null }>(`/api/social/buddies/${v.id}`),
    onSuccess: done,
  })
}

export function useConversations(enabled = true) {
  return useQuery({ queryKey: ['conversations'], queryFn: () => api.get<{ conversations: Conversation[] }>('/api/social/messages').then((r) => r.conversations), enabled, refetchInterval: 15_000 })
}

export function useThread(id: number | null | undefined) {
  return useQuery({ queryKey: ['thread', id], queryFn: () => api.get<{ person: Person; messages: Message[] }>(`/api/social/messages/${id}`), enabled: id != null, refetchInterval: 5_000 })
}

export function useSendMessage(id: number | null | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => api.post<{ message: Message }>(`/api/social/messages/${id}`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread', id] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

export function useUnread(enabled = true) {
  return useQuery({ queryKey: ['unread'], queryFn: () => api.get<Unread>('/api/social/unread'), enabled, refetchInterval: 20_000 })
}

export function useStats() {
  return useQuery({ queryKey: keys.stats, queryFn: () => api.get<Stats>('/api/settings/stats') })
}

export function useGalleries() {
  return useQuery({ queryKey: keys.galleries, queryFn: () => api.get<{ galleries: Gallery[] }>('/api/galleries').then((r) => r.galleries) })
}

export function useGallery(key: string | undefined) {
  return useQuery({
    queryKey: keys.gallery(key ?? ''),
    queryFn: () => api.get<{ gallery: Gallery; albums: Album[]; canManage: boolean; theme: Theme | null }>(`/api/galleries/${encodeURIComponent(key ?? '')}`),
    enabled: !!key,
  })
}

export function usePublicGallery(slug: string | undefined) {
  return useQuery({
    queryKey: keys.publicGallery(slug ?? ''),
    queryFn: () => api.get<{ gallery: Gallery; album: Album | null; albums: Album[]; media: MediaItem[]; theme: Theme | null }>(`/api/public/galleries/${encodeURIComponent(slug ?? '')}`),
    enabled: !!slug,
  })
}

export function usePublicFeed(params: { sort?: string; q?: string; tag?: string } = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString()
  return useQuery({ queryKey: ['public-feed', params], queryFn: () => api.get<PublicFeed>(`/api/public/feed${qs ? `?${qs}` : ''}`), placeholderData: (prev) => prev })
}

export function usePublicGalleries() {
  return useQuery({ queryKey: ['public-galleries'], queryFn: () => api.get<{ galleries: Gallery[] }>('/api/public/galleries').then((r) => r.galleries) })
}

export function usePublicAlbum(slug: string | undefined, album: string | undefined) {
  return useQuery({
    queryKey: ['public-album', slug ?? '', album ?? ''],
    queryFn: () => api.get<{ gallery: Gallery; album: Album; media: MediaItem[]; theme: Theme | null }>(`/api/public/galleries/${encodeURIComponent(slug ?? '')}/albums/${encodeURIComponent(album ?? '')}`),
    enabled: !!slug && !!album,
  })
}

export function useShare(token: string | undefined) {
  return useQuery({ queryKey: keys.share(token ?? ''), queryFn: () => api.get<{ album: Album; media: MediaItem[] }>(`/api/share/${token}`), enabled: !!token })
}

/** Invalidate everything that depends on gallery content. */
export function useInvalidate() {
  const qc = useQueryClient()
  return (...prefixes: string[]) => {
    for (const p of prefixes) qc.invalidateQueries({ queryKey: [p] })
  }
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { username: string; password: string }) => api.post<{ user: User }>('/api/auth/login', v),
    onSuccess: (r) => qc.setQueryData(keys.me, r.user),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: () => {
      qc.setQueryData(keys.me, null)
      qc.clear()
    },
  })
}

export function useToggleLike() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mediaId: number) => api.post<{ media: MediaItem }>(`/api/media/${mediaId}/like`).then((r) => r.media),
    onSuccess: (media) => {
      qc.setQueriesData<{ album: Album; media: MediaItem[]; comments: Comment[]; canManage: boolean }>({ queryKey: ['album'] }, (old) =>
        old ? { ...old, media: old.media.map((m) => (m.id === media.id ? media : m)) } : old,
      )
    },
  })
}

export function useToggleFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (albumId: number) => api.post<{ favorited: boolean }>(`/api/albums/${albumId}/favorite`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['albums'] })
      qc.invalidateQueries({ queryKey: ['album'] })
      qc.invalidateQueries({ queryKey: keys.favorites })
      qc.invalidateQueries({ queryKey: ['gallery'] })
    },
  })
}

export function useSaveTheme() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id?: number; draft: ThemeDraft }) => (v.id ? api.put<{ theme: Theme }>(`/api/themes/${v.id}`, v.draft) : api.post<{ theme: Theme }>('/api/themes', v.draft)).then((r) => r.theme),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.themes }),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<SiteSettings>) => api.put<{ settings: SiteSettings }>('/api/settings', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings }),
  })
}
