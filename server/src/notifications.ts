import { db, now } from './db.js'
import { IdRow } from './util.js'

/**
 * In-app notifications. `user_id` NULL means the owner's admin feed (site-level events: new albums,
 * account requests, forgotten passwords, first sign-ins, contact notes). A numeric user_id is a
 * member notification (likes, comments, buddies, messages, shared albums).
 */

export interface NotifyInput {
  userId: number | null
  kind: string
  title: string
  body?: string
  data?: Record<string, unknown>
  actorId?: number | null
}

export function notify(n: NotifyInput): number {
  const info = db.prepare('INSERT INTO notifications(user_id, kind, title, body, data, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(n.userId, n.kind, n.title.slice(0, 200), (n.body ?? '').slice(0, 1000), JSON.stringify(n.data ?? {}).slice(0, 4000), n.actorId ?? null, now())
  return info.lastInsertRowid as number
}

/** The owner's feed, plus anything addressed to the owner account directly. */
export function notifyOwner(n: Omit<NotifyInput, 'userId'>): number {
  return notify({ ...n, userId: null })
}

export function notificationJson(r: IdRow) {
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(r.data as string)
  } catch {
    /* ignore */
  }
  const actor = r.actor_id ? (db.prepare('SELECT id, username, display_name, avatar_path FROM users WHERE id = ?').get(r.actor_id as number) as { id: number; username: string; display_name: string; avatar_path: string | null } | undefined) : undefined
  return {
    id: r.id,
    userId: r.user_id ?? null,
    kind: r.kind,
    title: r.title,
    body: r.body,
    data,
    actor: actor ? { id: actor.id, username: actor.username, displayName: actor.display_name } : null,
    readAt: r.read_at ?? null,
    createdAt: r.created_at,
  }
}

export interface ListOpts {
  /** null = owner feed */
  userId: number | null
  kind?: string
  unreadOnly?: boolean
  q?: string
  sort?: 'newest' | 'oldest' | 'kind' | 'unread'
  limit?: number
  offset?: number
}

export function listNotifications(o: ListOpts): { items: ReturnType<typeof notificationJson>[]; total: number } {
  const where: string[] = [o.userId == null ? 'user_id IS NULL' : 'user_id = ?']
  const args: (number | string)[] = o.userId == null ? [] : [o.userId]
  if (o.kind) {
    where.push('kind LIKE ?')
    args.push(`${o.kind}%`)
  }
  if (o.unreadOnly) where.push('read_at IS NULL')
  if (o.q) {
    where.push('(title LIKE ? OR body LIKE ? OR data LIKE ?)')
    const like = `%${o.q}%`
    args.push(like, like, like)
  }
  const order = o.sort === 'oldest' ? 'created_at ASC' : o.sort === 'kind' ? 'kind ASC, created_at DESC' : o.sort === 'unread' ? '(read_at IS NULL) DESC, created_at DESC' : 'created_at DESC'
  const sql = `FROM notifications WHERE ${where.join(' AND ')}`
  const total = (db.prepare(`SELECT COUNT(*) c ${sql}`).get(...args) as { c: number }).c
  const rows = db.prepare(`SELECT * ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, Math.min(200, o.limit ?? 50), o.offset ?? 0) as IdRow[]
  return { items: rows.map(notificationJson), total }
}

export function unreadCount(userId: number | null, kindPrefix?: string): number {
  const extra = kindPrefix ? ' AND kind LIKE ?' : ''
  const args: (number | string)[] = userId == null ? [] : [userId]
  if (kindPrefix) args.push(`${kindPrefix}%`)
  return (db.prepare(`SELECT COUNT(*) c FROM notifications WHERE ${userId == null ? 'user_id IS NULL' : 'user_id = ?'} AND read_at IS NULL${extra}`).get(...args) as { c: number }).c
}

export function markRead(userId: number | null, ids: number[] | 'all', kindPrefix?: string): number {
  const base = userId == null ? 'user_id IS NULL' : 'user_id = ?'
  const args: (number | string)[] = userId == null ? [] : [userId]
  let sql = `UPDATE notifications SET read_at = ${now()} WHERE ${base} AND read_at IS NULL`
  if (ids !== 'all') {
    if (!ids.length) return 0
    sql += ` AND id IN (${ids.map(() => '?').join(',')})`
    args.push(...ids)
  }
  if (kindPrefix) {
    sql += ' AND kind LIKE ?'
    args.push(`${kindPrefix}%`)
  }
  return (db.prepare(sql).run(...args) as { changes: number }).changes
}

export function deleteNotification(userId: number | null, id: number): boolean {
  const r = db.prepare(`DELETE FROM notifications WHERE id = ? AND ${userId == null ? 'user_id IS NULL' : 'user_id = ?'}`).run(...(userId == null ? [id] : [id, userId])) as { changes: number }
  return r.changes > 0
}
