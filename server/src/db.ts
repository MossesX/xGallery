import { DatabaseSync } from 'node:sqlite'
import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data')
export const MEDIA_DIR = path.join(DATA_DIR, 'media')
mkdirSync(MEDIA_DIR, { recursive: true })

/** The site's database. */
export const liveDb = new DatabaseSync(path.join(DATA_DIR, 'gallery.db'))
liveDb.exec('PRAGMA journal_mode = WAL')
liveDb.exec('PRAGMA foreign_keys = ON')

/**
 * Sandboxes: a "temporary owner" works on a private copy of the database (and a private media
 * folder). Requests from such an account run inside this store, and `db` below resolves to the copy,
 * so every route behaves exactly as for the owner while the live site never changes.
 */
export interface SandboxContext {
  userId: number
  db: DatabaseSync
  /** Media written in the sandbox lands under this prefix inside MEDIA_DIR. */
  mediaPrefix: string
}
export const sandboxStore = new AsyncLocalStorage<SandboxContext>()
export const currentSandbox = (): SandboxContext | null => sandboxStore.getStore() ?? null
const currentDb = (): DatabaseSync => sandboxStore.getStore()?.db ?? liveDb
/** The database for the current request: the live one, or the sandbox copy of a temporary owner. */
export const db: DatabaseSync = new Proxy(liveDb, {
  get(_target, prop) {
    const d = currentDb()
    const v = Reflect.get(d, prop) as unknown
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(d) : v
  },
}) as DatabaseSync

/** Where a new media file is stored (relative to MEDIA_DIR): inside the sandbox folder when one is active. */
export function mediaRel(rel: string): string {
  const s = sandboxStore.getStore()
  return s ? path.posix.join(s.mediaPrefix, rel) : rel
}
/** Delete a media file; inside a sandbox only the sandbox's own files are ever removed. */
export function removeMedia(rel: string | null | undefined): void {
  if (!rel) return
  const s = sandboxStore.getStore()
  if (s && !rel.startsWith(`${s.mediaPrefix}/`)) return
  const abs = path.join(MEDIA_DIR, rel)
  if (!existsSync(abs)) return
  try {
    unlinkSync(abs)
  } catch {
    /* ignore */
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  bio TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  light TEXT NOT NULL,
  dark TEXT NOT NULL,
  font_display TEXT NOT NULL,
  font_body TEXT NOT NULL,
  radius INTEGER NOT NULL,
  scale REAL NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_media_id INTEGER,
  visibility TEXT NOT NULL DEFAULT 'draft',
  tags TEXT NOT NULL DEFAULT '[]',
  layout_override TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  share_token TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  file_path TEXT NOT NULL,
  thumb_path TEXT,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  duration REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS media_album ON media(album_id, sort_order);
CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, media_id)
);
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, album_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
  album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_media ON comments(media_id);
CREATE INDEX IF NOT EXISTS comments_album ON comments(album_id);
`)

export type Row = Record<string, unknown>

export function now(): number {
  return Date.now()
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
}

/* ---------- schema v2: galleries, access control, pending users ---------- */

function hasColumn(table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col)
}

db.exec(`
CREATE TABLE IF NOT EXISTS galleries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  splash_media_id INTEGER,
  theme_id INTEGER,
  public_album_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gallery_access (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, gallery_id)
);
CREATE TABLE IF NOT EXISTS album_access (
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (album_id, user_id)
);
`)
if (!hasColumn('users', 'status')) db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
if (!hasColumn('users', 'created_by')) db.exec('ALTER TABLE users ADD COLUMN created_by INTEGER')
if (!hasColumn('users', 'avatar_path')) db.exec('ALTER TABLE users ADD COLUMN avatar_path TEXT')
if (!hasColumn('users', 'ai_enabled')) db.exec('ALTER TABLE users ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0')
// v5: private links — any number of unique, revocable links per album; anyone holding one can view.
db.exec(`
CREATE TABLE IF NOT EXISTS album_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS album_links_album ON album_links(album_id);
`)
if (!hasColumn('users', 'perms')) db.exec("ALTER TABLE users ADD COLUMN perms TEXT NOT NULL DEFAULT '{}'")
// v6: many galleries per account (named, with a cover, one primary), groups with layered policy,
// per-account limits/overrides, forced password change, notifications.
if (!hasColumn('users', 'limits')) db.exec("ALTER TABLE users ADD COLUMN limits TEXT NOT NULL DEFAULT '{}'")
if (!hasColumn('users', 'must_change_password')) db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0')
if (!hasColumn('users', 'email')) db.exec("ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''")
if (!hasColumn('users', 'phone')) db.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''")
// Comment moderation: held comments wait for the album owner's approval.
if (!hasColumn('comments', 'approved')) db.exec('ALTER TABLE comments ADD COLUMN approved INTEGER NOT NULL DEFAULT 1')
if (!hasColumn('galleries', 'is_primary')) {
  // Drop the one-gallery-per-owner constraint by rebuilding the table.
  db.exec(`
CREATE TABLE galleries_v6 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  splash_media_id INTEGER,
  cover_path TEXT,
  theme_id INTEGER,
  public_album_id INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO galleries_v6(id, owner_user_id, slug, title, tagline, headline, splash_media_id, theme_id, public_album_id, is_primary, created_at, updated_at)
  SELECT id, owner_user_id, slug, title, tagline, headline, splash_media_id, theme_id, public_album_id, 1, created_at, updated_at FROM galleries;
DROP TABLE galleries;
ALTER TABLE galleries_v6 RENAME TO galleries;
CREATE INDEX IF NOT EXISTS galleries_owner ON galleries(owner_user_id);
`)
}
db.exec(`
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  perms TEXT NOT NULL DEFAULT '{}',
  limits TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  actor_id INTEGER,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, read_at, created_at);
CREATE INDEX IF NOT EXISTS notifications_kind ON notifications(kind, created_at);
CREATE TABLE IF NOT EXISTS album_collaborators (
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (album_id, user_id)
);
CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, media_id)
);
CREATE INDEX IF NOT EXISTS reactions_media ON reactions(media_id);
`)
// v4: owner inbox (account requests, contact messages) and the AI assistant's conversations.
db.exec(`
CREATE TABLE IF NOT EXISTS admin_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  username_wanted TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  handled_at INTEGER,
  read_at INTEGER
);
CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  cli_session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_messages_conv ON ai_messages(conversation_id, id);
`)
// v3: social layer — buddy lists and private messages.
db.exec(`
CREATE TABLE IF NOT EXISTS buddies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buddy_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, buddy_id)
);
CREATE INDEX IF NOT EXISTS buddies_buddy ON buddies(buddy_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_to ON messages(to_id, read_at);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(from_id, to_id, created_at);
`)
if (!hasColumn('albums', 'gallery_id')) db.exec('ALTER TABLE albums ADD COLUMN gallery_id INTEGER')
if (!hasColumn('albums', 'restricted')) db.exec('ALTER TABLE albums ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0')
// Shared private albums: a PIN (hashed) guards the private link; a snapshot of the page sits blurred behind the prompt.
if (!hasColumn('albums', 'pin_hash')) db.exec('ALTER TABLE albums ADD COLUMN pin_hash TEXT')
if (!hasColumn('albums', 'pin_salt')) db.exec('ALTER TABLE albums ADD COLUMN pin_salt TEXT')
if (!hasColumn('albums', 'pin_set_at')) db.exec('ALTER TABLE albums ADD COLUMN pin_set_at INTEGER')
if (!hasColumn('albums', 'lock_snapshot')) db.exec('ALTER TABLE albums ADD COLUMN lock_snapshot TEXT')
db.exec('CREATE INDEX IF NOT EXISTS albums_gallery ON albums(gallery_id)')

// v7: the developer panel — password-gated sessions with a change log, site-design snapshots,
// and developer-mode AI conversations.
if (!hasColumn('ai_conversations', 'mode')) db.exec("ALTER TABLE ai_conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'assistant'")
db.exec(`
CREATE TABLE IF NOT EXISTS dev_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login_token TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  summary_source TEXT NOT NULL DEFAULT '',
  changes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS dev_sessions_token ON dev_sessions(login_token, ended_at);
CREATE TABLE IF NOT EXISTS dev_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES dev_sessions(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS dev_events_session ON dev_events(session_id, id);
CREATE TABLE IF NOT EXISTS dev_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES dev_sessions(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'auto',
  payload TEXT NOT NULL
);
`)

// v8: the developer task manager — lists (with nested groups), entries (notes, to-dos, tasks, with subtasks).
db.exec(`
CREATE TABLE IF NOT EXISTS dev_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES dev_lists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dev_lists_parent ON dev_lists(parent_id, sort_order);
CREATE TABLE IF NOT EXISTS dev_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES dev_lists(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES dev_entries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_at INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  checklist TEXT NOT NULL DEFAULT '[]',
  fields TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS dev_entries_list ON dev_entries(list_id, parent_id, sort_order);
`)
