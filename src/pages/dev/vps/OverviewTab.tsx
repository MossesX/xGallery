import { AlertTriangle, Cpu, HardDrive, MemoryStick, Power, RotateCw } from 'lucide-react'
import { fmtKb, fmtMb, useVps, type SystemInfo } from '../../../api/vps'
import { Kv, useAction, useVpsCtx } from './common'

interface Vm {
  id: number
  hostname: string
  state: string
  ipv4?: { address: string }[]
  plan?: string
  cpus?: number
  memory?: number
  disk?: number
  bandwidth?: number
  template?: { name?: string }
  created_at?: string
  firewall_group_id?: number | null
}

function Bar({ pct, warn = 85 }: { pct: number; warn?: number }) {
  return (
    <div className="vps-bar" title={`${pct}%`}>
      <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} className={pct >= warn ? 'hot' : ''} />
    </div>
  )
}

export function OverviewTab() {
  const { p, hasToken } = useVpsCtx()
  const sys = useVps<SystemInfo>(p('/system'), { refetchInterval: 30_000 })
  const vm = useVps<{ vm: Vm }>(hasToken ? '/h/vm' : null, { staleTime: 60_000 })
  const { run, busy } = useAction()
  const s = sys.data
  const memPct = s ? Math.round(((s.mem.totalMb - s.mem.availableMb) / Math.max(1, s.mem.totalMb)) * 100) : 0
  const loadPct = s ? Math.round((s.load[0] / Math.max(1, s.cpu.cores)) * 100) : 0
  return (
    <div className="stack" style={{ gap: 12 }} data-vps-overview="">
      {sys.error && (
        <div className="dev-session-chip warn">
          <AlertTriangle size={12} /> Could not reach the server over SSH: {(sys.error as Error).message}
        </div>
      )}
      {s && (
        <>
          <div className="stats">
            <div className="card stat">
              <div className="eyebrow">
                <Cpu size={11} /> Load · {s.cpu.cores} core{s.cpu.cores === 1 ? '' : 's'}
              </div>
              <div className="value">{s.load[0]?.toFixed(2)}</div>
              <Bar pct={loadPct} />
              <div className="muted small">{s.load.map((x) => x.toFixed(2)).join(' · ')} (1/5/15 min)</div>
            </div>
            <div className="card stat">
              <div className="eyebrow">
                <MemoryStick size={11} /> Memory
              </div>
              <div className="value">{memPct}%</div>
              <Bar pct={memPct} />
              <div className="muted small">
                {fmtMb(s.mem.totalMb - s.mem.availableMb)} of {fmtMb(s.mem.totalMb)} · swap {fmtMb(s.mem.swapUsedMb)}/{fmtMb(s.mem.swapTotalMb)}
              </div>
            </div>
            {s.disks.slice(0, 2).map((d) => (
              <div className="card stat" key={d.mount}>
                <div className="eyebrow">
                  <HardDrive size={11} /> Disk {d.mount}
                </div>
                <div className="value">{d.pct}%</div>
                <Bar pct={d.pct} />
                <div className="muted small">
                  {fmtKb(d.usedKb)} used · {fmtKb(d.availKb)} free of {fmtKb(d.sizeKb)}
                </div>
              </div>
            ))}
            <div className="card stat">
              <div className="eyebrow">Docker {s.docker.version}</div>
              <div className="value">
                {s.docker.running}/{s.docker.total}
              </div>
              <div className="muted small">containers running / total</div>
            </div>
          </div>
          <div className="vps-grid-2">
            <section className="card stack" style={{ gap: 8 }}>
              <h3 style={{ margin: 0 }}>Server</h3>
              <Kv
                items={[
                  ['Host', `${s.host[0] ?? ''} · ${s.ip}`],
                  ['OS', `${s.host[1] ?? ''} · kernel ${s.host[2] ?? ''}`],
                  ['CPU', s.cpu.model || '—'],
                  ['Uptime', s.uptime],
                  ['Time zone', `${s.tz[0] ?? ''} · ${s.tz[1] ?? ''}`],
                  ['Firewall', s.ufw],
                  ['fail2ban', s.fail2ban],
                  ['Updates', s.updates ? <span className="chip prio-high">{s.updates} package{s.updates === 1 ? '' : 's'} upgradable</span> : 'up to date'],
                  ['Reboot', s.rebootRequired ? <span className="chip prio-urgent">reboot required</span> : 'not required'],
                  ['Tools', Object.entries(s.tools).map(([k, v]) => <span key={k} className={`chip ${v && v !== '-' ? 'st-done' : ''}`} title={v}>{k}</span>)],
                ]}
              />
            </section>
            <section className="card stack" style={{ gap: 8 }}>
              <div className="row between">
                <h3 style={{ margin: 0 }}>Hostinger VM</h3>
                {hasToken && vm.data && (
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn ghost sm" disabled={busy !== ''} onClick={() => run({ path: '/h/vm/restart', noProfile: true, label: 'VM restart requested', confirm: 'Restart the whole VPS through Hostinger? Every container goes down for a minute or two.', invalidate: ['/h/vm'] })}>
                      <RotateCw size={12} /> Restart
                    </button>
                    <button className="btn ghost sm danger" disabled={busy !== ''} onClick={() => run({ path: vm.data?.vm.state === 'running' ? '/h/vm/stop' : '/h/vm/start', noProfile: true, label: vm.data?.vm.state === 'running' ? 'VM stop requested' : 'VM start requested', confirm: vm.data?.vm.state === 'running' ? 'Power the VPS off? The site goes offline until you start it again.' : undefined, invalidate: ['/h/vm'] })}>
                      <Power size={12} /> {vm.data.vm.state === 'running' ? 'Stop' : 'Start'}
                    </button>
                  </div>
                )}
              </div>
              {!hasToken && <p className="muted small">Add a Hostinger API token in Settings to see plan, state and power controls here.</p>}
              {vm.error && <p className="muted small">{(vm.error as Error).message}</p>}
              {vm.data && (
                <Kv
                  items={[
                    ['State', <span className={`chip ${vm.data.vm.state === 'running' ? 'st-done' : 'st-blocked'}`}>{vm.data.vm.state}</span>],
                    ['Hostname', vm.data.vm.hostname],
                    ['IPv4', (vm.data.vm.ipv4 ?? []).map((x) => x.address).join(', ') || '—'],
                    ['Plan', `${vm.data.vm.plan ?? ''} · ${vm.data.vm.cpus ?? '?'} vCPU · ${vm.data.vm.memory ? fmtMb(vm.data.vm.memory) : '?'} RAM · ${vm.data.vm.disk ? fmtMb(vm.data.vm.disk) : '?'} disk`],
                    ['Template', vm.data.vm.template?.name ?? '—'],
                    ['VM id', String(vm.data.vm.id)],
                  ]}
                />
              )}
            </section>
          </div>
          <div className="vps-grid-2">
            <section className="card stack" style={{ gap: 8 }}>
              <h3 style={{ margin: 0 }}>Top processes</h3>
              <pre className="vps-pre">{s.top.join('\n')}</pre>
            </section>
            <section className="card stack" style={{ gap: 8 }}>
              <h3 style={{ margin: 0 }}>Listening ports</h3>
              <div className="table-card" style={{ maxHeight: 300, overflow: 'auto' }}>
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Proto</th>
                      <th>Address</th>
                      <th>Process</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.ports.map((x, i) => (
                      <tr key={i}>
                        <td>{x.proto}</td>
                        <td className="mono">{x.addr}</td>
                        <td>{x.proc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
