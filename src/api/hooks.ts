import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { ActivityPage, ActivityPartition, AlbumLink, AiConversation, Group, NewAlbumEntry, Notification, SitePolicy, TimelineItem, TreeUser, AiMessage, AiSettingsView, AiStatus, Album, BuddyLists, Comment, Conversation, Gallery, InboxItem, MediaItem, Message, Person, PublicFeed, Session, SiteSettings, Stats, Theme, ThemeDraft, Unread, User, PublicPolicy } from './types'

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

/** The whole /me payload, including whether the owner is signed in as someone else. */
export function useSession(enabled = true) {
  return useQuery({ queryKey: ['session'], queryFn: () => api.get<Session>('/api/auth/me'), enabled, staleTime: 60_000 })
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.get<{ settings: SiteSettings; policy?: PublicPolicy; theme: Theme | null }>('/api/settings'), staleTime: 60_000 })
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

/* ---------- assistant ---------- */

export function useAiStatus(enabled = true) {
  return useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<AiStatus>('/api/ai/status'), enabled, staleTime: 60_000 })
}

export function useAiSettings() {
  return useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<{ settings: AiSettingsView; cliInstalled: boolean; sourceVersion: string }>('/api/ai/settings') })
}

export function useAiConversations(enabled = true) {
  return useQuery({ queryKey: ['ai-conversations'], queryFn: () => api.get<{ conversations: AiConversation[] }>('/api/ai/conversations').then((r) => r.conversations), enabled })
}

export function useAiConversation(id: number | null) {
  return useQuery({ queryKey: ['ai-conversation', id], queryFn: () => api.get<{ conversation: AiConversation; messages: AiMessage[] }>(`/api/ai/conversations/${id}`), enabled: id != null })
}

/* ---------- owner inbox ---------- */

export function useInbox(status = '', enabled = true) {
  return useQuery({ queryKey: ['inbox', status], queryFn: () => api.get<{ items: InboxItem[] }>(`/api/inbox${status ? `?status=${status}` : ''}`).then((r) => r.items), enabled })
}

export function useInboxUnread(enabled = true) {
  return useQuery({ queryKey: ['inbox-unread'], queryFn: () => api.get<{ open: number; unread: number }>('/api/inbox/unread'), enabled, refetchInterval: 30_000 })
}

/* ---------- private links ---------- */

export function useAlbumLinks(albumId: number | null | undefined, enabled = true) {
  return useQuery({ queryKey: ['album-links', albumId], queryFn: () => api.get<{ links: AlbumLink[] }>(`/api/albums/${albumId}/links`).then((r) => r.links), enabled: enabled && albumId != null })
}

/** Mint a new, unique private link for an album and copy it to the clipboard. */
export function useCreateLink() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { albumId: number; label?: string }) => {
      const r = await api.post<{ link: AlbumLink }>(`/api/albums/${v.albumId}/links`, { label: v.label ?? '' })
      const url = `${location.origin}${r.link.url}`
      try {
        await navigator.clipboard.writeText(url)
      } catch {
        /* clipboard may be unavailable */
      }
      return { ...r.link, fullUrl: url }
    },
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['album-links', v.albumId] }),
  })
}

/** Flip an album between public and buddies-and-members. */
export function useTogglePublic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { albumId: number; makePublic: boolean }) => api.put<{ album: Album }>(`/api/albums/${v.albumId}`, { visibility: v.makePublic ? 'public' : 'published' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['album'] })
      qc.invalidateQueries({ queryKey: ['albums'] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      qc.invalidateQueries({ queryKey: ['public-feed'] })
    },
  })
}

/* ---------- activity log (owner) ---------- */

export function useActivity(params: { userId?: number; kind?: string; q?: string; before?: number; limit?: number }, enabled = true) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString()
  return useQuery({ queryKey: ['activity', params], queryFn: () => api.get<ActivityPage>(`/api/activity${qs ? `?${qs}` : ''}`), enabled, placeholderData: (prev) => prev })
}

export function useUserActivity(userId: number | null, enabled = true) {
  return useQuery({ queryKey: ['activity', 'user', userId], queryFn: () => api.get<ActivityPage>(`/api/activity/users/${userId}?limit=60`), enabled: enabled && userId != null })
}

export function useActivityKinds() {
  return useQuery({ queryKey: ['activity', 'kinds'], queryFn: () => api.get<{ kinds: string[] }>('/api/activity/kinds').then((r) => r.kinds) })
}

export function useActivityPartitions() {
  return useQuery({ queryKey: ['activity', 'partitions'], queryFn: () => api.get<{ partitions: ActivityPartition[] }>('/api/activity/partitions').then((r) => r.partitions) })
}

/* ---------- policy + groups (owner) ---------- */

export function usePolicy() {
  return useQuery({ queryKey: ['policy'], queryFn: () => api.get<{ policy: SitePolicy; permKeys: string[]; permLabels: Record<string, string>; limitKeys: string[]; limitLabels: Record<string, string> }>('/api/policy') })
}

export function useGroups(enabled = true) {
  return useQuery({ queryKey: ['groups'], queryFn: () => api.get<{ groups: Group[] }>('/api/policy/groups').then((r) => r.groups), enabled })
}

/* ---------- notifications ---------- */

export function useNotifUnread(enabled = true) {
  return useQuery({ queryKey: ['notif-unread'], queryFn: () => api.get<{ unread: number; admin: { total: number; albums: number; requests: number; security: number } | null }>('/api/notifications/unread'), enabled, refetchInterval: 20_000 })
}

export function useNotifications(params: { kind?: string; unread?: boolean; q?: string; sort?: string; offset?: number; limit?: number }, admin = false, enabled = true) {
  const qs = new URLSearchParams(Object.entries({ ...params, unread: params.unread ? '1' : '' }).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString()
  return useQuery({ queryKey: ['notifications', admin, params], queryFn: () => api.get<{ items: Notification[]; total: number }>(`/api/notifications${admin ? '/admin' : ''}${qs ? `?${qs}` : ''}`), enabled, placeholderData: (prev) => prev })
}

/* ---------- owner: tree + new albums ---------- */

export function useAdminTree(q = '', files = false) {
  return useQuery({ queryKey: ['admin-tree', q, files], queryFn: () => api.get<{ tree: TreeUser[]; totals: { users: number; galleries: number; albums: number } }>(`/api/admin/tree?q=${encodeURIComponent(q)}${files ? '&files=1' : ''}`), placeholderData: (prev) => prev })
}

export function useNewAlbums(enabled = true) {
  return useQuery({ queryKey: ['new-albums'], queryFn: () => api.get<{ albums: NewAlbumEntry[] }>('/api/admin/new-albums').then((r) => r.albums), enabled, refetchInterval: 30_000 })
}

/* ---------- timeline + reactions ---------- */

export function useTimeline(params: { before?: number; kind?: string; q?: string }) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString()
  return useQuery({ queryKey: ['timeline', params], queryFn: () => api.get<{ items: TimelineItem[]; nextBefore: number | null }>(`/api/media/timeline${qs ? `?${qs}` : ''}`), placeholderData: (prev) => prev })
}

export function useReact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { mediaId: number; emoji: string | null }) => api.post<{ media: MediaItem; emoji: string[] }>(`/api/media/${v.mediaId}/react`, { emoji: v.emoji ?? '' }),
    onSuccess: (r) => {
      qc.setQueriesData<{ album: Album; media: MediaItem[]; comments: Comment[]; canManage: boolean }>({ queryKey: ['album'] }, (old) => (old ? { ...old, media: old.media.map((m) => (m.id === r.media.id ? { ...m, reactions: r.media.reactions, myReaction: r.media.myReaction } : m)) } : old))
      qc.invalidateQueries({ queryKey: ['timeline'] })
    },
  })
}
