import { Router } from 'express'
import { db } from '../db.js'
import { requireOwner } from '../auth.js'
import { HttpError, num, str, wrap } from '../util.js'
import { activitySummary, deletePartition, kinds, listActivity, partitions } from '../activity.js'

/** Owner only: the global activity log and per-account views, served from the monthly partitions. */
export const activityRouter = Router()
activityRouter.use(requireOwner)

function userNames(ids: number[]): Record<number, { username: string; displayName: string }> {
  const out: Record<number, { username: string; displayName: string }> = {}
  const uniq = [...new Set(ids.filter((n) => Number.isFinite(n)))]
  if (!uniq.length) return out
  const rows = db.prepare(`SELECT id, username, display_name FROM users WHERE id IN (${uniq.map(() => '?').join(',')})`).all(...uniq) as { id: number; username: string; display_name: string }[]
  for (const r of rows) out[r.id] = { username: r.username, displayName: r.display_name }
  return out
}

activityRouter.get(
  '/',
  wrap((req, res) => {
    const q = req.query
    const page = listActivity({
      userId: q.userId != null && q.userId !== '' ? num(q.userId) : undefined,
      kind: str(q.kind, 60) || undefined,
      q: str(q.q, 120) || undefined,
      from: q.from ? num(q.from) : undefined,
      to: q.to ? num(q.to) : undefined,
      before: q.before ? num(q.before) : undefined,
      limit: q.limit ? num(q.limit) : 100,
    })
    const names = userNames(page.events.flatMap((e) => [e.userId ?? NaN, e.actorId ?? NaN]))
    res.json({ ...page, users: names })
  }),
)

activityRouter.get('/kinds', (_req, res) => {
  res.json({ kinds: kinds() })
})

activityRouter.get('/partitions', (_req, res) => {
  res.json({ partitions: partitions() })
})

activityRouter.delete(
  '/partitions/:month',
  wrap((req, res) => {
    if (!deletePartition(req.params.month as string)) throw new HttpError(400, 'That month cannot be deleted (missing, or the current month)')
    res.json({ ok: true })
  }),
)

activityRouter.get(
  '/users/:id',
  wrap((req, res) => {
    const id = Number(req.params.id)
    const page = listActivity({ userId: id, before: req.query.before ? num(req.query.before) : undefined, limit: req.query.limit ? num(req.query.limit) : 60, kind: str(req.query.kind, 60) || undefined })
    const names = userNames(page.events.flatMap((e) => [e.userId ?? NaN, e.actorId ?? NaN]))
    res.json({ ...page, users: names, summary: activitySummary(id) })
  }),
)
