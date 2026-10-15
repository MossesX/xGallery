import { Router } from 'express'
import { db, now } from '../db.js'
import { HttpError, num, str, wrap, type IdRow } from '../util.js'
import { recordEvent, requireDev } from '../dev.js'
import { getTypes, KINDS, saveTypes, validateEntry, type EntryInput, type EntryKind } from '../tasks.js'

/** The developer task manager: lists with nested groups, entries (notes, to-dos, tasks) with subtasks. */
export const tasksRouter = Router()
tasksRouter.use(requireDev)

/* ---------- helpers ---------- */

function listJson(r: IdRow) {
  const c = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) d FROM dev_entries WHERE list_id = ?").get(r.id) as { n: number; d: number | null }
  return { id: r.id, parentId: r.parent_id ?? null, title: r.title, color: r.color, icon: r.icon, sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at, counts: { entries: c.n, done: c.d ?? 0 } }
}

function parse<T>(s: unknown, fallback: T): T {
  try {
    return JSON.parse(String(s)) as T
  } catch {
    return fallback
  }
}

function entryJson(r: IdRow) {
  return {
    id: r.id,
    listId: r.list_id,
    parentId: (r.parent_id as number | null) ?? null,
    kind: r.kind as EntryKind,
    title: r.title as string,
    body: r.body as string,
    status: r.status as string,
    priority: r.priority as string,
    dueAt: (r.due_at as number | null) ?? null,
    tags: parse<string[]>(r.tags, []),
    checklist: parse<{ id: string; text: string; done: boolean }[]>(r.checklist, []),
    fields: parse<Record<string, unknown>>(r.fields, {}),
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at ?? null,
  }
}

function loadList(id: number): IdRow {
  const row = db.prepare('SELECT * FROM dev_lists WHERE id = ?').get(id) as IdRow | undefined
  if (!row) throw new HttpError(404, 'List not found')
  return row
}

function loadEntry(id: number): IdRow {
  const row = db.prepare('SELECT * FROM dev_entries WHERE id = ?').get(id) as IdRow | undefined
  if (!row) throw new HttpError(404, 'Entry not found')
  return row
}

/** A list plus every group nested under it. */
function subtreeIds(id: number): number[] {
  const out = [id]
  for (let i = 0; i < out.length; i++) for (const r of db.prepare('SELECT id FROM dev_lists WHERE parent_id = ?').all(out[i]) as { id: number }[]) out.push(r.id)
  return out
}

function isDescendantList(candidate: number, ancestor: number): boolean {
  return subtreeIds(ancestor).includes(candidate)
}

function entryIds(body: unknown): number[] {
  const ids = Array.isArray((body as { ids?: unknown })?.ids) ? ((body as { ids: unknown[] }).ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : []
  if (!ids.length) throw new HttpError(400, 'ids is required')
  return [...new Set(ids)].slice(0, 500)
}

function inputFrom(body: Record<string, unknown>, base?: IdRow): EntryInput {
  const b = base ? entryJson(base) : null
  const pick = <T>(k: string, fallback: T): T => (body[k] !== undefined ? (body[k] as T) : fallback)
  return {
    kind: (body.kind as EntryKind) ?? (b?.kind as EntryKind) ?? 'task',
    title: String(pick('title', b?.title ?? '')),
    body: String(pick('body', b?.body ?? '')),
    status: String(pick('status', b?.status ?? '')),
    priority: String(pick('priority', b?.priority ?? '')),
    dueAt: pick<number | null>('dueAt', b?.dueAt ?? null),
    tags: pick<string[]>('tags', b?.tags ?? []),
    checklist: pick('checklist', b?.checklist ?? []),
    fields: { ...(b?.fields ?? {}), ...((body.fields as Record<string, unknown>) ?? {}) },
  }
}

/* ---------- data types (configured in the control panel only) ---------- */

tasksRouter.get('/types', (_req, res) => {
  res.json({ types: getTypes() })
})

tasksRouter.put(
  '/types',
  wrap((req, res) => {
    const types = saveTypes(req.body?.types ?? req.body)
    recordEvent(req.devSession!.id, 'tasks.types_save', { path: 'settings/devTypes', summary: `Task manager data types saved (${KINDS.map((k) => `${types[k].label}: ${types[k].fields.length} custom field${types[k].fields.length === 1 ? '' : 's'}`).join(', ')})` })
    res.json({ types })
  }),
)

/* ---------- lists & groups ---------- */

tasksRouter.get(
  '/lists',
  wrap((_req, res) => {
    const rows = db.prepare('SELECT * FROM dev_lists ORDER BY sort_order, id').all() as IdRow[]
    res.json({ lists: rows.map(listJson) })
  }),
)

tasksRouter.post(
  '/lists',
  wrap((req, res) => {
    const title = str(req.body?.title, 120).trim() || 'Untitled list'
    const parentId: number | null = req.body?.parentId != null ? num(req.body.parentId) : null
    if (parentId) loadList(parentId)
    const order = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 o FROM dev_lists WHERE parent_id IS ?').get(parentId) as { o: number }).o
    const info = db.prepare('INSERT INTO dev_lists(parent_id, title, color, icon, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(parentId, title, /^#[0-9a-f]{6}$/i.test(str(req.body?.color, 7)) ? str(req.body?.color, 7) : '', str(req.body?.icon, 40), order, now(), now())
    recordEvent(req.devSession!.id, parentId ? 'tasks.group_create' : 'tasks.list_create', { path: `tasks/${info.lastInsertRowid}`, summary: `${parentId ? 'Group' : 'List'} “${title}” created`, detail: { id: info.lastInsertRowid, parentId } })
    res.status(201).json({ list: listJson(loadList(info.lastInsertRowid as number)) })
  }),
)

tasksRouter.put(
  '/lists/:id',
  wrap((req, res) => {
    const row = loadList(Number(req.params.id))
    const b = req.body ?? {}
    const title = b.title != null ? str(b.title, 120).trim() || (row.title as string) : (row.title as string)
    let parentId = row.parent_id as number | null
    if (b.parentId !== undefined) {
      parentId = b.parentId == null ? null : num(b.parentId)
      if (parentId === row.id || (parentId && isDescendantList(parentId, row.id))) throw new HttpError(400, 'A list cannot be moved into itself')
      if (parentId) loadList(parentId)
    }
    const color = b.color !== undefined ? (/^#[0-9a-f]{6}$/i.test(String(b.color)) ? String(b.color) : '') : (row.color as string)
    const icon = b.icon !== undefined ? str(b.icon, 40) : (row.icon as string)
    const sortOrder = b.sortOrder !== undefined ? num(b.sortOrder) : (row.sort_order as number)
    db.prepare('UPDATE dev_lists SET title = ?, parent_id = ?, color = ?, icon = ?, sort_order = ?, updated_at = ? WHERE id = ?').run(title, parentId, color, icon, sortOrder, now(), row.id)
    if (title !== row.title) recordEvent(req.devSession!.id, 'tasks.list_rename', { path: `tasks/${row.id}`, summary: `List “${row.title}” renamed to “${title}”` })
    if (parentId !== (row.parent_id ?? null)) recordEvent(req.devSession!.id, 'tasks.list_move', { path: `tasks/${row.id}`, summary: `List “${title}” moved ${parentId ? `into list #${parentId}` : 'to the top level'}` })
    res.json({ list: listJson(loadList(row.id)) })
  }),
)

tasksRouter.delete(
  '/lists/:id',
  wrap((req, res) => {
    const row = loadList(Number(req.params.id))
    const ids = subtreeIds(row.id)
    const n = (db.prepare(`SELECT COUNT(*) c FROM dev_entries WHERE list_id IN (${ids.map(() => '?').join(',')})`).get(...ids) as { c: number }).c
    db.prepare('DELETE FROM dev_lists WHERE id = ?').run(row.id)
    recordEvent(req.devSession!.id, 'tasks.list_delete', { path: `tasks/${row.id}`, summary: `List “${row.title}” deleted with ${ids.length - 1} group${ids.length === 2 ? '' : 's'} and ${n} entr${n === 1 ? 'y' : 'ies'}`, detail: { groups: ids.length - 1, entries: n } })
    res.json({ ok: true })
  }),
)

tasksRouter.post(
  '/lists/reorder',
  wrap((req, res) => {
    const ids = entryIds(req.body)
    const stmt = db.prepare('UPDATE dev_lists SET sort_order = ? WHERE id = ?')
    ids.forEach((id, i) => stmt.run(i + 1, id))
    res.json({ ok: true })
  }),
)

/** Everything inside a list: its groups and all entries (of the list and its groups). */
tasksRouter.get(
  '/lists/:id/entries',
  wrap((req, res) => {
    const row = loadList(Number(req.params.id))
    const ids = subtreeIds(row.id)
    const q = ids.map(() => '?').join(',')
    const lists = (db.prepare(`SELECT * FROM dev_lists WHERE id IN (${q}) ORDER BY sort_order, id`).all(...ids) as IdRow[]).map(listJson)
    const entries = (db.prepare(`SELECT * FROM dev_entries WHERE list_id IN (${q}) ORDER BY sort_order, id`).all(...ids) as IdRow[]).map(entryJson)
    res.json({ list: listJson(row), lists, entries })
  }),
)

tasksRouter.get(
  '/lists/:id/export.md',
  wrap((req, res) => {
    const row = loadList(Number(req.params.id))
    const ids = subtreeIds(row.id)
    const q = ids.map(() => '?').join(',')
    const lists = db.prepare(`SELECT * FROM dev_lists WHERE id IN (${q}) ORDER BY sort_order, id`).all(...ids) as IdRow[]
    const entries = (db.prepare(`SELECT * FROM dev_entries WHERE list_id IN (${q}) ORDER BY sort_order, id`).all(...ids) as IdRow[]).map(entryJson)
    const lines: string[] = [`# ${row.title}`, '']
    const render = (listId: number, depth: number) => {
      const l = lists.find((x) => x.id === listId)!
      if (depth) lines.push(`${'#'.repeat(Math.min(6, depth + 1))} ${l.title}`, '')
      const items = (parentId: number | null, indent: number) => {
        for (const e of entries.filter((x) => x.listId === listId && x.parentId === parentId)) {
          const box = e.kind === 'note' ? '•' : e.status === 'done' ? '[x]' : '[ ]'
          lines.push(`${'  '.repeat(indent)}- ${box} **${e.title}**${e.kind !== 'note' ? ` _(${e.kind}, ${e.status}, ${e.priority}${e.dueAt ? `, due ${new Date(e.dueAt as number).toISOString().slice(0, 10)}` : ''})_` : ''}${e.tags.length ? ` #${e.tags.join(' #')}` : ''}`)
          if (e.body) lines.push(...String(e.body).split('\n').map((t) => `${'  '.repeat(indent + 1)}${t}`))
          for (const c of e.checklist) lines.push(`${'  '.repeat(indent + 1)}- [${c.done ? 'x' : ' '}] ${c.text}`)
          items(e.id as number, indent + 1)
        }
      }
      items(null, 0)
      lines.push('')
      for (const child of lists.filter((x) => x.parent_id === listId)) render(child.id, depth + 1)
    }
    render(row.id, 0)
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${String(row.title).replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'list'}.md"`)
    res.send(lines.join('\n'))
  }),
)

/* ---------- entries ---------- */

tasksRouter.get(
  '/entries',
  wrap((req, res) => {
    const q = str(req.query.q, 120)
    const kind = str(req.query.kind, 10)
    const status = str(req.query.status, 30)
    const where: string[] = []
    const args: (string | number)[] = []
    if (q) {
      where.push('(title LIKE ? OR body LIKE ? OR tags LIKE ?)')
      args.push(`%${q}%`, `%${q}%`, `%${q}%`)
    }
    if (kind) {
      where.push('kind = ?')
      args.push(kind)
    }
    if (status) {
      where.push('status = ?')
      args.push(status)
    }
    const rows = db.prepare(`SELECT * FROM dev_entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 300`).all(...args) as IdRow[]
    res.json({ entries: rows.map(entryJson) })
  }),
)

tasksRouter.post(
  '/entries',
  wrap((req, res) => {
    const b = req.body ?? {}
    const listId = num(b.listId)
    loadList(listId)
    const parentId: number | null = b.parentId != null ? num(b.parentId) : null
    if (parentId) {
      const parent = loadEntry(parentId)
      if (parent.list_id !== listId) throw new HttpError(400, 'A subtask must live in the same list as its parent')
    }
    const kind = KINDS.includes(b.kind) ? (b.kind as EntryKind) : 'task'
    const types = getTypes()
    const input = inputFrom(b)
    if (!b.status) input.status = types[kind].defaultStatus
    if (!b.priority) input.priority = types[kind].defaultPriority
    const v = validateEntry(kind, input, types)
    if (!v.ok && !b.draft) throw new HttpError(400, v.errors.join('. '))
    const e = v.value
    const order = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 o FROM dev_entries WHERE list_id = ? AND parent_id IS ?').get(listId, parentId) as { o: number }).o
    const info = db
      .prepare('INSERT INTO dev_entries(list_id, parent_id, kind, title, body, status, priority, due_at, tags, checklist, fields, sort_order, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(listId, parentId, kind, e.title || 'Untitled', e.body, e.status, e.priority, e.dueAt, JSON.stringify(e.tags), JSON.stringify(e.checklist), JSON.stringify(e.fields), order, now(), now(), e.status === 'done' ? now() : null)
    recordEvent(req.devSession!.id, 'tasks.entry_create', { path: `tasks/${listId}/${info.lastInsertRowid}`, summary: `${types[kind].label} “${e.title || 'Untitled'}” added${parentId ? ' as a subtask' : ''}`, detail: { id: info.lastInsertRowid, kind, listId, parentId, draft: !v.ok ? v.errors : undefined } })
    res.status(201).json({ entry: entryJson(loadEntry(info.lastInsertRowid as number)), warnings: v.ok ? [] : v.errors })
  }),
)

tasksRouter.put(
  '/entries/:id',
  wrap((req, res) => {
    const row = loadEntry(Number(req.params.id))
    const b = req.body ?? {}
    const kind = KINDS.includes(b.kind) ? (b.kind as EntryKind) : (row.kind as EntryKind)
    const types = getTypes()
    const v = validateEntry(kind, inputFrom(b, row), types)
    if (!v.ok && !b.draft) throw new HttpError(400, v.errors.join('. '))
    const e = v.value
    let listId = row.list_id as number
    let parentId = (row.parent_id as number | null) ?? null
    if (b.listId !== undefined) {
      listId = num(b.listId)
      loadList(listId)
    }
    if (b.parentId !== undefined) {
      parentId = b.parentId == null ? null : num(b.parentId)
      if (parentId === row.id) throw new HttpError(400, 'An entry cannot be its own parent')
      if (parentId) {
        const parent = loadEntry(parentId)
        listId = parent.list_id as number
      }
    }
    const sortOrder = b.sortOrder !== undefined ? num(b.sortOrder) : (row.sort_order as number)
    const completedAt = e.status === 'done' ? ((row.completed_at as number | null) ?? now()) : null
    db.prepare('UPDATE dev_entries SET list_id = ?, parent_id = ?, kind = ?, title = ?, body = ?, status = ?, priority = ?, due_at = ?, tags = ?, checklist = ?, fields = ?, sort_order = ?, updated_at = ?, completed_at = ? WHERE id = ?').run(listId, parentId, kind, e.title || (row.title as string), e.body, e.status, e.priority, e.dueAt, JSON.stringify(e.tags), JSON.stringify(e.checklist), JSON.stringify(e.fields), sortOrder, now(), completedAt, row.id)
    if (listId !== row.list_id) db.prepare('UPDATE dev_entries SET list_id = ? WHERE parent_id = ?').run(listId, row.id)
    const what: string[] = []
    if (e.title !== row.title) what.push(`renamed from “${row.title}”`)
    if (e.status !== row.status) what.push(`status ${row.status} → ${e.status}`)
    if (e.priority !== row.priority) what.push(`priority ${row.priority} → ${e.priority}`)
    if (listId !== row.list_id) what.push(`moved to list #${listId}`)
    if (kind !== row.kind) what.push(`kind ${row.kind} → ${kind}`)
    if (e.body !== row.body) what.push('body edited')
    if (JSON.stringify(e.checklist) !== row.checklist) what.push('checklist edited')
    if (JSON.stringify(e.fields) !== row.fields || JSON.stringify(e.tags) !== row.tags || e.dueAt !== (row.due_at ?? null)) what.push('details edited')
    if (what.length) recordEvent(req.devSession!.id, 'tasks.entry_update', { path: `tasks/${listId}/${row.id}`, summary: `${types[kind].label} “${e.title || row.title}”: ${what.join(', ')}`, detail: { id: row.id, changes: what } })
    res.json({ entry: entryJson(loadEntry(row.id)), warnings: v.ok ? [] : v.errors })
  }),
)

tasksRouter.delete(
  '/entries/:id',
  wrap((req, res) => {
    const row = loadEntry(Number(req.params.id))
    db.prepare('DELETE FROM dev_entries WHERE id = ?').run(row.id)
    recordEvent(req.devSession!.id, 'tasks.entry_delete', { path: `tasks/${row.list_id}/${row.id}`, summary: `${row.kind} “${row.title}” deleted` })
    res.json({ ok: true })
  }),
)

/** Group actions on a selection: delete, move, duplicate, or patch (status/priority/tags/kind). */
tasksRouter.post(
  '/entries/bulk',
  wrap((req, res) => {
    const ids = entryIds(req.body)
    const action = str(req.body?.action, 20)
    const q = ids.map(() => '?').join(',')
    const rows = db.prepare(`SELECT * FROM dev_entries WHERE id IN (${q})`).all(...ids) as IdRow[]
    if (!rows.length) throw new HttpError(404, 'No such entries')
    const titles = rows.map((r) => `“${r.title}”`).slice(0, 5).join(', ') + (rows.length > 5 ? ` and ${rows.length - 5} more` : '')
    const types = getTypes()
    if (action === 'delete') {
      db.prepare(`DELETE FROM dev_entries WHERE id IN (${q})`).run(...ids)
      recordEvent(req.devSession!.id, 'tasks.bulk_delete', { summary: `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} deleted: ${titles}`, detail: { ids } })
      return res.json({ ok: true, count: rows.length })
    }
    if (action === 'move') {
      const listId = num(req.body?.listId)
      loadList(listId)
      const parentId: number | null = req.body?.parentId != null ? num(req.body.parentId) : null
      if (parentId) {
        const parent = loadEntry(parentId)
        if (ids.includes(parentId) || parent.list_id !== listId) throw new HttpError(400, 'Cannot nest a selection under one of its own entries or across lists')
      }
      const base = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) o FROM dev_entries WHERE list_id = ? AND parent_id IS ?').get(listId, parentId) as { o: number }).o
      const stmt = db.prepare('UPDATE dev_entries SET list_id = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?')
      const children = db.prepare('UPDATE dev_entries SET list_id = ? WHERE parent_id = ?')
      rows.forEach((r, i) => {
        stmt.run(listId, parentId, base + i + 1, now(), r.id)
        children.run(listId, r.id)
      })
      const target = loadList(listId)
      recordEvent(req.devSession!.id, 'tasks.bulk_move', { path: `tasks/${listId}`, summary: `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} moved to “${target.title}”${parentId ? ' as subtasks' : ''}: ${titles}`, detail: { ids, listId, parentId } })
      return res.json({ ok: true, count: rows.length })
    }
    if (action === 'duplicate') {
      const stmt = db.prepare('INSERT INTO dev_entries(list_id, parent_id, kind, title, body, status, priority, due_at, tags, checklist, fields, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const created: number[] = []
      for (const r of rows) {
        const info = stmt.run(r.list_id as number, (r.parent_id as number | null) ?? null, r.kind as string, `${r.title} (copy)`, r.body as string, r.status as string, r.priority as string, (r.due_at as number | null) ?? null, r.tags as string, r.checklist as string, r.fields as string, (r.sort_order as number) + 1, now(), now())
        created.push(info.lastInsertRowid as number)
      }
      recordEvent(req.devSession!.id, 'tasks.bulk_duplicate', { summary: `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} duplicated: ${titles}`, detail: { ids, created } })
      return res.json({ ok: true, count: created.length, ids: created })
    }
    if (action === 'patch') {
      const patch = (req.body?.patch ?? {}) as Record<string, unknown>
      const allowed = ['status', 'priority', 'kind', 'dueAt']
      const addTags = Array.isArray(patch.addTags) ? (patch.addTags as unknown[]).map(String) : []
      const removeTags = Array.isArray(patch.removeTags) ? (patch.removeTags as unknown[]).map(String) : []
      const errors: string[] = []
      let count = 0
      for (const r of rows) {
        const kind = allowed.includes('kind') && KINDS.includes(patch.kind as EntryKind) ? (patch.kind as EntryKind) : (r.kind as EntryKind)
        const cur = entryJson(r)
        const next: Record<string, unknown> = { kind }
        for (const k of allowed) if (patch[k] !== undefined && k !== 'kind') next[k] = patch[k]
        if (addTags.length || removeTags.length) next.tags = [...new Set([...cur.tags.filter((t) => !removeTags.includes(t)), ...addTags])]
        const v = validateEntry(kind, inputFrom(next, r), types)
        if (!v.ok) {
          errors.push(`“${r.title}”: ${v.errors.join(', ')}`)
          continue
        }
        const e = v.value
        db.prepare('UPDATE dev_entries SET kind = ?, status = ?, priority = ?, due_at = ?, tags = ?, updated_at = ?, completed_at = ? WHERE id = ?').run(kind, e.status, e.priority, e.dueAt, JSON.stringify(e.tags), now(), e.status === 'done' ? ((r.completed_at as number | null) ?? now()) : null, r.id)
        count++
      }
      recordEvent(req.devSession!.id, 'tasks.bulk_update', { summary: `${count} entr${count === 1 ? 'y' : 'ies'} updated (${Object.keys(patch).join(', ')}): ${titles}`, detail: { ids, patch, errors } })
      return res.json({ ok: errors.length === 0, count, errors })
    }
    throw new HttpError(400, 'Unknown action')
  }),
)

tasksRouter.post(
  '/entries/reorder',
  wrap((req, res) => {
    const ids = entryIds(req.body)
    const stmt = db.prepare('UPDATE dev_entries SET sort_order = ? WHERE id = ?')
    ids.forEach((id, i) => stmt.run(i + 1, id))
    res.json({ ok: true })
  }),
)
