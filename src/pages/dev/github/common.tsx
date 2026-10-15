import { useCallback, useState } from 'react'
import { useGhCall, type GhCall } from '../../../api/github'
import { useUI } from '../../../store/ui'

export { Busy, Dialog, Kv, Out, relTime } from '../vps/common'

/** Run GitHub actions with a toast and an optional confirm; keeps the last result. */
export function useGhAction() {
  const notify = useUI((s) => s.notify)
  const call = useGhCall<Record<string, unknown>>()
  const [busy, setBusy] = useState('')
  const [last, setLast] = useState<Record<string, unknown> | null>(null)
  const run = useCallback(
    async (c: GhCall & { label?: string; confirm?: string; key?: string; quiet?: boolean }) => {
      if (c.confirm && !window.confirm(c.confirm)) return null
      setBusy(c.key ?? c.path)
      try {
        const r = await call.mutateAsync(c)
        setLast(r)
        if (!c.quiet) notify(c.label ?? 'Done', 'success')
        return r
      } catch (e) {
        notify((e as Error).message, 'error')
        return null
      } finally {
        setBusy('')
      }
    },
    [call, notify],
  )
  return { run, busy, last }
}

export function RunChip({ status, conclusion }: { status: string; conclusion: string | null }) {
  const c = status !== 'completed' ? 'st-in_progress' : conclusion === 'success' ? 'st-done' : conclusion === 'cancelled' || conclusion === 'skipped' ? '' : 'st-blocked'
  return <span className={`chip ${c}`}>{status !== 'completed' ? status.replace('_', ' ') : (conclusion ?? 'done')}</span>
}

export function StateChip({ state, merged, draft }: { state: string; merged?: boolean; draft?: boolean }) {
  return <span className={`chip ${merged ? 'prio-high' : draft ? '' : state === 'open' ? 'st-done' : 'st-blocked'}`}>{merged ? 'merged' : draft ? 'draft' : state}</span>
}

/** Minimal markdown-ish body: paragraphs and code fences only, no HTML. */
export function Body({ text }: { text: string }) {
  if (!text) return <p className="muted small">No description.</p>
  const parts = text.split(/```/)
  return (
    <div className="gh-body">
      {parts.map((p, i) => (i % 2 ? <pre key={i} className="vps-pre">{p.replace(/^\w+\n/, '')}</pre> : <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{p}</p>))}
    </div>
  )
}

/** Unified diff with coloured lines. */
export function Patch({ patch }: { patch: string }) {
  if (!patch) return <p className="muted small">Binary or too large to show.</p>
  return (
    <pre className="gh-patch">
      {patch.split('\n').map((l, i) => (
        <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>
          {l || ' '}
        </div>
      ))}
    </pre>
  )
}

export function Files({ files }: { files: { filename: string; status: string; additions: number; deletions: number; patch: string }[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (f: string) => setOpen((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n })
  return (
    <div className="stack" style={{ gap: 4 }}>
      {files.map((f) => (
        <div key={f.filename} className="gh-file">
          <button className="gh-file-head" onClick={() => toggle(f.filename)}>
            <span className={`chip changed-${f.status === 'added' ? 'A' : f.status === 'removed' ? 'D' : 'M'}`}>{f.status[0]?.toUpperCase()}</span>
            <span className="mono small grow" style={{ textAlign: 'left' }}>{f.filename}</span>
            <span className="small" style={{ color: 'var(--c-success)' }}>+{f.additions}</span>
            <span className="small" style={{ color: '#ef4444' }}>−{f.deletions}</span>
          </button>
          {open.has(f.filename) && <Patch patch={f.patch} />}
        </div>
      ))}
    </div>
  )
}
