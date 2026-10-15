import { getSetting, setSetting } from './db.js'

/**
 * The developer task manager's data model rules.
 *
 * Every entry is a note, a todo or a task. What each kind must and may contain (core parts such as
 * body, status, priority, due date, tags, checklist, plus any number of custom fields) is defined
 * by the owner in the developer control panel, never from the workspace itself, and enforced here.
 */

export type EntryKind = 'note' | 'todo' | 'task'
export type CoreRule = 'required' | 'optional' | 'hidden'
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'url' | 'tags'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required: boolean
  options: string[]
  placeholder: string
  showInGrid: boolean
}

export interface TypeDef {
  label: string
  icon: string
  color: string
  core: { body: CoreRule; status: CoreRule; priority: CoreRule; due: CoreRule; tags: CoreRule; checklist: CoreRule; subtasks: CoreRule }
  statuses: string[]
  priorities: string[]
  defaultStatus: string
  defaultPriority: string
  fields: FieldDef[]
}

export type TypeSchema = Record<EntryKind, TypeDef>

export const KINDS: EntryKind[] = ['note', 'todo', 'task']
const STATUSES = ['open', 'in_progress', 'blocked', 'done']
const PRIORITIES = ['low', 'normal', 'high', 'urgent']

export const DEFAULT_TYPES: TypeSchema = {
  note: {
    label: 'Note',
    icon: 'StickyNote',
    color: '#eab308',
    core: { body: 'required', status: 'hidden', priority: 'hidden', due: 'hidden', tags: 'optional', checklist: 'hidden', subtasks: 'hidden' },
    statuses: STATUSES,
    priorities: PRIORITIES,
    defaultStatus: 'open',
    defaultPriority: 'normal',
    fields: [{ key: 'source', label: 'Source / link', type: 'url', required: false, options: [], placeholder: 'https://…', showInGrid: false }],
  },
  todo: {
    label: 'To-do',
    icon: 'ListChecks',
    color: '#3b82f6',
    core: { body: 'optional', status: 'optional', priority: 'optional', due: 'optional', tags: 'optional', checklist: 'required', subtasks: 'hidden' },
    statuses: STATUSES,
    priorities: PRIORITIES,
    defaultStatus: 'open',
    defaultPriority: 'normal',
    fields: [],
  },
  task: {
    label: 'Task',
    icon: 'CircleDot',
    color: '#f97316',
    core: { body: 'optional', status: 'required', priority: 'required', due: 'optional', tags: 'optional', checklist: 'optional', subtasks: 'optional' },
    statuses: STATUSES,
    priorities: PRIORITIES,
    defaultStatus: 'open',
    defaultPriority: 'normal',
    fields: [
      { key: 'estimate', label: 'Estimate (hours)', type: 'number', required: false, options: [], placeholder: '', showInGrid: true },
      { key: 'area', label: 'Area', type: 'select', required: false, options: ['client', 'server', 'design', 'deploy', 'docs'], placeholder: '', showInGrid: true },
    ],
  },
}

const RULES: CoreRule[] = ['required', 'optional', 'hidden']
const FIELD_TYPES: FieldType[] = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'url', 'tags']

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)

export function sanitizeTypes(input: unknown): TypeSchema {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, Record<string, unknown>>
  const out = {} as TypeSchema
  for (const kind of KINDS) {
    const d = DEFAULT_TYPES[kind]
    const t = (o[kind] && typeof o[kind] === 'object' ? o[kind] : {}) as Record<string, unknown>
    const core = (t.core && typeof t.core === 'object' ? t.core : {}) as Record<string, unknown>
    const rule = (k: keyof TypeDef['core']) => (RULES.includes(core[k] as CoreRule) ? (core[k] as CoreRule) : d.core[k])
    const list = (v: unknown, fallback: string[]) => {
      const arr = Array.isArray(v) ? v.map((x) => slug(String(x))).filter(Boolean) : fallback
      return arr.length ? [...new Set(arr)].slice(0, 12) : fallback
    }
    const statuses = list(t.statuses, d.statuses)
    const priorities = list(t.priorities, d.priorities)
    const fields: FieldDef[] = []
    const seen = new Set<string>()
    for (const raw of (Array.isArray(t.fields) ? t.fields : d.fields).slice(0, 24)) {
      const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const label = String(f.label ?? '').slice(0, 40).trim() || 'Field'
      let key = slug(String(f.key ?? '')) || slug(label) || `field_${fields.length + 1}`
      while (seen.has(key)) key += '_2'
      seen.add(key)
      fields.push({
        key,
        label,
        type: FIELD_TYPES.includes(f.type as FieldType) ? (f.type as FieldType) : 'text',
        required: f.required === true,
        options: Array.isArray(f.options) ? f.options.map((x) => String(x).slice(0, 40).trim()).filter(Boolean).slice(0, 30) : [],
        placeholder: String(f.placeholder ?? '').slice(0, 80),
        showInGrid: f.showInGrid === true,
      })
    }
    out[kind] = {
      label: String(t.label ?? d.label).slice(0, 30) || d.label,
      icon: /^[A-Za-z0-9]{0,40}$/.test(String(t.icon ?? '')) ? String(t.icon ?? d.icon) : d.icon,
      color: /^#[0-9a-f]{6}$/i.test(String(t.color)) ? String(t.color) : d.color,
      core: { body: rule('body'), status: rule('status'), priority: rule('priority'), due: rule('due'), tags: rule('tags'), checklist: rule('checklist'), subtasks: rule('subtasks') },
      statuses,
      priorities,
      defaultStatus: statuses.includes(String(t.defaultStatus)) ? String(t.defaultStatus) : statuses[0],
      defaultPriority: priorities.includes(String(t.defaultPriority)) ? String(t.defaultPriority) : priorities.includes('normal') ? 'normal' : priorities[0],
      fields,
    }
  }
  return out
}

export function getTypes(): TypeSchema {
  return sanitizeTypes(getSetting<unknown>('devTypes', {}))
}

export function saveTypes(input: unknown): TypeSchema {
  const t = sanitizeTypes(input)
  setSetting('devTypes', t)
  return t
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface EntryInput {
  kind: EntryKind
  title: string
  body: string
  status: string
  priority: string
  dueAt: number | null
  tags: string[]
  checklist: ChecklistItem[]
  fields: Record<string, unknown>
}

/** Normalise a (partial) entry against its type and report what the rules reject. */
export function validateEntry(kind: EntryKind, e: EntryInput, types: TypeSchema = getTypes()): { ok: boolean; errors: string[]; value: EntryInput } {
  const t = types[kind]
  const errors: string[] = []
  const value: EntryInput = {
    kind,
    title: e.title.trim().slice(0, 200),
    body: t.core.body === 'hidden' ? '' : String(e.body ?? '').slice(0, 50_000),
    status: t.core.status === 'hidden' ? t.defaultStatus : t.statuses.includes(e.status) ? e.status : t.defaultStatus,
    priority: t.core.priority === 'hidden' ? t.defaultPriority : t.priorities.includes(e.priority) ? e.priority : t.defaultPriority,
    dueAt: t.core.due === 'hidden' ? null : e.dueAt != null && Number.isFinite(e.dueAt) ? e.dueAt : null,
    tags: t.core.tags === 'hidden' ? [] : [...new Set((e.tags ?? []).map((x) => String(x).trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 20),
    checklist: t.core.checklist === 'hidden' ? [] : (e.checklist ?? []).slice(0, 200).map((c, i) => ({ id: String(c.id ?? `c${i}`).slice(0, 20), text: String(c.text ?? '').slice(0, 300), done: c.done === true })),
    fields: {},
  }
  if (!value.title) errors.push('A title is required')
  if (t.core.body === 'required' && !value.body.trim()) errors.push(`${t.label}s need a body`)
  if (t.core.due === 'required' && value.dueAt == null) errors.push(`${t.label}s need a due date`)
  if (t.core.tags === 'required' && value.tags.length === 0) errors.push(`${t.label}s need at least one tag`)
  if (t.core.checklist === 'required' && value.checklist.filter((c) => c.text.trim()).length === 0) errors.push(`${t.label}s need at least one checklist item`)
  for (const f of t.fields) {
    const raw = (e.fields ?? {})[f.key]
    let v: unknown = raw
    switch (f.type) {
      case 'number':
        v = raw === '' || raw == null ? null : Number(raw)
        if (v != null && !Number.isFinite(v)) errors.push(`${f.label} must be a number`)
        break
      case 'checkbox':
        v = raw === true
        break
      case 'select':
        v = raw == null || raw === '' ? '' : String(raw)
        if (v && !f.options.includes(v as string)) errors.push(`${f.label}: “${v}” is not one of the allowed options`)
        break
      case 'date':
        v = raw == null || raw === '' ? null : Number(raw)
        if (v != null && !Number.isFinite(v)) errors.push(`${f.label} must be a date`)
        break
      case 'tags':
        v = Array.isArray(raw) ? raw.map((x) => String(x).trim()).filter(Boolean).slice(0, 20) : typeof raw === 'string' ? raw.split(',').map((x) => x.trim()).filter(Boolean) : []
        break
      case 'url':
        v = raw == null ? '' : String(raw).trim().slice(0, 500)
        if (v && !/^(https?:\/\/|mailto:|\/)/i.test(v as string)) errors.push(`${f.label} must be a link`)
        break
      default:
        v = raw == null ? '' : String(raw).slice(0, f.type === 'textarea' ? 10_000 : 500)
    }
    const empty = v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0)
    if (f.required && empty) errors.push(`${f.label} is required`)
    value.fields[f.key] = v
  }
  return { ok: errors.length === 0, errors, value }
}
