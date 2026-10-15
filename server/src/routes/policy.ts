import { Router } from 'express'
import { db, now } from '../db.js'
import { requireOwner } from '../auth.js'
import { HttpError, str, wrap, IdRow } from '../util.js'
import { getPolicy, LIMIT_KEYS, LIMIT_LABELS, PERM_KEYS, PERM_LABELS, parseLimitOverrides, parsePermOverrides, savePolicy, type GroupRow } from '../policy.js'
import { track } from '../activity.js'

/** Owner only: site-wide policy (defaults, switches) and groups with their overrides. */
export const policyRouter = Router()
policyRouter.use(requireOwner)

function groupJson(g: GroupRow) {
  const members = (db.prepare('SELECT COUNT(*) c FROM group_members WHERE group_id = ?').get(g.id) as { c: number }).c
  return { id: g.id, name: g.name, description: g.description, perms: parsePermOverrides(g.perms), limits: parseLimitOverrides(g.limits), priority: g.priority, members, createdAt: g.created_at }
}

policyRouter.get('/', (_req, res) => {
  res.json({ policy: getPolicy(), permKeys: PERM_KEYS, permLabels: PERM_LABELS, limitKeys: LIMIT_KEYS, limitLabels: LIMIT_LABELS })
})

policyRouter.put(
  '/',
  wrap((req, res) => {
    const next = savePolicy(req.body ?? {})
    track(req, 'admin.policy_update', { detail: { keys: Object.keys(req.body ?? {}) } })
    res.json({ policy: next })
  }),
)

policyRouter.get('/groups', (_req, res) => {
  const rows = db.prepare('SELECT * FROM groups ORDER BY priority, id').all() as unknown as GroupRow[]
  res.json({ groups: rows.map(groupJson) })
})

policyRouter.post(
  '/groups',
  wrap((req, res) => {
    const name = str(req.body?.name, 60).trim()
    if (!name) throw new HttpError(400, 'Group name is required')
    if (db.prepare('SELECT 1 FROM groups WHERE name = ?').get(name)) throw new HttpError(409, 'That group already exists')
    const info = db.prepare('INSERT INTO groups(name, description, perms, limits, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(name, str(req.body?.description, 300), JSON.stringify(parsePermOverrides(req.body?.perms)), JSON.stringify(parseLimitOverrides(req.body?.limits)), Number(req.body?.priority) || 0, now())
    track(req, 'admin.group_create', { targetType: 'group', targetId: info.lastInsertRowid as number, targetLabel: name })
    res.status(201).json({ group: groupJson(db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid as number) as unknown as GroupRow) })
  }),
)

policyRouter.put(
  '/groups/:id',
  wrap((req, res) => {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id)) as unknown as GroupRow | undefined
    if (!g) throw new HttpError(404, 'Group not found')
    const b = req.body ?? {}
    const name = typeof b.name === 'string' && b.name.trim() ? str(b.name, 60).trim() : g.name
    if (name !== g.name && db.prepare('SELECT 1 FROM groups WHERE name = ? AND id <> ?').get(name, g.id)) throw new HttpError(409, 'That group already exists')
    const perms = b.perms && typeof b.perms === 'object' ? (() => { const cur: Record<string, boolean> = { ...parsePermOverrides(g.perms) }; for (const k of PERM_KEYS) { const v = (b.perms as Record<string, unknown>)[k]; if (v === null) delete cur[k]; else if (typeof v === 'boolean') cur[k] = v } return cur })() : parsePermOverrides(g.perms)
    const limits = b.limits && typeof b.limits === 'object' ? (() => { const cur: Record<string, number> = { ...parseLimitOverrides(g.limits) }; for (const k of LIMIT_KEYS) { const v = (b.limits as Record<string, unknown>)[k]; if (v === null) delete cur[k]; else if (typeof v === 'number' && Number.isFinite(v)) cur[k] = Math.max(0, Math.floor(v)) } return cur })() : parseLimitOverrides(g.limits)
    db.prepare('UPDATE groups SET name = ?, description = ?, perms = ?, limits = ?, priority = ? WHERE id = ?').run(name, typeof b.description === 'string' ? str(b.description, 300) : g.description, JSON.stringify(perms), JSON.stringify(limits), typeof b.priority === 'number' ? Math.floor(b.priority) : g.priority, g.id)
    if (Array.isArray(b.memberIds)) {
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(g.id)
      for (const id of (b.memberIds as unknown[]).map(Number)) if (Number.isFinite(id)) db.prepare('INSERT OR IGNORE INTO group_members(group_id, user_id, created_at) VALUES (?, ?, ?)').run(g.id, id, now())
    }
    track(req, 'admin.group_update', { targetType: 'group', targetId: g.id, targetLabel: name })
    res.json({ group: groupJson(db.prepare('SELECT * FROM groups WHERE id = ?').get(g.id) as unknown as GroupRow) })
  }),
)

policyRouter.get(
  '/groups/:id/members',
  wrap((req, res) => {
    const rows = db.prepare('SELECT u.id, u.username, u.display_name FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.display_name').all(Number(req.params.id)) as IdRow[]
    res.json({ members: rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name })) })
  }),
)

policyRouter.delete(
  '/groups/:id',
  wrap((req, res) => {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id)) as unknown as GroupRow | undefined
    if (!g) throw new HttpError(404, 'Group not found')
    db.prepare('DELETE FROM groups WHERE id = ?').run(g.id)
    track(req, 'admin.group_delete', { targetType: 'group', targetId: g.id, targetLabel: g.name })
    res.json({ ok: true })
  }),
)
