import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, MEDIA_DIR, liveDb, type SandboxContext } from './db.js'

/**
 * Temporary-owner sandboxes. The first request from a temporary owner copies the live database into
 * DATA_DIR/sandbox/<userId>.db (their own account becomes the owner inside the copy, server secrets
 * are stripped) and the request, like every later one, runs against that copy. Media they add goes
 * under MEDIA_DIR/sandbox/<userId>/. Resetting throws the copy away; the next request starts fresh
 * from the live site again.
 */

const SANDBOX_DIR = path.join(DATA_DIR, 'sandbox')
const open = new Map<number, DatabaseSync>()
const STRIPPED_SETTINGS = ['devGithub', 'devHostinger', 'devSsh', 'devSetup', 'devOps', 'dev', 'githubSnapshot', 'githubEvents', 'ownerRecoveryCodes', 'ownerResetApplied', 'pinSecret']

const file = (userId: number) => path.join(SANDBOX_DIR, `${userId}.db`)

export function openSandbox(userId: number): SandboxContext {
  let d = open.get(userId)
  if (!d) {
    mkdirSync(SANDBOX_DIR, { recursive: true })
    const f = file(userId)
    const fresh = !existsSync(f)
    if (fresh) liveDb.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`)
    d = new DatabaseSync(f)
    d.exec('PRAGMA journal_mode = WAL')
    d.exec('PRAGMA foreign_keys = ON')
    if (fresh) {
      d.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(userId)
      d.prepare('DELETE FROM sessions').run()
      d.prepare('DELETE FROM dev_sessions').run()
      d.prepare(`DELETE FROM settings WHERE key IN (${STRIPPED_SETTINGS.map(() => '?').join(',')})`).run(...STRIPPED_SETTINGS)
      d.prepare("INSERT INTO settings(key, value) VALUES ('sandboxOf', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ userId, createdAt: Date.now() }))
    }
    open.set(userId, d)
  }
  return { userId, db: d, mediaPrefix: `sandbox/${userId}` }
}

/** When the sandbox copy was taken, or null when the account has no sandbox yet. */
export function sandboxInfo(userId: number): { createdAt: number } | null {
  if (!existsSync(file(userId))) return null
  try {
    const d = open.get(userId) ?? openSandbox(userId).db
    const row = d.prepare("SELECT value FROM settings WHERE key = 'sandboxOf'").get() as { value: string } | undefined
    return row ? { createdAt: (JSON.parse(row.value) as { createdAt: number }).createdAt } : { createdAt: 0 }
  } catch {
    return { createdAt: 0 }
  }
}

/** Throw the copy and its media away; the next request from the account starts from the live site again. */
export function resetSandbox(userId: number): void {
  const d = open.get(userId)
  if (d) {
    try {
      d.close()
    } catch {
      /* ignore */
    }
    open.delete(userId)
  }
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${file(userId)}${suffix}`, { force: true })
  rmSync(path.join(MEDIA_DIR, 'sandbox', String(userId)), { recursive: true, force: true })
}
