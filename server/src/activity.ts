import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { Request } from 'express'
import { DATA_DIR } from './db.js'

/**
 * Activity log, kept out of the main database on purpose: one SQLite file per month under
 * DATA_DIR/activity/ (YYYY-MM.db). Writes always go to the current month; reads walk the months
 * newest-first until the page is full. Old months are individual files the owner can delete.
 */

export const ACTIVITY_DIR = path.join(DATA_DIR, 'activity')

export interface ActivityEvent {
  id: number
  ts: number
  userId: number | null
  actorId: number | null
  kind: string
  targetType: string
  targetId: number | null
  targetLabel: string
  detail: Record<string, unknown>
  ip: string
  partition: string
}

const open = new Map<string, DatabaseSync>()

function monthOf(ts: number): string {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function partitionPath(month: string): string {
  return path.join(ACTIVITY_DIR, `${month}.db`)
}

function openPartition(month: string, create: boolean): DatabaseSync | null {
  const cached = open.get(month)
  if (cached) return cached
  const file = partitionPath(month)
  if (!create && !existsSync(file)) return null
  mkdirSync(ACTIVITY_DIR, { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_id INTEGER,
  actor_id INTEGER,
  kind TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id INTEGER,
  target_label TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_user ON events(user_id, ts);
CREATE INDEX IF NOT EXISTS events_actor ON events(actor_id, ts);
CREATE INDEX IF NOT EXISTS events_kind ON events(kind, ts);
`)
  // Keep at most a few partitions open; the current month stays hot.
  if (open.size >= 4) {
    const oldest = [...open.keys()].sort()[0]
    if (oldest !== monthOf(Date.now())) {
      open.get(oldest)?.close()
      open.delete(oldest)
    }
  }
  open.set(month, db)
  return db
}

export interface LogInput {
  /** The account the event is about (who it happened to / whose activity it is). */
  userId?: number | null
  /** Who performed it, when different from userId (owner acting on a member). */
  actorId?: number | null
  kind: string
  targetType?: string
  targetId?: number | null
  targetLabel?: string
  detail?: Record<string, unknown>
  ip?: string
}

/** Record one event. Never throws: logging must not break the request it describes. */
export function logActivity(input: LogInput): void {
  try {
    const ts = Date.now()
    const db = openPartition(monthOf(ts), true)!
    db.prepare('INSERT INTO events(ts, user_id, actor_id, kind, target_type, target_id, target_label, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      ts,
      input.userId ?? null,
      input.actorId ?? input.userId ?? null,
      input.kind,
      input.targetType ?? '',
      input.targetId ?? null,
      (input.targetLabel ?? '').slice(0, 200),
      JSON.stringify(input.detail ?? {}).slice(0, 4000),
      (input.ip ?? '').slice(0, 64),
    )
  } catch (e) {
    console.warn('[activity] failed to log', input.kind, (e as Error).message)
  }
}

/** Convenience for route handlers: the signed-in user is the subject unless told otherwise. */
export function track(req: Request, kind: string, extra: Omit<LogInput, 'kind' | 'ip'> = {}): void {
  logActivity({ userId: req.user?.id ?? null, actorId: req.user?.id ?? null, ...extra, kind, ip: req.ip ?? '' })
}

export interface ActivityQuery {
  userId?: number
  actorId?: number
  kind?: string
  q?: string
  from?: number
  to?: number
  /** Page cursor: events strictly older than this timestamp. */
  before?: number
  limit?: number
}

function rowToEvent(r: Record<string, unknown>, partition: string): ActivityEvent {
  let detail: Record<string, unknown> = {}
  try {
    detail = JSON.parse(r.detail as string)
  } catch {
    /* ignore */
  }
  return {
    id: r.id as number,
    ts: r.ts as number,
    userId: (r.user_id as number | null) ?? null,
    actorId: (r.actor_id as number | null) ?? null,
    kind: r.kind as string,
    targetType: r.target_type as string,
    targetId: (r.target_id as number | null) ?? null,
    targetLabel: r.target_label as string,
    detail,
    ip: r.ip as string,
    partition,
  }
}

export function partitions(): { month: string; file: string; bytes: number; events: number }[] {
  if (!existsSync(ACTIVITY_DIR)) return []
  return readdirSync(ACTIVITY_DIR)
    .filter((f) => /^\d{4}-\d{2}\.db$/.test(f))
    .map((f) => f.replace(/\.db$/, ''))
    .sort()
    .reverse()
    .map((month) => {
      const file = partitionPath(month)
      let events = 0
      try {
        events = (openPartition(month, false)!.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c
      } catch {
        /* ignore */
      }
      return { month, file: path.basename(file), bytes: statSync(file).size, events }
    })
}

/** Newest-first page across months. */
export function listActivity(qry: ActivityQuery): { events: ActivityEvent[]; nextBefore: number | null } {
  const limit = Math.min(500, Math.max(1, qry.limit ?? 100))
  const out: ActivityEvent[] = []
  const months = partitions().map((p) => p.month)
  for (const month of months) {
    if (qry.from && month < monthOf(qry.from)) break
    if (qry.to && month > monthOf(qry.to)) continue
    if (qry.before && month > monthOf(qry.before)) continue
    const db = openPartition(month, false)
    if (!db) continue
    const where: string[] = []
    const args: (number | string)[] = []
    if (qry.userId != null) {
      where.push('(user_id = ? OR actor_id = ?)')
      args.push(qry.userId, qry.userId)
    }
    if (qry.actorId != null) {
      where.push('actor_id = ?')
      args.push(qry.actorId)
    }
    if (qry.kind) {
      where.push('kind LIKE ?')
      args.push(`${qry.kind}%`)
    }
    if (qry.q) {
      where.push('(target_label LIKE ? OR detail LIKE ? OR kind LIKE ? OR ip LIKE ?)')
      const like = `%${qry.q}%`
      args.push(like, like, like, like)
    }
    if (qry.from) {
      where.push('ts >= ?')
      args.push(qry.from)
    }
    if (qry.to) {
      where.push('ts <= ?')
      args.push(qry.to)
    }
    if (qry.before) {
      where.push('ts < ?')
      args.push(qry.before)
    }
    const rows = db.prepare(`SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC, id DESC LIMIT ?`).all(...args, limit - out.length) as Record<string, unknown>[]
    for (const r of rows) out.push(rowToEvent(r, month))
    if (out.length >= limit) break
  }
  return { events: out, nextBefore: out.length >= limit ? out[out.length - 1].ts : null }
}

export function activitySummary(userId: number): { total: number; lastTs: number | null; byKind: Record<string, number> } {
  const byKind: Record<string, number> = {}
  let total = 0
  let lastTs: number | null = null
  for (const p of partitions()) {
    const db = openPartition(p.month, false)
    if (!db) continue
    const rows = db.prepare('SELECT kind, COUNT(*) c, MAX(ts) m FROM events WHERE user_id = ? OR actor_id = ? GROUP BY kind').all(userId, userId) as { kind: string; c: number; m: number }[]
    for (const r of rows) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + r.c
      total += r.c
      if (lastTs == null || r.m > lastTs) lastTs = r.m
    }
  }
  return { total, lastTs, byKind }
}

/** Delete one month's file (never the current month). */
export function deletePartition(month: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(month) || month === monthOf(Date.now())) return false
  const file = partitionPath(month)
  if (!existsSync(file)) return false
  open.get(month)?.close()
  open.delete(month)
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      unlinkSync(file + suffix)
    } catch {
      /* ignore */
    }
  }
  return true
}

export function kinds(): string[] {
  const set = new Set<string>()
  for (const p of partitions()) {
    const db = openPartition(p.month, false)
    if (!db) continue
    for (const r of db.prepare('SELECT DISTINCT kind FROM events').all() as { kind: string }[]) set.add(r.kind)
  }
  return [...set].sort()
}
