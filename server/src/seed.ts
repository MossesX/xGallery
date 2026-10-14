import { db, getSetting, now, setSetting } from './db.js'
import { hashPassword, newSalt } from './auth.js'
import { BRAND_THEMES, DEFAULT_SETTINGS } from './brand.js'
import { ensureGalleryFor, grantGallery } from './access.js'

export const DEFAULT_ADMIN = { username: 'brett', displayName: 'Brett', password: process.env.ADMIN_PASSWORD ?? 'admin123' }

export function ensureSeeded(): void {
  const users = (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c
  if (users === 0) {
    const salt = newSalt()
    db.prepare('INSERT INTO users(username, display_name, role, password_hash, salt, created_at, ai_enabled) VALUES (?, ?, ?, ?, ?, ?, 1)').run(
      DEFAULT_ADMIN.username,
      DEFAULT_ADMIN.displayName,
      'owner',
      hashPassword(DEFAULT_ADMIN.password, salt),
      salt,
      now(),
    )
  }
  // Built-in themes track the AmberX brand definitions: insert missing ones and refresh existing built-ins.
  const ins = db.prepare('INSERT INTO themes(name, light, dark, font_display, font_body, radius, scale, built_in, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
  const upd = db.prepare('UPDATE themes SET light = ?, dark = ?, font_display = ?, font_body = ?, radius = ?, scale = ? WHERE id = ?')
  const builtIns = db.prepare('SELECT id, name FROM themes WHERE built_in = 1 ORDER BY created_at').all() as { id: number; name: string }[]
  const legacy = ['AmberX', 'Amber Noir', 'Azure Studio']
  BRAND_THEMES.forEach((t, i) => {
    const existing = builtIns.find((b) => b.name === t.name) ?? builtIns.find((b) => b.name === legacy[i])
    if (existing) {
      upd.run(JSON.stringify(t.light), JSON.stringify(t.dark), t.fontDisplay, t.fontBody, t.radius, t.scale, existing.id)
      if (existing.name !== t.name) db.prepare('UPDATE themes SET name = ? WHERE id = ?').run(t.name, existing.id)
    } else ins.run(t.name, JSON.stringify(t.light), JSON.stringify(t.dark), t.fontDisplay, t.fontBody, t.radius, t.scale, now() + i)
  })
  // The founding administrator account becomes the owner "Brett" (username brett), keeping its password.
  const legacyOwner = db.prepare("SELECT id FROM users WHERE username = 'admin' AND role IN ('owner', 'admin')").get() as { id: number } | undefined
  if (legacyOwner && !db.prepare("SELECT 1 FROM users WHERE username = 'brett'").get()) {
    db.prepare("UPDATE users SET username = 'brett', display_name = 'Brett', role = 'owner', ai_enabled = 1 WHERE id = ?").run(legacyOwner.id)
    db.prepare("UPDATE galleries SET title = 'Brett' WHERE owner_user_id = ? AND title IN ('Administrator', 'Administrator''s Gallery')").run(legacyOwner.id)
  }
  // Promote the first administrator to owner when upgrading from the single-admin schema.
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'owner'").get()) {
    const first = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").get() as { id: number } | undefined
    if (first) db.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(first.id)
  }
  // Every account has a gallery; orphan albums go to the owner's gallery; existing members keep access.
  const admins = db.prepare('SELECT id, display_name, role FROM users').all() as { id: number; display_name: string; role: string }[]
  for (const a of admins) ensureGalleryFor(a.id, a.display_name)
  const owner = admins.find((a) => a.role === 'owner')
  if (owner) {
    const og = ensureGalleryFor(owner.id, owner.display_name)
    const orphans = (db.prepare('UPDATE albums SET gallery_id = ? WHERE gallery_id IS NULL').run(og.id) as { changes: number }).changes
    if (orphans > 0) {
      for (const u of db.prepare("SELECT id FROM users WHERE role = 'user'").all() as { id: number }[]) grantGallery(u.id, og.id)
    }
  }
  const settings = getSetting<Record<string, unknown>>('site', {})
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  // Retire the old default tagline on existing installs; a custom tagline is kept.
  if (merged.tagline === 'Curated visual stories by AmberX') merged.tagline = DEFAULT_SETTINGS.tagline
  if (merged.activeThemeId == null) {
    const first = db.prepare('SELECT id FROM themes ORDER BY created_at LIMIT 1').get() as { id: number } | undefined
    merged.activeThemeId = first?.id ?? null
  }
  setSetting('site', merged)
}
