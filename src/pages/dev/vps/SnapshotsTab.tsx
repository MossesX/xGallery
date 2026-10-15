import { Camera, History, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { useVps } from '../../../api/vps'
import { Busy, Out, useAction, useVpsCtx } from './common'

interface Snapshot { id?: number; created_at?: string; expires_at?: string; size?: number }
interface Backup { id: number; location?: string; created_at: string }

/** Hostinger snapshot (one per VM) and the automatic backups. */
export function SnapshotsTab() {
  const { hasToken } = useVpsCtx()
  const snap = useVps<{ snapshot: Snapshot | null }>(hasToken ? '/h/snapshot' : null)
  const backups = useVps<{ backups: Backup[] | { data?: Backup[] } }>(hasToken ? '/h/backups' : null)
  const { run, out, busy } = useAction()
  const list: Backup[] = Array.isArray(backups.data?.backups) ? backups.data!.backups : ((backups.data?.backups as { data?: Backup[] } | undefined)?.data ?? [])
  if (!hasToken) return <p className="muted">Snapshots and backups need a Hostinger API token (Settings tab).</p>
  return (
    <div className="stack" style={{ gap: 12 }} data-vps-snapshots="">
      <div className="vps-grid-2">
        <section className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>
              <Camera size={16} /> Snapshot
            </h3>
            <button className="btn ghost sm" onClick={() => snap.refetch()}>
              <RefreshCw size={12} />
            </button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Hostinger keeps one snapshot per VPS (a full disk image, kept 30 days). Take one before risky changes; restoring overwrites the whole disk with it.</p>
          {snap.error && <p className="muted small">{(snap.error as Error).message}</p>}
          {snap.data?.snapshot ? (
            <div className="dev-session-chip">
              Taken {snap.data.snapshot.created_at ?? '?'} · expires {snap.data.snapshot.expires_at ?? '?'}
            </div>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>No snapshot yet.</p>
          )}
          <div className="row" style={{ gap: 4 }}>
            <button className="btn primary sm" disabled={busy !== ''} onClick={() => run({ path: '/h/snapshot', noProfile: true, label: 'Snapshot requested (takes a few minutes)', confirm: snap.data?.snapshot ? 'Replace the existing snapshot with a new one?' : undefined, invalidate: ['/h/snapshot'] })}>
              <Busy on={busy === '/h/snapshot'}>
                <Camera size={12} />
              </Busy>{' '}
              Take snapshot
            </button>
            <button className="btn sm danger" disabled={busy !== '' || !snap.data?.snapshot} onClick={() => run({ path: '/h/snapshot/restore', noProfile: true, label: 'Snapshot restore requested', confirm: 'RESTORE the snapshot? Everything changed on the VPS since it was taken is lost. Type-safe: this cannot be undone.', invalidate: ['/h/snapshot', '/h/vm'] })}>
              <RotateCcw size={12} /> Restore
            </button>
            <button className="btn ghost sm danger" disabled={busy !== '' || !snap.data?.snapshot} onClick={() => run({ method: 'DELETE', path: '/h/snapshot', noProfile: true, label: 'Snapshot deleted', confirm: 'Delete the snapshot?', invalidate: ['/h/snapshot'] })}>
              <Trash2 size={12} />
            </button>
          </div>
        </section>
        <section className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>
              <History size={16} /> Backups
            </h3>
            <button className="btn ghost sm" onClick={() => backups.refetch()}>
              <RefreshCw size={12} />
            </button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Automatic backups from Hostinger (weekly on most plans). Restoring replaces the disk with the backup.</p>
          {backups.error && <p className="muted small">{(backups.error as Error).message}</p>}
          <table className="table compact">
            <tbody>
              {list.map((b) => (
                <tr key={b.id}>
                  <td className="small">{b.created_at}</td>
                  <td className="small muted">{b.location ?? ''}</td>
                  <td>
                    <button className="btn sm danger" disabled={busy !== ''} onClick={() => run({ path: `/h/backups/${b.id}/restore`, noProfile: true, label: 'Backup restore requested', confirm: `RESTORE backup from ${b.created_at}? The VPS disk is replaced with it; everything newer is lost.`, invalidate: ['/h/vm'] })}>
                      <RotateCcw size={12} /> Restore
                    </button>
                  </td>
                </tr>
              ))}
              {backups.data && !list.length && (
                <tr>
                  <td className="muted">No backups listed.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
      <section className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Application-level backups</h3>
        <p className="muted small" style={{ margin: 0 }}>For the gallery's own data (database + media in the data volume) use the Command wizard → "Back up the data volume" recipe, or export the app container under Containers. Snapshots are for the whole machine.</p>
      </section>
      {out && <Out out={{ stdout: JSON.stringify(out, null, 2), stderr: '', code: 0, ok: true, ms: 0 }} title="Hostinger response" />}
    </div>
  )
}
