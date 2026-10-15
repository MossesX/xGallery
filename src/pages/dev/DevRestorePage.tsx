import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Download, GitCommitHorizontal, History, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { api } from '../../api/client'
import { devKeys, useChanges, useCheckpoints, useInvalidateWorkspace, useSnapshots } from '../../api/dev'
import { formatDate } from '../../components/Comments'
import { useUI } from '../../store/ui'

/** Nothing is ever lost: code checkpoints (git) and design snapshots, each restorable in one click. */
export function DevRestorePage() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const invalidateWs = useInvalidateWorkspace()
  const { data: cps } = useCheckpoints()
  const { data: changes } = useChanges()
  const { data: snaps } = useSnapshots()
  const [label, setLabel] = useState('')
  const [snapName, setSnapName] = useState('')

  const invalidateDesign = () => {
    qc.invalidateQueries({ queryKey: devKeys.snapshots })
    qc.invalidateQueries({ queryKey: devKeys.ui })
    qc.invalidateQueries({ queryKey: ['settings'] })
    qc.invalidateQueries({ queryKey: ['themes'] })
    qc.invalidateQueries({ queryKey: devKeys.overview })
    qc.invalidateQueries({ queryKey: devKeys.sessions })
  }
  const err = (e: Error) => notify(e.message, 'error')
  const mkCheckpoint = useMutation({ mutationFn: () => api.post<{ unchanged: boolean }>('/api/dev/checkpoints', { label }), onSuccess: (r) => { setLabel(''); invalidateWs(); notify(r.unchanged ? 'Nothing to checkpoint: the workspace is unchanged' : 'Checkpoint taken', r.unchanged ? 'info' : 'success') }, onError: err })
  const restoreCp = useMutation({ mutationFn: (sha: string) => api.post(`/api/dev/checkpoints/${sha}/restore`, {}), onSuccess: () => { invalidateWs(); notify('Workspace restored to that checkpoint', 'success') }, onError: err })
  const resetWs = useMutation({ mutationFn: () => api.post('/api/dev/workspace/reset', {}), onSuccess: () => { invalidateWs(); notify('Workspace re-seeded from the source snapshot', 'success') }, onError: err })
  const mkSnap = useMutation({ mutationFn: () => api.post('/api/dev/snapshots', { name: snapName }), onSuccess: () => { setSnapName(''); invalidateDesign(); notify('Design snapshot taken', 'success') }, onError: err })
  const restoreSnap = useMutation({ mutationFn: (id: number) => api.post(`/api/dev/snapshots/${id}/restore`, {}), onSuccess: () => { invalidateDesign(); notify('Site design restored', 'success') }, onError: err })
  const delSnap = useMutation({ mutationFn: (id: number) => api.del(`/api/dev/snapshots/${id}`), onSuccess: invalidateDesign, onError: err })
  const factory = useMutation({ mutationFn: () => api.post('/api/dev/ui/reset', {}), onSuccess: () => { invalidateDesign(); notify('Site design reset to factory defaults (a snapshot was taken first)', 'success') }, onError: err })

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div>
        <div className="eyebrow">Developer</div>
        <h1 style={{ margin: 0 }}>Checkpoints & restore</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>Every change is preceded by an automatic checkpoint (code) or snapshot (design). Restoring never deletes history: it adds a new point you can return from.</p>
      </div>

      <section className="card stack" style={{ gap: 12 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>
            <GitCommitHorizontal size={15} /> Source code checkpoints
          </h3>
          <span className="muted small">
            {changes ? `${changes.files.length} file${changes.files.length === 1 ? '' : 's'} differ from snapshot ${changes.sourceVersion}` : ''} · HEAD {cps?.head}
          </span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input grow" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Checkpoint label (e.g. “before menu rework”)" aria-label="Checkpoint label" />
          <button className="btn" onClick={() => mkCheckpoint.mutate()} disabled={mkCheckpoint.isPending}>
            <Camera size={13} /> Take checkpoint
          </button>
          <a className="btn" href="/api/dev/patch">
            <Download size={13} /> Export patch
          </a>
          <Link to="/dev/code" className="btn ghost">
            Review changes
          </Link>
          <button className="btn ghost danger" onClick={() => confirm('Discard every workspace edit and re-seed from the source snapshot? (A checkpoint of the current state stays in the log, but the git history is rebuilt.)') && resetWs.mutate()} disabled={resetWs.isPending}>
            <RotateCcw size={13} /> Reset workspace
          </button>
        </div>
        <div className="dev-list">
          {(cps?.checkpoints ?? []).map((c, i) => (
            <div key={c.sha} className={`dev-list-row ${i === 0 ? 'current' : ''}`} data-sha={c.sha}>
              <code>{c.sha}</code>
              <span className="grow">
                {c.label}
                {c.sha === cps?.root && <span className="chip" style={{ marginLeft: 6 }}>pristine source</span>}
                {i === 0 && <span className="chip" style={{ marginLeft: 6 }}>current</span>}
              </span>
              <span className="muted small">{formatDate(c.at)}</span>
              <button className="btn sm" onClick={() => confirm(`Restore the workspace to ${c.sha} (“${c.label}”)? The current state is checkpointed first.`) && restoreCp.mutate(c.sha)} disabled={i === 0 || restoreCp.isPending}>
                <Undo2 size={12} /> Restore
              </button>
            </div>
          ))}
          {cps && cps.checkpoints.length === 0 && <p className="muted small">No checkpoints yet{cps.head ? '' : ' (git is not available in this container)'}.</p>}
        </div>
      </section>

      <section className="card stack" style={{ gap: 12 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>
            <History size={15} /> Site design snapshots
          </h3>
          <span className="muted small">menus, toolbar, footer, home page, context menu, CSS, switches, appearance, themes</span>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input grow" value={snapName} onChange={(e) => setSnapName(e.target.value)} placeholder="Snapshot name" aria-label="Snapshot name" />
          <button className="btn" onClick={() => mkSnap.mutate()} disabled={mkSnap.isPending}>
            <Camera size={13} /> Take snapshot
          </button>
          <button className="btn ghost danger" onClick={() => confirm('Reset menus, toolbar, footer, home page, CSS, switches and appearance to factory defaults? A snapshot is taken first; themes are kept.') && factory.mutate()} disabled={factory.isPending}>
            <RotateCcw size={13} /> Factory reset design
          </button>
        </div>
        <div className="dev-list">
          {(snaps ?? []).map((s) => (
            <div key={s.id} className="dev-list-row" data-snapshot={s.id}>
              <span className={`chip ${s.kind === 'manual' ? 'chip-tag' : ''}`}>{s.kind}</span>
              <span className="grow">
                {s.name} <span className="muted small">· {s.themes} themes · {Math.round(s.bytes / 1024)} KB</span>
              </span>
              <span className="muted small">{formatDate(s.createdAt)}</span>
              <button className="btn sm" onClick={() => confirm(`Restore the site design from “${s.name}”? The current design is snapshotted first.`) && restoreSnap.mutate(s.id)} disabled={restoreSnap.isPending}>
                <Undo2 size={12} /> Restore
              </button>
              <button className="btn ghost icon sm danger" title="Delete snapshot" onClick={() => confirm('Delete this snapshot?') && delSnap.mutate(s.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {snaps && snaps.length === 0 && <p className="muted small">No snapshots yet. One is taken automatically before every design save.</p>}
        </div>
      </section>
    </div>
  )
}
