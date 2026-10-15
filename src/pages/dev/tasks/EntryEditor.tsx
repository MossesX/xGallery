import { useEffect, useState } from 'react'
import { Check, Eye, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { ChecklistItem, Entry, EntryKind, FieldDef, TypeSchema } from '../../../api/tasks'
import { KINDS, useTaskMutations } from '../../../api/tasks'
import { Markdown } from '../../../components/Markdown'
import { useUI } from '../../../store/ui'
import { fmtDue, humanStatus, KindIcon, StatusIcon } from './common'

interface Props {
  entry: Entry
  types: TypeSchema
  subtasks?: Entry[]
  compact?: boolean
  onOpenSubtask?: (id: number) => void
  onAddSubtask?: () => void
}

const toDateInput = (ts: number | null) => (ts ? new Date(ts).toISOString().slice(0, 10) : '')
const fromDateInput = (s: string) => (s ? new Date(`${s}T12:00:00`).getTime() : null)

function FieldInput({ f, value, onChange }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  switch (f.type) {
    case 'textarea':
      return <textarea className="textarea" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} style={{ minHeight: 70 }} />
    case 'number':
      return <input className="input" type="number" value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} placeholder={f.placeholder} />
    case 'date':
      return <input className="input" type="date" value={toDateInput(typeof value === 'number' ? value : null)} onChange={(e) => onChange(fromDateInput(e.target.value))} />
    case 'select':
      return (
        <select className="select" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    case 'checkbox':
      return (
        <label className="checkbox">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {f.placeholder || 'Yes'}
        </label>
      )
    case 'tags':
      return <input className="input" value={Array.isArray(value) ? (value as string[]).join(', ') : String(value ?? '')} onChange={(e) => onChange(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} placeholder={f.placeholder || 'comma, separated'} />
    default:
      return <input className="input" type={f.type === 'url' ? 'url' : 'text'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />
  }
}

/** Edits one entry according to its type's rules; saves on blur, Enter (title) or the Save button. */
export function EntryEditor({ entry, types, subtasks = [], compact, onOpenSubtask, onAddSubtask }: Props) {
  const notify = useUI((s) => s.notify)
  const { updateEntry, deleteEntry, bulk } = useTaskMutations()
  const [draft, setDraft] = useState<Entry>(entry)
  const [preview, setPreview] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  useEffect(() => {
    setDraft(entry)
    setErrors([])
  }, [entry])
  const t = types[draft.kind]
  const dirty = JSON.stringify(draft) !== JSON.stringify(entry)

  const save = (patch: Partial<Entry> = {}) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    updateEntry.mutate(
      { ...next, id: entry.id },
      {
        onSuccess: (r) => setErrors(r.warnings),
        onError: (e: Error) => {
          setErrors(e.message.split('. '))
          notify(e.message, 'error')
        },
      },
    )
  }
  const set = <K extends keyof Entry>(k: K, v: Entry[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const setField = (k: string, v: unknown) => setDraft((d) => ({ ...d, fields: { ...d.fields, [k]: v } }))
  const setCheck = (items: ChecklistItem[]) => setDraft((d) => ({ ...d, checklist: items }))
  const rule = t.core
  const doneCount = draft.checklist.filter((c) => c.done).length

  return (
    <div className={`entry-editor ${compact ? 'compact' : ''}`} data-entry-editor={entry.id}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="select sm" value={draft.kind} onChange={(e) => save({ kind: e.target.value as EntryKind })} aria-label="Kind" title="Kind">
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {types[k].label}
            </option>
          ))}
        </select>
        <KindIcon kind={draft.kind} types={types} size={15} />
        <input
          className="input entry-title"
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          onBlur={() => dirty && save()}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Title"
          aria-label="Title"
        />
        {rule.status !== 'hidden' && (
          <button className={`btn sm ${draft.status === 'done' ? 'success' : ''}`} onClick={() => save({ status: draft.status === 'done' ? t.defaultStatus : 'done' })} title={draft.status === 'done' ? 'Reopen' : 'Mark done'}>
            <StatusIcon status={draft.status} /> {draft.status === 'done' ? 'Done' : 'Mark done'}
          </button>
        )}
        <button className="btn ghost icon sm danger" title="Delete entry" onClick={() => confirm(`Delete “${entry.title}”${subtasks.length ? ` and its ${subtasks.length} subtask(s)` : ''}?`) && deleteEntry.mutate(entry.id)}>
          <Trash2 size={13} />
        </button>
      </div>

      {errors.length > 0 && (
        <div className="error small" role="alert">
          {errors.join('. ')}
        </div>
      )}

      <div className="entry-meta-grid">
        {rule.status !== 'hidden' && (
          <label className="field">
            <span>Status{rule.status === 'required' ? ' *' : ''}</span>
            <select className="select sm" value={draft.status} onChange={(e) => save({ status: e.target.value })}>
              {t.statuses.map((s) => (
                <option key={s} value={s}>
                  {humanStatus(s)}
                </option>
              ))}
            </select>
          </label>
        )}
        {rule.priority !== 'hidden' && (
          <label className="field">
            <span>Priority{rule.priority === 'required' ? ' *' : ''}</span>
            <select className="select sm" value={draft.priority} onChange={(e) => save({ priority: e.target.value })}>
              {t.priorities.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
        {rule.due !== 'hidden' && (
          <label className="field">
            <span>
              Due{rule.due === 'required' ? ' *' : ''} {draft.dueAt ? <em className="muted small">{fmtDue(draft.dueAt)}</em> : null}
            </span>
            <input className="input sm" type="date" value={toDateInput(draft.dueAt)} onChange={(e) => save({ dueAt: fromDateInput(e.target.value) })} />
          </label>
        )}
        {rule.tags !== 'hidden' && (
          <label className="field">
            <span>Tags{rule.tags === 'required' ? ' *' : ''}</span>
            <input className="input sm" value={draft.tags.join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))} onBlur={() => dirty && save()} placeholder="comma, separated" />
          </label>
        )}
        {t.fields.map((f) => (
          <label className="field" key={f.key}>
            <span>
              {f.label}
              {f.required ? ' *' : ''}
            </span>
            <span onBlur={() => dirty && save()}>
              <FieldInput f={f} value={draft.fields[f.key]} onChange={(v) => setField(f.key, v)} />
            </span>
          </label>
        ))}
      </div>

      {rule.body !== 'hidden' && (
        <div className="field">
          <span className="row between">
            <span>
              {draft.kind === 'note' ? 'Note' : 'Details'}
              {rule.body === 'required' ? ' *' : ''} <em className="muted small">markdown</em>
            </span>
            <button className="btn ghost sm" onClick={() => setPreview((v) => !v)}>
              {preview ? <Pencil size={12} /> : <Eye size={12} />} {preview ? 'Edit' : 'Preview'}
            </button>
          </span>
          {preview ? <div className="entry-body-preview">{draft.body ? <Markdown text={draft.body} /> : <span className="muted small">Nothing written yet.</span>}</div> : <textarea className="textarea entry-body" value={draft.body} onChange={(e) => set('body', e.target.value)} onBlur={() => dirty && save()} placeholder={draft.kind === 'note' ? 'Write your note…' : 'Details, links, steps…'} style={{ minHeight: compact ? 90 : 160 }} />}
        </div>
      )}

      {rule.checklist !== 'hidden' && (
        <div className="field">
          <span>
            Checklist{rule.checklist === 'required' ? ' *' : ''} <em className="muted small">{draft.checklist.length ? `${doneCount}/${draft.checklist.length} done` : ''}</em>
          </span>
          <div className="checklist">
            {draft.checklist.map((c, i) => (
              <div key={c.id} className={`check-row ${c.done ? 'done' : ''}`}>
                <input type="checkbox" checked={c.done} onChange={(e) => { const items = draft.checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)); setCheck(items); save({ checklist: items }) }} aria-label={`Done: ${c.text}`} />
                <input className="input sm grow" value={c.text} onChange={(e) => setCheck(draft.checklist.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} onBlur={() => dirty && save()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const items = [...draft.checklist]; items.splice(i + 1, 0, { id: `c${Date.now()}`, text: '', done: false }); setCheck(items) } }} />
                <button className="btn ghost icon sm" title="Remove item" onClick={() => { const items = draft.checklist.filter((_, j) => j !== i); setCheck(items); save({ checklist: items }) }}>
                  <X size={12} />
                </button>
              </div>
            ))}
            <button className="btn ghost sm" onClick={() => setCheck([...draft.checklist, { id: `c${Date.now()}`, text: '', done: false }])}>
              <Plus size={12} /> Add item
            </button>
          </div>
        </div>
      )}

      {rule.subtasks !== 'hidden' && (
        <div className="field">
          <span className="row between">
            <span>Subtasks {subtasks.length ? <em className="muted small">{subtasks.filter((s) => s.status === 'done').length}/{subtasks.length} done</em> : null}</span>
            {onAddSubtask && (
              <button className="btn ghost sm" onClick={onAddSubtask}>
                <Plus size={12} /> Add subtask
              </button>
            )}
          </span>
          <div className="subtask-list">
            {subtasks.map((s) => (
              <div key={s.id} className={`subtask-row ${s.status === 'done' ? 'done' : ''}`}>
                <input type="checkbox" checked={s.status === 'done'} onChange={(e) => bulk.mutate({ ids: [s.id], action: 'patch', patch: { status: e.target.checked ? 'done' : types[s.kind].defaultStatus } })} aria-label={`Done: ${s.title}`} />
                <button className="link-btn grow" onClick={() => onOpenSubtask?.(s.id)}>
                  <KindIcon kind={s.kind} types={types} size={12} /> {s.title}
                </button>
                <span className="muted small">{humanStatus(s.status)}</span>
              </div>
            ))}
            {subtasks.length === 0 && <span className="muted small">No subtasks.</span>}
          </div>
        </div>
      )}

      <div className="row between entry-foot">
        <span className="muted small">
          #{entry.id} · created {new Date(entry.createdAt).toLocaleDateString()} · updated {new Date(entry.updatedAt).toLocaleString()}
          {entry.completedAt ? ` · completed ${new Date(entry.completedAt).toLocaleDateString()}` : ''}
        </span>
        <button className="btn primary sm" onClick={() => save()} disabled={!dirty || updateEntry.isPending}>
          <Check size={12} /> Save
        </button>
      </div>
    </div>
  )
}
