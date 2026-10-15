import { Router } from 'express'
import { requireOwner, requireUser } from '../auth.js'
import { HttpError, num, str, wrap } from '../util.js'
import { deleteNotification, listNotifications, markRead, unreadCount } from '../notifications.js'

/** Member notifications (/api/notifications) and the owner's admin feed (/api/notifications/admin). */
export const notificationsRouter = Router()

notificationsRouter.get(
  '/',
  requireUser,
  wrap((req, res) => {
    const q = req.query
    res.json(listNotifications({ userId: req.user!.id, kind: str(q.kind, 40) || undefined, unreadOnly: q.unread === '1', q: str(q.q, 80) || undefined, sort: (str(q.sort, 10) as 'newest') || 'newest', limit: q.limit ? num(q.limit) : 50, offset: q.offset ? num(q.offset) : 0 }))
  }),
)

notificationsRouter.get('/unread', requireUser, (req, res) => {
  res.json({ unread: unreadCount(req.user!.id), admin: req.user!.role === 'owner' ? { total: unreadCount(null), albums: unreadCount(null, 'album.'), requests: unreadCount(null, 'inbox.'), security: unreadCount(null, 'security.') } : null })
})

notificationsRouter.put(
  '/read',
  requireUser,
  wrap((req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : 'all'
    res.json({ changed: markRead(req.user!.id, ids) })
  }),
)

notificationsRouter.delete(
  '/:id',
  requireUser,
  wrap((req, res) => {
    if (!deleteNotification(req.user!.id, Number(req.params.id))) throw new HttpError(404, 'Not found')
    res.json({ ok: true })
  }),
)

/* ---------- owner feed ---------- */

notificationsRouter.get(
  '/admin',
  requireOwner,
  wrap((req, res) => {
    const q = req.query
    res.json(listNotifications({ userId: null, kind: str(q.kind, 40) || undefined, unreadOnly: q.unread === '1', q: str(q.q, 80) || undefined, sort: (str(q.sort, 10) as 'newest') || 'newest', limit: q.limit ? num(q.limit) : 50, offset: q.offset ? num(q.offset) : 0 }))
  }),
)

notificationsRouter.put(
  '/admin/read',
  requireOwner,
  wrap((req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : 'all'
    res.json({ changed: markRead(null, ids, str(req.body?.kind, 40) || undefined) })
  }),
)

notificationsRouter.delete(
  '/admin/:id',
  requireOwner,
  wrap((req, res) => {
    if (!deleteNotification(null, Number(req.params.id))) throw new HttpError(404, 'Not found')
    res.json({ ok: true })
  }),
)
