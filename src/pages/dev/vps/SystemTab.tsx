import { useState } from 'react'
import { Clock, Package, Power, RefreshCw, Save, ScrollText } from 'lucide-react'
import { useVps } from '../../../api/vps'
import { Busy, Out, useAction, useVpsCtx } from './common'

interface Service { unit: string; load: string; active: string; sub: string }

/** systemd services, journal, packages, crontab, reboot. */
export function SystemTab() {
  const { p } = useVpsCtx()
  const services = useVps<{ services: Service[] }>(p('/services'))
  const cron = useVps<{ crontab: string }>(p('/cron'))
  const [unit, setUnit] = useState('')
  const [lines, setLines] = useState(200)
  const [showJournal, setShowJournal] = useState(false)
  const journal = useVps<{ logs: string }>(showJournal ? p(`/journal?unit=${encodeURIComponent(unit)}&lines=${lines}`) : null)
  const { run, out, busy } = useAction()
  const [filter, setFilter] = useState('')
  const [crontab, setCrontab] = useState<string | null>(null)
  const list = (services.data?.services ?? []).filter((s) => !filter || s.unit.includes(filter))
  const important = ['docker.service', 'ssh.service', 'sshd.service', 'fail2ban.service', 'ufw.service', 'cron.service', 'coolify.service']
  return (
    <div className="stack" style={{ gap: 12 }} data-vps-system="">
      <div className="vps-grid-2">
        <section className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>Services</h3>
            <div className="row" style={{ gap: 4 }}>
              <input className="input sm" placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 140 }} aria-label="Filter services" />
              <button className="btn ghost sm" onClick={() => services.refetch()}>
                <RefreshCw size={12} />
              </button>
            </div>
          </div>
          <div className="table-card" style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="table compact">
              <tbody>
                {[...list].sort((a, b) => Number(important.includes(b.unit)) - Number(important.includes(a.unit)) || a.unit.localeCompare(b.unit)).map((s) => (
                  <tr key={s.unit}>
                    <td className="mono small">{s.unit}</td>
                    <td>
                      <span className={`chip ${s.active === 'active' ? 'st-done' : s.active === 'failed' ? 'st-blocked' : ''}`}>
                        {s.active}/{s.sub}
                      </span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                        {['start', 'stop', 'restart', 'enable', 'disable'].map((a) => (
                          <button key={a} className={`btn ghost sm ${a === 'stop' || a === 'disable' ? 'danger' : ''}`} disabled={busy !== ''} onClick={() => run({ path: `/services/${encodeURIComponent(s.unit)}/${a}`, label: `${a} ${s.unit}`, confirm: a === 'stop' && /docker|ssh/.test(s.unit) ? `Stop ${s.unit}? That can take the site (or your access) down.` : undefined, invalidate: ['/services'], key: `${s.unit}:${a}` })}>
                            <Busy on={busy === `${s.unit}:${a}`}>{a}</Busy>
                          </button>
                        ))}
                        <button className="btn ghost sm" onClick={() => { setUnit(s.unit); setShowJournal(true) }}>
                          logs
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="stack" style={{ gap: 12 }}>
          <section className="card stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>
              <Package size={16} /> Packages
            </h3>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm" disabled={busy !== ''} onClick={() => run({ path: '/apt/update', label: 'Package lists refreshed', invalidate: ['/system'], key: 'apt' })}>
                <Busy on={busy === 'apt'}>apt update</Busy>
              </button>
              <button className="btn primary sm" disabled={busy !== ''} onClick={() => run({ path: '/apt/upgrade', label: 'Packages upgraded', confirm: 'Upgrade all packages now? Services may restart; a kernel update needs a reboot afterwards.', invalidate: ['/system'], key: 'apt' })}>
                apt upgrade
              </button>
              <button className="btn sm" disabled={busy !== ''} onClick={() => run({ path: '/apt/autoremove', label: 'Unused packages removed', invalidate: ['/system'], key: 'apt' })}>
                autoremove
              </button>
              <span className="grow" />
              <button className="btn sm danger" disabled={busy !== ''} onClick={() => run({ path: '/reboot', label: 'Reboot requested', confirm: 'Reboot the VPS now? Containers come back with their restart policy; expect a minute of downtime.' })}>
                <Power size={12} /> Reboot
              </button>
            </div>
          </section>
          <section className="card stack" style={{ gap: 8 }}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>
                <Clock size={16} /> Crontab (root)
              </h3>
              <button className="btn primary sm" disabled={crontab == null || busy !== ''} onClick={async () => { const r = await run({ method: 'PUT', path: '/cron', body: { content: crontab }, label: 'Crontab saved', invalidate: ['/cron'] }); if (r?.ok) setCrontab(null) }}>
                <Save size={12} /> Save
              </button>
            </div>
            <textarea className="textarea mono" rows={8} value={crontab ?? cron.data?.crontab ?? ''} onChange={(e) => setCrontab(e.target.value)} spellCheck={false} placeholder="# m h dom mon dow command&#10;0 3 * * * /opt/xgallery/deploy/backup.sh" aria-label="Crontab" />
          </section>
        </div>
      </div>
      <section className="card stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>
            <ScrollText size={16} /> Journal
          </h3>
          <input className="input sm mono" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unit (empty = everything)" style={{ width: 220 }} aria-label="Journal unit" />
          <select className="select sm" value={lines} onChange={(e) => setLines(Number(e.target.value))} aria-label="Lines">
            {[100, 200, 500, 2000].map((n) => (
              <option key={n} value={n}>
                {n} lines
              </option>
            ))}
          </select>
          <button className="btn sm" onClick={() => { setShowJournal(true); journal.refetch() }}>
            Show
          </button>
        </div>
        {showJournal && <pre className="vps-pre tall">{journal.data?.logs ?? (journal.isLoading ? 'Loading…' : '')}</pre>}
      </section>
      {out && <Out out={out} title="Last action" />}
    </div>
  )
}
