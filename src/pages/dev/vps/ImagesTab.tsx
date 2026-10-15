import { useState } from 'react'
import { Download, Layers, RefreshCw, Trash2 } from 'lucide-react'
import { useVps } from '../../../api/vps'
import { Busy, Out, useAction, useVpsCtx } from './common'

interface Image { ID: string; Repository: string; Tag: string; Size: string; CreatedSince: string; CreatedAt: string }
interface Volume { Name: string; Driver: string; Mountpoint: string; Size: string }
interface Network { ID: string; Name: string; Driver: string; Scope: string }
interface Df { Type: string; TotalCount: string; Active: string; Size: string; Reclaimable: string }
interface Project { Name: string; Status: string; ConfigFiles: string }

export function ImagesTab() {
  const { p } = useVpsCtx()
  const images = useVps<{ images: Image[] }>(p('/docker/images'))
  const volumes = useVps<{ volumes: Volume[] }>(p('/docker/volumes'))
  const networks = useVps<{ networks: Network[] }>(p('/docker/networks'))
  const df = useVps<{ df: Df[] }>(p('/docker/df'))
  const compose = useVps<{ projects: Project[] }>(p('/docker/compose'))
  const { run, out, busy } = useAction()
  const [pull, setPull] = useState('')
  const [composeDir, setComposeDir] = useState('')
  const composeAct = (dir: string, action: string, file?: string) => run({ path: '/docker/compose', body: { dir, action, file }, label: `compose ${action} (${dir})`, confirm: action === 'down' ? `Bring down the project in ${dir}? Its containers stop and are removed (volumes stay).` : undefined, invalidate: ['/docker'], key: `c:${dir}:${action}` })
  return (
    <div className="stack" style={{ gap: 12 }} data-vps-images="">
      <section className="card stack" style={{ gap: 8 }}>
        <div className="row between">
          <h3 style={{ margin: 0 }}>Disk usage</h3>
          <div className="row" style={{ gap: 4 }}>
            {(['images', 'containers', 'builder', 'volumes', 'all'] as const).map((w) => (
              <button key={w} className={`btn sm ${w === 'volumes' || w === 'all' ? 'danger' : ''}`} disabled={busy !== ''} onClick={() => run({ path: '/docker/prune', body: { what: w }, label: `Pruned ${w}`, confirm: w === 'volumes' ? 'Remove every volume not used by a container? Data in them is lost for good.' : w === 'all' ? 'Remove all stopped containers, unused networks, dangling + unused images and build cache?' : `Prune unused ${w}?`, invalidate: ['/docker'] })}>
                prune {w}
              </button>
            ))}
          </div>
        </div>
        <table className="table compact">
          <thead>
            <tr>
              <th>Type</th>
              <th>Total</th>
              <th>Active</th>
              <th>Size</th>
              <th>Reclaimable</th>
            </tr>
          </thead>
          <tbody>
            {(df.data?.df ?? []).map((r) => (
              <tr key={r.Type}>
                <td>{r.Type}</td>
                <td>{r.TotalCount}</td>
                <td>{r.Active}</td>
                <td>{r.Size}</td>
                <td>{r.Reclaimable}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <div className="row between">
          <h3 style={{ margin: 0 }}>
            <Layers size={16} /> Compose projects
          </h3>
          <button className="btn ghost sm" onClick={() => compose.refetch()}>
            <RefreshCw size={12} />
          </button>
        </div>
        <table className="table compact">
          <tbody>
            {(compose.data?.projects ?? []).map((pr) => {
              const dir = (pr.ConfigFiles ?? '').split(',')[0]?.replace(/\/[^/]+$/, '') ?? ''
              const file = (pr.ConfigFiles ?? '').split(',')[0]?.split('/').pop()
              return (
                <tr key={pr.Name}>
                  <td>
                    <strong>{pr.Name}</strong>
                    <div className="muted small mono">{pr.ConfigFiles}</div>
                  </td>
                  <td className="small">{pr.Status}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {['up', 'restart', 'pull', 'recreate', 'build', 'down'].map((a) => (
                        <button key={a} className={`btn ghost sm ${a === 'down' ? 'danger' : ''}`} disabled={!dir || busy !== ''} onClick={() => composeAct(dir, a, file)}>
                          <Busy on={busy === `c:${dir}:${a}`}>{a}</Busy>
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="row" style={{ gap: 6 }}>
          <input className="input sm mono" placeholder="/opt/xgallery (any directory with a docker-compose.yml)" value={composeDir} onChange={(e) => setComposeDir(e.target.value)} style={{ maxWidth: 420 }} aria-label="Compose directory" />
          {['up', 'ps', 'logs', 'pull', 'build'].map((a) => (
            <button key={a} className="btn sm" disabled={!composeDir.startsWith('/') || busy !== ''} onClick={() => composeAct(composeDir, a)}>
              {a}
            </button>
          ))}
        </div>
      </section>

      <div className="vps-grid-2">
        <section className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>Images</h3>
            <div className="row" style={{ gap: 4 }}>
              <input className="input sm mono" placeholder="nginx:alpine" value={pull} onChange={(e) => setPull(e.target.value)} aria-label="Image to pull" />
              <button className="btn sm" disabled={!pull.trim() || busy !== ''} onClick={() => run({ path: '/docker/images/pull', body: { ref: pull.trim() }, label: `Pulled ${pull}`, invalidate: ['/docker/images'], key: 'pull' })}>
                <Busy on={busy === 'pull'}>
                  <Download size={12} />
                </Busy>{' '}
                Pull
              </button>
            </div>
          </div>
          <div className="table-card" style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="table compact">
              <tbody>
                {(images.data?.images ?? []).map((im) => (
                  <tr key={im.ID + im.Tag}>
                    <td className="mono small">
                      {im.Repository}:{im.Tag}
                      <div className="muted">{im.ID.replace('sha256:', '').slice(0, 12)} · {im.CreatedSince}</div>
                    </td>
                    <td className="small">{im.Size}</td>
                    <td>
                      <button className="btn ghost icon sm danger" title="Remove image" disabled={busy !== ''} onClick={() => run({ method: 'DELETE', path: `/docker/images/${encodeURIComponent(im.Repository === '<none>' ? im.ID : `${im.Repository}:${im.Tag}`)}`, label: 'Image removed', confirm: `Remove image ${im.Repository}:${im.Tag}?`, invalidate: ['/docker/images', '/docker/df'] })}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="stack" style={{ gap: 12 }}>
          <section className="card stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>Volumes</h3>
            <table className="table compact">
              <tbody>
                {(volumes.data?.volumes ?? []).map((v) => (
                  <tr key={v.Name}>
                    <td className="mono small">
                      {v.Name}
                      <div className="muted">{v.Mountpoint}</div>
                    </td>
                    <td className="small">{v.Size}</td>
                    <td>
                      <button className="btn ghost icon sm danger" title="Remove volume" disabled={busy !== ''} onClick={() => run({ method: 'DELETE', path: `/docker/volumes/${encodeURIComponent(v.Name)}`, label: 'Volume removed', confirm: `Remove volume ${v.Name}? Its data is gone for good (fails while a container uses it).`, invalidate: ['/docker/volumes', '/docker/df'] })}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>Networks</h3>
            <div className="row" style={{ gap: 4 }}>
              {(networks.data?.networks ?? []).map((n) => (
                <span key={n.ID} className="chip" title={`${n.Driver} · ${n.Scope}`}>
                  {n.Name}
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
      {out && <Out out={out} title="Last action" />}
    </div>
  )
}
