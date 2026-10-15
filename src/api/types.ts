export type Role = 'owner' | 'admin' | 'user'

export interface User {
  id: number
  username: string
  display_name: string
  role: Role
  disabled: number
  bio: string
  avatarUrl: string | null
  aiEnabled: boolean
  perms: Perms
  created_at: number
  last_seen_at: number | null
  status: 'active' | 'pending'
  created_by: number | null
  likes?: number
  comments?: number
  galleryIds?: number[]
  ownGalleryId?: number | null
  ownGallerySlug?: string | null
  counts?: { albums: number; publicAlbums: number; media: number; bytes: number; messagesSent: number; buddies: number; sessions: number; aiConversations: number }
}

/** Owner-controlled capabilities; everything is on by default. */
export interface Perms {
  canUpload: boolean
  canPublish: boolean
  canComment: boolean
  canReact: boolean
  canMessage: boolean
  canBuddies: boolean
}

export interface Session {
  user: User | null
  viewingAs: { owner: { id: number; displayName: string } } | null
}

export interface Palette {
  bg: string
  bgElevated: string
  surface: string
  surfaceHover: string
  border: string
  text: string
  textMuted: string
  primary: string
  primaryText: string
  accent: string
  accentText: string
  danger: string
  success: string
}

export interface Theme {
  id: number
  name: string
  light: Palette
  dark: Palette
  fontDisplay: string
  fontBody: string
  radius: number
  scale: number
  builtIn: boolean
  createdAt: number
}

export type ThemeDraft = Omit<Theme, 'id' | 'createdAt' | 'builtIn'>

export type LayoutKind = 'masonry' | 'grid' | 'justified' | 'mosaic' | 'filmstrip' | 'carousel'
export type CaptionMode = 'overlay' | 'below' | 'hover' | 'hidden'
export type TileShape = 'natural' | 'square' | 'portrait' | 'landscape' | 'circle'

export interface LayoutConfig {
  kind: LayoutKind
  columns: number
  gap: number
  caption: CaptionMode
  shape: TileShape
  rounded: boolean
  hoverZoom: boolean
  showLikes: boolean
  heroCover: boolean
}

export interface SiteSettings {
  siteTitle: string
  tagline: string
  brandName: string
  activeThemeId: number | null
  defaultLayout: LayoutConfig
  allowComments: boolean
  allowLikes: boolean
  allowDownloads: boolean
  heroAlbumId: number | null
}

export type MediaKind = 'image' | 'video'

export interface MediaItem {
  id: number
  albumId: number
  kind: MediaKind
  title: string
  description: string
  mimeType: string
  width: number
  height: number
  size: number
  duration: number | null
  sortOrder: number
  views: number
  createdAt: number
  url: string
  thumbUrl: string | null
  likes: number
  comments: number
  liked: boolean
}

export type Visibility = 'published' | 'draft' | 'public'

export interface GallerySummary {
  id: number
  slug: string
  title: string
  publicAlbumId: number | null
  owner: { id: number; displayName: string; username: string; avatarUrl: string | null } | null
}

export interface PublicFeed {
  albums: Album[]
  people: Gallery[]
  tags: { name: string; count: number }[]
  stats: { people: number; albums: number; photos: number; likes: number }
}

export interface Gallery {
  id: number
  slug: string
  title: string
  tagline: string
  headline: string
  owner: { id: number; displayName: string; username: string; avatarUrl: string | null } | null
  isMine: boolean
  splash: MediaItem | null
  splashMediaId: number | null
  themeId: number | null
  publicAlbumId: number | null
  publicAlbum: { id: number; slug: string; title: string } | null
  previews: { albumId: number; albumSlug: string; title: string; visibility: Visibility; cover: MediaItem | null }[]
  counts: { albums: number; publicAlbums: number; media: number; videos: number; members: number }
  createdAt: number
  updatedAt: number
  /** Explicitly granted or owned, as opposed to visible only through public albums. */
  granted?: boolean
}

export interface Album {
  id: number
  galleryId: number
  gallery: GallerySummary | null
  restricted: boolean
  allowedUserIds?: number[]
  isPublic: boolean
  isHook: boolean
  slug: string
  title: string
  description: string
  visibility: Visibility
  tags: string[]
  layoutOverride: LayoutConfig | null
  sortOrder: number
  featured: boolean
  views: number
  shareToken: string | null
  createdAt: number
  updatedAt: number
  coverMediaId: number | null
  cover: MediaItem | null
  counts: { media: number; videos: number; likes: number; comments: number; favorites: number }
  favorited: boolean
}

export interface Comment {
  id: number
  userId: number
  mediaId: number | null
  albumId: number | null
  body: string
  createdAt: number
  author: { id: number; displayName: string; username: string; avatarUrl: string | null }
}

export interface Stats {
  albums: number
  published: number
  media: number
  videos: number
  users: number
  activeUsers: number
  pendingUsers: number
  galleries: number
  likes: number
  comments: number
  favorites: number
  bytes: number
  views: number
  recentComments: { id: number; body: string; createdAt: number; author: string; target: string; slug: string | null }[]
  topAlbums: { id: number; title: string; slug: string; views: number; likes: number }[]
}

/* ---------- social ---------- */

export type BuddyState = 'none' | 'accepted' | 'outgoing' | 'incoming'

export interface Person {
  id: number
  username: string
  displayName: string
  bio: string
  avatarUrl: string | null
  role: Role
  gallerySlug: string | null
  publicAlbums: number
  buddy: BuddyState
  lastSeenAt: number | null
}

export interface BuddyLists {
  buddies: Person[]
  incoming: Person[]
  outgoing: Person[]
}

export interface Message {
  id: number
  fromId: number
  toId: number
  body: string
  createdAt: number
  readAt: number | null
}

export interface Conversation {
  person: Person
  last: Message
  unread: number
}

export interface Unread {
  messages: number
  requests: number
}

/* ---------- assistant ---------- */

export interface AiStatus {
  allowed: boolean
  enabled: boolean
  assistantName: string
  model: string
  backends: { subscription: boolean; api: boolean }
  codeChanges: boolean
  sourceVersion: string
}

export interface AiSettingsView {
  enabled: boolean
  model: string
  allowCodeChanges: boolean
  extraInstructions: string
  assistantName: string
  hasSubscriptionToken: boolean
  hasApiKey: boolean
}

export interface AiConversation {
  id: number
  title: string
  createdAt: number
  updatedAt: number
  messages: number
}

export interface AiMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  meta: { backend?: 'subscription' | 'api'; tools?: string[]; model?: string; context?: PageContext | null }
}

export interface PageContext {
  url?: string
  title?: string
  selection?: string
  element?: string
}

/* ---------- owner inbox ---------- */

export interface InboxItem {
  id: number
  kind: 'account_request' | 'contact'
  from: { id: number; username: string; displayName: string } | null
  name: string
  contact: string
  usernameWanted: string
  body: string
  status: 'open' | 'approved' | 'dismissed' | 'done'
  note: string
  createdAt: number
  handledAt: number | null
  readAt: number | null
}

/** A private, revocable link to an album; anyone holding it can view, whatever the album's visibility. */
export interface AlbumLink {
  id: number
  albumId: number
  token: string
  label: string
  url: string
  createdBy: number | null
  createdAt: number
  views: number
  revokedAt: number | null
}
