import { useState } from 'react'
import { Plus, RefreshCw, Shield, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react'
import { useVps, type ExecOut } from '../../../api/vps'
import { Busy, Out, useAction, useVpsCtx } from './common'

interface HRule { id: number; action?: string; protocol: string; port: string; source: string; source_detail: string }
interface HFirewall { id: number; name: string; synced?: boolean; rules?: HRule[]; is_synced?: boolean }

const PRESETS = [
  ['SSH', 'TCP', '22'],
  ['HTTP', 'TCP', '80'],
  ['HTTPS', 'TCP', '443'],
  ['mosh', 'UDP', '60000-61000'],
  ['Coolify', 'TCP', '8000'],
] as const

/** Hostinger's network firewall (in front of the VM) and ufw on the VM itself. */
export function FirewallTab() {
  const { p, hasToken } = useVpsCtx()
  const ufw = useVps<ExecOut & { installed: boolean }>(p('/ufw'))
  const fws = useVps<{ firewalls: HFirewall[] | { data?: HFirewall[] } }>(hasToken ? '/h/firewalls' : null)
  const { run, out, busy } = useAction()
  const [rule, setRule] = useState('allow 8080/tcp')
  const [hr, setHr] = useState({ protocol: 'TCP', port: '443', source: 'any', source_detail: 'any' })
  const list: HFirewall[] = Array.isArray(fws.data?.firewalls) ? fws.data!.firewalls : ((fws.data?.firewalls as { data?: HFirewall[] } | undefined)?.data ?? [])
  const [sel, setSel] = useState<number | null>(null)
  const fw = useVps<{ firewall: HFirewall }>(sel != null ? `/h/firewalls/${sel}` : null)
  const cur = fw.data?.firewall ?? list[0]
  const curId = sel ?? list[0]?.id
  return (
    <div className="stack" style={{ gap: 12 }} data-vps-firewall="">
      <div className="vps-grid-2">
        <section className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>
              <Shield size={16} /> Hostinger firewall
            </h3>
            {hasToken && (
              <div className="row" style={{ gap: 4 }}>
                {list.length > 1 && (
                  <select className="select sm" value={curId ?? ''} onChange={(e) => setSel(Number(e.target.value))} aria-label="Firewall">
                    {list.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                )}
                <button className="btn ghost sm" onClick={() => run({ path: '/h/firewalls', noProfile: true, body: { name: window.prompt('Firewall name', 'xgallery') ?? '' }, label: 'Firewall created', invalidate: ['/h/firewalls'] })}>
                  <Plus size={12} /> New
                </button>
              </div>
            )}
          </div>
          {!hasToken && <p className="muted small">Needs a Hostinger API token.</p>}
          {fws.error && <p className="muted small">{(fws.error as Error).message}</p>}
          {cur && (
            <>
              <div className="row" style={{ gap: 4 }}>
                <span className="chip">{cur.name}</span>
                <span className={`chip ${cur.synced || cur.is_synced ? 'st-done' : 'prio-high'}`}>{cur.synced || cur.is_synced ? 'synced to the VM' : 'not synced'}</span>
                <span className="grow" />
                <button className="btn sm" disabled={busy !== ''} onClick={() => run({ path: `/h/firewalls/${curId}/activate`, noProfile: true, label: 'Firewall activated on the VM', invalidate: ['/h/firewalls'] })}>
                  <ShieldCheck size={12} /> Activate
                </button>
                <button className="btn sm" disabled={busy !== ''} onClick={() => run({ path: `/h/firewalls/${curId}/sync`, noProfile: true, label: 'Firewall synced', invalidate: ['/h/firewalls'] })}>
                  Sync
                </button>
                <button className="btn sm danger" disabled={busy !== ''} onClick={() => run({ path: `/h/firewalls/${curId}/deactivate`, noProfile: true, label: 'Firewall deactivated', confirm: 'Deactivate the Hostinger firewall on the VM? Only ufw on the VM protects it afterwards.', invalidate: ['/h/firewalls'] })}>
                  <ShieldOff size={12} /> Deactivate
                </button>
              </div>
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Proto</th>
                    <th>Port</th>
                    <th>Source</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(cur.rules ?? []).map((r) => (
                    <tr key={r.id}>
                      <td>{r.action ?? 'accept'}</td>
                      <td>{r.protocol}</td>
                      <td className="mono">{r.port}</td>
                      <td className="mono small">{r.source_detail || r.source}</td>
                      <td>
                        <button className="btn ghost icon sm danger" disabled={busy !== ''} onClick={() => run({ method: 'DELETE', path: `/h/firewalls/${curId}/rules/${r.id}`, noProfile: true, label: 'Rule removed', confirm: `Remove ${r.protocol} ${r.port}? Remember to sync afterwards.`, invalidate: ['/h/firewalls'] })}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row" style={{ gap: 4, alignItems: 'flex-end' }}>
                <select className="select sm" value={hr.protocol} onChange={(e) => setHr({ ...hr, protocol: e.target.value })} aria-label="Protocol">
                  {['TCP', 'UDP', 'ICMP', 'any'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <input className="input sm mono" value={hr.port} onChange={(e) => setHr({ ...hr, port: e.target.value })} placeholder="443 or 60000-61000" style={{ width: 150 }} aria-label="Port" />
                <input className="input sm mono" value={hr.source_detail} onChange={(e) => setHr({ ...hr, source_detail: e.target.value, source: e.target.value === 'any' ? 'any' : 'custom' })} placeholder="any or 1.2.3.4/32" style={{ width: 160 }} aria-label="Source" />
                <button className="btn primary sm" disabled={busy !== ''} onClick={() => run({ path: `/h/firewalls/${curId}/rules`, noProfile: true, body: hr, label: 'Rule added (sync to apply)', invalidate: ['/h/firewalls'] })}>
                  <Plus size={12} /> Add
                </button>
              </div>
              <div className="row" style={{ gap: 4 }}>
                {PRESETS.map(([l, pr, port]) => (
                  <button key={l} className="chip chip-tag" onClick={() => setHr({ protocol: pr, port, source: 'any', source_detail: 'any' })}>
                    {l} {pr} {port}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>ufw on the VM</h3>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn ghost sm" onClick={() => ufw.refetch()}>
                <RefreshCw size={12} />
              </button>
              <button className="btn sm" disabled={busy !== ''} onClick={() => run({ path: '/ufw/enable', label: 'ufw enabled', confirm: 'Enable ufw? Make sure SSH (22) and mosh UDP are allowed first, or you lock yourself out.', invalidate: ['/ufw'] })}>
                Enable
              </button>
              <button className="btn sm" disabled={busy !== ''} onClick={() => run({ path: '/ufw/reload', label: 'ufw reloaded', invalidate: ['/ufw'] })}>
                Reload
              </button>
              <button className="btn sm danger" disabled={busy !== ''} onClick={() => run({ path: '/ufw/disable', label: 'ufw disabled', confirm: 'Disable ufw on the VM?', invalidate: ['/ufw'] })}>
                Disable
              </button>
            </div>
          </div>
          {ufw.data && !ufw.data.installed && <p className="muted small">ufw is not installed on this server (the Hostinger firewall still applies). Install it from the Console: apt-get install -y ufw.</p>}
          <pre className="vps-pre" data-vps-ufw="">{ufw.data ? ufw.data.stdout || ufw.data.stderr : 'Loading…'}</pre>
          <p className="muted small" style={{ margin: 0 }}>Delete a numbered rule by its number from the list above.</p>
          <div className="row" style={{ gap: 4 }}>
            <input className="input sm mono grow" value={rule} onChange={(e) => setRule(e.target.value)} placeholder="allow 8080/tcp · deny from 1.2.3.4 · limit 22/tcp" aria-label="ufw rule" />
            <button className="btn primary sm" disabled={busy !== ''} onClick={() => run({ path: '/ufw/rule', body: { rule }, label: `ufw ${rule}`, invalidate: ['/ufw'] })}>
              <Plus size={12} /> Apply
            </button>
            <button className="btn sm danger" disabled={busy !== ''} onClick={() => { const n = window.prompt('Rule number to delete'); if (n) run({ method: 'DELETE', path: `/ufw/rule/${Number(n)}`, label: `ufw rule ${n} deleted`, invalidate: ['/ufw'] }) }}>
              <Trash2 size={12} /> Delete #
            </button>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {['allow 22/tcp', 'allow 80/tcp', 'allow 443/tcp', 'allow 60000:61000/udp', 'limit 22/tcp', 'default deny incoming'].map((r) => (
              <button key={r} className="chip chip-tag" onClick={() => setRule(r)}>
                {r}
              </button>
            ))}
          </div>
        </section>
      </div>
      {out && <Out out={out} title="Last action" />}
      <Busy on={busy !== ''} />
    </div>
  )
}
