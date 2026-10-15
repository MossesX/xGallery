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

/** CSV export for a date range (inclusive), newest first, up to 100k rows. */
activityRouter.get(
  '/export.csv',
  wrap((req, res) => {
    const from = req.query.from ? num(req.query.from) : undefined
    const to = req.query.to ? num(req.query.to) : undefined
    const userId = req.query.userId ? num(req.query.userId) : undefined
    const kind = str(req.query.kind, 60) || undefined
    const page = listActivity({ from, to, userId, kind, limit: 100_000 })
    const names = userNames(page.events.flatMap((e) => [e.userId ?? NaN, e.actorId ?? NaN]))
    const esc = (v: unknown) => {
      const t = v == null ? '' : String(v)
      return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    const label = (id: number | null) => (id != null ? (names[id] ? `${names[id].displayName} (@${names[id].username})` : `#${id}`) : '')
    const lines = ['time,iso,kind,user,actor,target_type,target_id,target_label,ip,detail']
    for (const e of page.events) lines.push([e.ts, new Date(e.ts).toISOString(), e.kind, label(e.userId), label(e.actorId), e.targetType, e.targetId ?? '', e.targetLabel, e.ip, JSON.stringify(e.detail)].map(esc).join(','))
    const stamp = `${from ? new Date(from).toISOString().slice(0, 10) : 'start'}_${to ? new Date(to).toISOString().slice(0, 10) : 'now'}`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="xgallery-activity-${stamp}.csv"`)
    res.send('\ufeff' + lines.join('\r\n'))
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
