import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, ListTodo, RotateCcw, Save } from 'lucide-react'
import { KINDS, useSaveTaskTypes, useTaskTypes, type CoreRule, type EntryKind, type FieldDef, type FieldType, type TypeDef, type TypeSchema } from '../../../api/tasks'
import { ListEditor } from '../../../components/ListEditor'
import { useUI } from '../../../store/ui'
import { ICONS } from '../../../ui/config'

const CORE: [keyof TypeDef['core'], string, string][] = [
  ['body', 'Body / details', 'Free text (markdown).'],
  ['status', 'Status', 'open, in progress, blocked, done… (list below).'],
  ['priority', 'Priority', 'low, normal, high, urgent… (list below).'],
  ['due', 'Due date', 'A calendar date.'],
  ['tags', 'Tags', 'Free-form labels; also a tree root.'],
  ['checklist', 'Checklist', 'Tickable items inside the entry.'],
  ['subtasks', 'Subtasks', 'Nested entries under this one.'],
]
const FIELD_TYPES: [FieldType, string][] = [
  ['text', 'Short text'],
  ['textarea', 'Long text'],
  ['number', 'Number'],
  ['date', 'Date'],
  ['select', 'Choice (options)'],
  ['checkbox', 'Yes / no'],
  ['url', 'Link'],
  ['tags', 'Tag list'],
]

/** Control-panel tab: what notes, to-dos and tasks must and may contain. The workspace itself cannot change this. */
export function TasksSettingsPage() {
  const notify = useUI((s) => s.notify)
  const { data } = useTaskTypes()
  const save = useSaveTaskTypes()
  const [draft, setDraft] = useState<TypeSchema | null>(null)
  const [kind, setKind] = useState<EntryKind>('task')
  useEffect(() => {
    if (data && !draft) setDraft(data)
  }, [data, draft])
  if (!draft) return null
  const t = draft[kind]
  const setT = (patch: Partial<TypeDef>) => setDraft({ ...draft, [kind]: { ...t, ...patch } })
  const dirty = JSON.stringify(draft) !== JSON.stringify(data)
  const list = (s: string) => s.split(',').map((x) => x.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')).filter(Boolean)

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="eyebrow">Developer</div>
          <h1 style={{ margin: 0 }}>Task manager</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Define what a note, a to-do and a task must and may contain. These rules are enforced when entries are saved and can only be changed here, never from the workspace.</p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Link to="/dev/tasks/workspace" className="btn primary sm">
            <ListTodo size={13} /> Open the task workspace <ExternalLink size={11} />
          </Link>
          <button className="btn ghost sm" onClick={() => setDraft(data!)} disabled={!dirty}>
            <RotateCcw size={13} /> Discard
          </button>
          <button className="btn primary sm" onClick={() => save.mutate(draft, { onSuccess: () => notify('Data types saved', 'success'), onError: (e: Error) => notify(e.message, 'error') })} disabled={!dirty || save.isPending}>
            <Save size={13} /> Save data types
          </button>
        </div>
      </div>

      <div className="feed-tabs">
        {KINDS.map((k) => (
          <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            {draft[k].label}
          </button>
        ))}
      </div>

      <section className="card stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>Identity</h3>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="field">
            <label>Label</label>
            <input className="input" value={t.label} onChange={(e) => setT({ label: e.target.value })} maxLength={30} />
          </div>
          <div className="field">
            <label>Icon</label>
            <select className="select" value={t.icon} onChange={(e) => setT({ icon: e.target.value })}>
              {['StickyNote', 'ListChecks', 'CircleDot', ...Object.keys(ICONS)].filter((v, i, a) => a.indexOf(v) === i).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Colour</label>
            <input className="input" type="color" value={t.color} onChange={(e) => setT({ color: e.target.value })} style={{ width: 70, padding: 2 }} />
          </div>
        </div>
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>Core parts</h3>
        <p className="muted small" style={{ margin: 0 }}>Required parts block saving until filled (drafts are flagged); hidden parts do not appear at all.</p>
        <div className="switch-grid">
          {CORE.map(([k, label, hint]) => (
            <label key={k} className="checkbox between" title={hint}>
              <span>
                {label} <em className="muted small">{hint}</em>
              </span>
              <select className="select sm" value={t.core[k]} onChange={(e) => setT({ core: { ...t.core, [k]: e.target.value as CoreRule } })} style={{ width: 120 }}>
                <option value="required">required</option>
                <option value="optional">optional</option>
                <option value="hidden">hidden</option>
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>Statuses & priorities</h3>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="field grow">
            <label>Statuses (comma separated; “done” completes an entry)</label>
            <input className="input" value={t.statuses.join(', ')} onChange={(e) => setT({ statuses: list(e.target.value) })} />
          </div>
          <div className="field">
            <label>Default status</label>
            <select className="select" value={t.defaultStatus} onChange={(e) => setT({ defaultStatus: e.target.value })}>
              {t.statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="field grow">
            <label>Priorities (comma separated)</label>
            <input className="input" value={t.priorities.join(', ')} onChange={(e) => setT({ priorities: list(e.target.value) })} />
          </div>
          <div className="field">
            <label>Default priority</label>
            <select className="select" value={t.defaultPriority} onChange={(e) => setT({ defaultPriority: e.target.value })}>
              {t.priorities.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <h3 style={{ margin: 0 }}>Custom fields</h3>
        <p className="muted small" style={{ margin: 0 }}>Extra data every {t.label.toLowerCase()} can carry. “Show in grid” adds a column to the grid view.</p>
        <ListEditor<FieldDef & { id: string }>
          items={t.fields.map((f, i) => ({ ...f, id: `f${i}` }))}
          onChange={(items) => setT({ fields: items.map(({ id: _id, ...f }) => f) })}
          create={() => ({ id: `f${t.fields.length}`, key: `field_${t.fields.length + 1}`, label: 'New field', type: 'text', required: false, options: [], placeholder: '', showInGrid: false })}
          addLabel="Add field"
          summary={(f) => (
            <>
              <strong>{f.label}</strong> <span className="muted small">{f.key}</span> <span className="chip">{FIELD_TYPES.find(([v]) => v === f.type)?.[1]}</span>
              {f.required && <span className="chip warn">required</span>}
            </>
          )}
          renderItem={(f, u) => (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div className="field grow">
                  <label>Label</label>
                  <input className="input" value={f.label} onChange={(e) => u({ label: e.target.value })} maxLength={40} />
                </div>
                <div className="field">
                  <label>Key</label>
                  <input className="input" value={f.key} onChange={(e) => u({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, '_') })} maxLength={32} />
                </div>
                <div className="field">
                  <label>Type</label>
                  <select className="select" value={f.type} onChange={(e) => u({ type: e.target.value as FieldType })}>
                    {FIELD_TYPES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field grow">
                  <label>Placeholder / hint</label>
                  <input className="input" value={f.placeholder} onChange={(e) => u({ placeholder: e.target.value })} maxLength={80} />
                </div>
              </div>
              {f.type === 'select' && (
                <div className="field">
                  <label>Options (comma separated)</label>
                  <input className="input" value={f.options.join(', ')} onChange={(e) => u({ options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                </div>
              )}
              <div className="row" style={{ gap: 16 }}>
                <label className="checkbox">
                  <input type="checkbox" checked={f.required} onChange={(e) => u({ required: e.target.checked })} /> Required
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={f.showInGrid} onChange={(e) => u({ showInGrid: e.target.checked })} /> Show in grid
                </label>
              </div>
            </div>
          )}
        />
      </section>
    </div>
  )
}
