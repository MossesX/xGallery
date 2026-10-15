import { useState } from 'react'
import { Activity, Download, FlaskConical, Pause, Play, RefreshCw, RotateCw, ScrollText, Square, Terminal, Trash2, Upload, Zap } from 'lucide-react'
import { fmtBytes, useVps, type Container, type ContainerTest, type ExecOut } from '../../../api/vps'
import { Busy, Dialog, Out, StateChip, relTime, useAction, useVpsCtx } from './common'

type Act = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill' | 'remove'
const ACTS: { a: Act; label: string; icon: typeof Play; danger?: boolean; when: (c: Container) => boolean; confirm?: (c: Container) => string }[] = [
  { a: 'start', label: 'Start', icon: Play, when: (c) => c.state !== 'running' && c.state !== 'paused' },
  { a: 'stop', label: 'Stop', icon: Square, when: (c) => c.state === 'running' || c.state === 'paused', confirm: (c) => `Stop ${c.name}?` },
  { a: 'restart', label: 'Restart', icon: RotateCw, when: () => true },
  { a: 'pause', label: 'Pause', icon: Pause, when: (c) => c.state === 'running' },
  { a: 'unpause', label: 'Unpause', icon: Play, when: (c) => c.state === 'paused' },
  { a: 'kill', label: 'Kill', icon: Zap, danger: true, when: (c) => c.state === 'running', confirm: (c) => `Kill ${c.name} (SIGKILL, no graceful stop)?` },
  { a: 'remove', label: 'Remove', icon: Trash2, danger: true, when: () => true, confirm: (c) => `Remove container ${c.name}? Its writable layer is lost (named volumes stay). If it belongs to a compose project, "compose up" recreates it.` },
]

export function ContainersTab() {
  const { p } = useVpsCtx()
  const list = useVps<{ containers: Container[]; error: string | null }>(p('/docker/containers'), { refetchInterval: 20_000 })
  const exports = useVps<{ dir: string; files: { name: string; size: number; mtime: number; path: string }[] }>(p('/docker/exports'))
  const { run, out, setOut, busy } = useAction()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<Container | null>(null)
  const [tests, setTests] = useState<{ results: ContainerTest[]; tested: number; failing: number; at: number } | null>(null)
  const [exp, setExp] = useState<{ c: Container; kind: 'container' | 'image' | 'commit'; name: string } | null>(null)
  const [imp, setImp] = useState<{ path: string; kind: 'image' | 'container'; name: string } | null>(null)
  const [filter, setFilter] = useState('')
  const containers = (list.data?.containers ?? []).filter((c) => !filter || `${c.name} ${c.image} ${c.project} ${c.host}`.toLowerCase().includes(filter.toLowerCase()))
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const act = async (c: Container, a: Act) => {
    const def = ACTS.find((x) => x.a === a)!
    await run({ path: `/docker/containers/${c.id}/${a}`, label: `${def.label}: ${c.name}`, confirm: def.confirm?.(c), invalidate: ['/docker/containers'], key: `${c.id}:${a}` })
  }
  const bulk = async (a: Act) => {
    const targets = containers.filter((c) => sel.has(c.id))
    if (!targets.length) return
    if (['stop', 'kill', 'remove'].includes(a) && !window.confirm(`${a} ${targets.length} container(s): ${targets.map((c) => c.name).join(', ')}?`)) return
    for (const c of targets) await run({ path: `/docker/containers/${c.id}/${a}`, label: `${a}: ${c.name}`, invalidate: ['/docker/containers'], key: `${c.id}:${a}` })
    setSel(new Set())
  }
  const testAll = async () => {
    setTests(null)
    const r = (await run({ path: '/docker/test', label: 'Container tests finished', quiet: true, key: 'test' })) as unknown as { results: ContainerTest[]; tested: number; failing: number; at: number } | null
    if (r) setTests(r)
  }
  const doExport = async () => {
    if (!exp) return
    const r = await run({ path: '/docker/export', body: { id: exp.c.id, kind: exp.kind, name: exp.name }, label: `Exported ${exp.c.name}`, invalidate: ['/docker/exports'], key: 'export' })
    if (r?.ok) setExp(null)
  }
  const doImport = async () => {
    if (!imp) return
    const r = await run({ path: '/docker/import', body: imp, label: `Imported ${imp.path}`, invalidate: ['/docker/images', '/docker/containers'], key: 'import' })
    if (r?.ok) setImp(null)
  }

  return (
    <div className="stack" style={{ gap: 12 }} data-vps-containers="">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input className="input sm" placeholder="Filter by name, image, project, host…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 280 }} aria-label="Filter containers" />
        <button className="btn sm" onClick={() => list.refetch()} disabled={list.isFetching}>
          <RefreshCw size={12} /> Refresh
        </button>
        <button className="btn primary sm" onClick={testAll} disabled={busy === 'test'} data-vps-test-all="">
          <Busy on={busy === 'test'}>
            <FlaskConical size={12} />
          </Busy>{' '}
          Test all containers
        </button>
        <button className="btn sm" onClick={() => setImp({ path: exports.data?.files[0]?.path ?? `${exports.data?.dir ?? '/root/docker-exports'}/`, kind: 'image', name: '' })}>
          <Upload size={12} /> Import…
        </button>
        <span className="grow" />
        {sel.size > 0 && (
          <div className="row" style={{ gap: 4 }} data-vps-bulk="">
            <span className="muted small">{sel.size} selected:</span>
            {(['start', 'stop', 'restart', 'kill', 'remove'] as Act[]).map((a) => (
              <button key={a} className={`btn sm ${['kill', 'remove'].includes(a) ? 'danger' : ''}`} onClick={() => bulk(a)} disabled={busy !== ''}>
                {a}
              </button>
            ))}
            <button className="btn ghost sm" onClick={() => setSel(new Set())}>
              clear
            </button>
          </div>
        )}
      </div>
      {list.error && <div className="dev-session-chip warn">{(list.error as Error).message}</div>}
      {list.data?.error && <div className="dev-session-chip warn">docker: {list.data.error}</div>}
      <div className="card table-card">
        <table className="table compact vps-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select all" checked={containers.length > 0 && sel.size === containers.length} onChange={(e) => setSel(e.target.checked ? new Set(containers.map((c) => c.id)) : new Set())} />
              </th>
              <th>Name</th>
              <th>State</th>
              <th>Image</th>
              <th>CPU</th>
              <th>Memory</th>
              <th>Net I/O</th>
              <th>Ports / host</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {containers.map((c) => (
              <tr key={c.id} className={sel.has(c.id) ? 'is-selected' : ''} data-vps-container={c.name}>
                <td>
                  <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} />
                </td>
                <td>
                  <button className="link" onClick={() => setDetail(c)} style={{ fontWeight: 600 }}>
                    {c.name}
                  </button>
                  <div className="muted small">
                    {c.project ? `${c.project}/${c.service}` : c.id.slice(0, 12)} · {c.status}
                  </div>
                </td>
                <td>
                  <StateChip state={c.state} />
                </td>
                <td className="mono small" title={c.image}>
                  {c.image.length > 36 ? `…${c.image.slice(-34)}` : c.image}
                  {c.size && <div className="muted small">{c.size}</div>}
                </td>
                <td className="mono small">{c.cpu}</td>
                <td className="mono small">
                  {c.mem}
                  {c.memPct && <div className="muted">{c.memPct}</div>}
                </td>
                <td className="mono small">{c.net}</td>
                <td className="small">
                  {c.host && (
                    <a href={`https://${c.host}`} target="_blank" rel="noreferrer">
                      {c.host}
                    </a>
                  )}
                  <div className="muted mono" style={{ fontSize: '0.7rem' }}>
                    {c.ports}
                  </div>
                </td>
                <td>
                  <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                    {ACTS.filter((x) => x.when(c)).map(({ a, label, icon: Icon, danger }) => (
                      <button key={a} className={`btn ghost icon sm ${danger ? 'danger' : ''}`} title={label} onClick={() => act(c, a)} disabled={busy !== ''} data-vps-act={a}>
                        <Busy on={busy === `${c.id}:${a}`}>
                          <Icon size={13} />
                        </Busy>
                      </button>
                    ))}
                    <button className="btn ghost icon sm" title="Logs & details" onClick={() => setDetail(c)}>
                      <ScrollText size={13} />
                    </button>
                    <button className="btn ghost icon sm" title="Export" onClick={() => setExp({ c, kind: 'container', name: c.name })}>
                      <Download size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!containers.length && !list.isLoading && (
              <tr>
                <td colSpan={9} className="muted">
                  {list.isError ? 'Could not list containers.' : 'No containers.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {tests && (
        <section className="card stack" style={{ gap: 8 }} data-vps-tests="">
          <div className="row between">
            <h3 style={{ margin: 0 }}>
              <Activity size={16} /> Test report · {tests.tested} tested, {tests.failing ? <span className="chip st-blocked">{tests.failing} failing</span> : <span className="chip st-done">all passing</span>}
            </h3>
            <span className="muted small">{new Date(tests.at).toLocaleTimeString()}</span>
          </div>
          <div className="vps-tests">
            {tests.results.map((t) => (
              <div key={t.id} className={`vps-test ${t.ok ? 'ok' : 'fail'}`}>
                <div className="row between">
                  <strong>{t.name}</strong>
                  <StateChip state={t.state} />
                </div>
                <ul>
                  {t.checks.map((ch, i) => (
                    <li key={i} className={ch.ok ? 'ok' : 'fail'}>
                      <span className="vps-check-dot" /> <b>{ch.name}</b> <span className="muted">{ch.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card stack" style={{ gap: 8 }}>
        <div className="row between">
          <h3 style={{ margin: 0 }}>Exports on the server · {exports.data?.dir}</h3>
          <button className="btn ghost sm" onClick={() => exports.refetch()}>
            <RefreshCw size={12} />
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Container exports (filesystem), image saves (full image with history) and commits (snapshot of a running container as an image). Download them from the Files tab or import them back here, even on another server.</p>
        {exports.data?.files.length ? (
          <table className="table compact">
            <tbody>
              {exports.data.files.map((f) => (
                <tr key={f.name}>
                  <td className="mono small">{f.name}</td>
                  <td className="small">{fmtBytes(f.size)}</td>
                  <td className="small muted">{relTime(f.mtime)}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <a className="btn ghost sm" href={p(`/docker/../files/download?path=${encodeURIComponent(f.path)}`).replace('/docker/../', '/')} download>
                        <Download size={12} /> download
                      </a>
                      <button className="btn ghost sm" onClick={() => setImp({ path: f.path, kind: /-image-|-commit-/.test(f.name) ? 'image' : 'container', name: f.name.replace(/-(container|image|commit)-.*$/, '') + ':imported' })}>
                        <Upload size={12} /> import
                      </button>
                      <button className="btn ghost sm danger" onClick={() => run({ method: 'DELETE', path: `/docker/exports/${encodeURIComponent(f.name)}`, label: 'Export deleted', confirm: `Delete ${f.name}?`, invalidate: ['/docker/exports'] })}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>No exports yet.</p>
        )}
      </section>

      {out && <Out out={out} title="Last action" />}

      {detail && <ContainerDetail c={detail} onClose={() => setDetail(null)} onOut={(o) => setOut(o as ExecOut & Record<string, unknown>)} />}

      {exp && (
        <Dialog title={`Export ${exp.c.name}`} onClose={() => setExp(null)}>
          <div className="stack" style={{ gap: 10 }}>
            <label className="field">
              <span>What to export</span>
              <select className="select" value={exp.kind} onChange={(e) => setExp({ ...exp, kind: e.target.value as typeof exp.kind })}>
                <option value="container">Container filesystem (docker export) — restore with "import as container image"</option>
                <option value="image">Its image (docker save) — restore with docker load</option>
                <option value="commit">Commit the running container to an image, then save it</option>
              </select>
            </label>
            <label className="field">
              <span>File name prefix</span>
              <input className="input" value={exp.name} onChange={(e) => setExp({ ...exp, name: e.target.value })} />
            </label>
            <p className="muted small" style={{ margin: 0 }}>Written as a .tar.gz under the exports folder on the server; this can take a while for big images.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={doExport} disabled={busy === 'export'}>
                <Busy on={busy === 'export'}>
                  <Download size={13} />
                </Busy>{' '}
                Export
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {imp && (
        <Dialog title="Import" onClose={() => setImp(null)}>
          <div className="stack" style={{ gap: 10 }}>
            <label className="field">
              <span>Archive path on the server</span>
              <input className="input" value={imp.path} onChange={(e) => setImp({ ...imp, path: e.target.value })} placeholder="/root/docker-exports/app-image-2026-01-01.tar.gz" />
            </label>
            <label className="field">
              <span>Kind</span>
              <select className="select" value={imp.kind} onChange={(e) => setImp({ ...imp, kind: e.target.value as typeof imp.kind })}>
                <option value="image">Image archive (docker save) → docker load</option>
                <option value="container">Container filesystem (docker export) → docker import as a new image</option>
              </select>
            </label>
            {imp.kind === 'container' && (
              <label className="field">
                <span>New image name:tag</span>
                <input className="input" value={imp.name} onChange={(e) => setImp({ ...imp, name: e.target.value })} placeholder="myapp:imported" />
              </label>
            )}
            <p className="muted small" style={{ margin: 0 }}>Upload an archive from your computer first in Files · SFTP (drop it into the exports folder), then import it here. Imported images appear under Images; start one with a compose file or the Sites tab.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={doImport} disabled={busy === 'import'}>
                <Busy on={busy === 'import'}>
                  <Upload size={13} />
                </Busy>{' '}
                Import
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function ContainerDetail({ c, onClose, onOut }: { c: Container; onClose: () => void; onOut: (o: ExecOut) => void }) {
  const { p } = useVpsCtx()
  const [tab, setTab] = useState<'logs' | 'inspect' | 'top' | 'exec'>('logs')
  const [tail, setTail] = useState(300)
  const d = useVps<{ inspect: Record<string, unknown>; logs: string; top: string }>(p(`/docker/containers/${c.id}`))
  const logs = useVps<{ logs: string }>(tab === 'logs' ? p(`/docker/containers/${c.id}/logs?tail=${tail}`) : null, { refetchInterval: 10_000 })
  const { run, out, busy } = useAction()
  const [cmd, setCmd] = useState('')
  const exec = async () => {
    if (!cmd.trim()) return
    const r = await run({ path: `/docker/containers/${c.id}/exec`, body: { command: cmd }, label: 'Ran in container', quiet: true, key: 'exec' })
    if (r) onOut(r)
  }
  return (
    <Dialog title={`${c.name} · ${c.image}`} onClose={onClose} wide>
      <div className="stack" style={{ gap: 8 }}>
        <div className="segmented">
          {(['logs', 'inspect', 'top', 'exec'] as const).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'logs' && (
          <>
            <div className="row" style={{ gap: 6 }}>
              <span className="muted small">Last</span>
              {[100, 300, 1000, 5000].map((n) => (
                <button key={n} className={`btn ghost sm ${tail === n ? 'active' : ''}`} onClick={() => setTail(n)}>
                  {n}
                </button>
              ))}
              <span className="muted small">lines · refreshes every 10 s</span>
              <span className="grow" />
              <button className="btn ghost sm" onClick={() => logs.refetch()}>
                <RefreshCw size={12} />
              </button>
            </div>
            <pre className="vps-pre tall">{logs.data?.logs ?? d.data?.logs ?? 'Loading…'}</pre>
          </>
        )}
        {tab === 'inspect' && <pre className="vps-pre tall">{d.data ? JSON.stringify(d.data.inspect, null, 2) : 'Loading…'}</pre>}
        {tab === 'top' && <pre className="vps-pre">{d.data?.top || 'Not running'}</pre>}
        {tab === 'exec' && (
          <>
            <div className="row" style={{ gap: 6 }}>
              <input className="input mono" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="ls -la /app  ·  env  ·  cat /etc/os-release" onKeyDown={(e) => e.key === 'Enter' && exec()} aria-label="Command in container" />
              <button className="btn primary sm" onClick={exec} disabled={busy === 'exec'}>
                <Busy on={busy === 'exec'}>
                  <Terminal size={12} />
                </Busy>{' '}
                Run
              </button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>Runs with `sh -c` inside the container (non-interactive). For an interactive shell use Terminal · SSH → "Shell in container".</p>
            {out && <Out out={out} />}
          </>
        )}
      </div>
    </Dialog>
  )
}
