import { useState } from 'react'
import { ExternalLink, KeyRound, Play, RefreshCw, Server, Tag } from 'lucide-react'
import { useVps } from '../../../api/vps'
import { Busy, Out, useAction, useVpsCtx } from './common'

const EXAMPLES: { label: string; method: string; path: string }[] = [
  { label: 'My VMs', method: 'GET', path: '/vps/v1/virtual-machines' },
  { label: 'Data centers', method: 'GET', path: '/vps/v1/data-centers' },
  { label: 'OS templates', method: 'GET', path: '/vps/v1/templates' },
  { label: 'Public keys', method: 'GET', path: '/vps/v1/public-keys' },
  { label: 'Domains', method: 'GET', path: '/domains/v1/portfolio' },
  { label: 'Billing subscriptions', method: 'GET', path: '/billing/v1/subscriptions' },
  { label: 'Malware scanner', method: 'GET', path: '/vps/v1/virtual-machines/{vm}/monarx' },
  { label: 'Docker Manager projects', method: 'GET', path: '/vps/v1/virtual-machines/{vm}/docker' },
]

/** Hostinger extras: VM actions history, Docker Manager projects, credentials, and a raw API explorer. */
export function HostingerTab() {
  const { hasToken } = useVpsCtx()
  const actions = useVps<{ actions: { data?: { id: number; name: string; state: string; created_at: string }[] } | { id: number; name: string; state: string; created_at: string }[] }>(hasToken ? '/h/vm/actions' : null)
  const projects = useVps<{ projects: { project?: string; name?: string; status?: string; containers?: unknown[] }[] | { data?: unknown[] } }>(hasToken ? '/h/docker' : null)
  const { run, out, busy, setOut } = useAction()
  const [req, setReq] = useState({ method: 'GET', path: '/vps/v1/virtual-machines', body: '' })
  const [hostname, setHostname] = useState('')
  const [pw, setPw] = useState('')
  const acts = Array.isArray(actions.data?.actions) ? actions.data!.actions : ((actions.data?.actions as { data?: { id: number; name: string; state: string; created_at: string }[] } | undefined)?.data ?? [])
  const projs = Array.isArray(projects.data?.projects) ? (projects.data!.projects as { project?: string; name?: string; status?: string }[]) : (((projects.data?.projects as { data?: unknown[] } | undefined)?.data ?? []) as { project?: string; name?: string; status?: string }[])
  const explore = async () => {
    let body: unknown
    if (req.body.trim()) {
      try {
        body = JSON.parse(req.body)
      } catch {
        setOut({ ok: false, code: 1, stdout: '', stderr: 'Body is not valid JSON', ms: 0 })
        return
      }
    }
    const r = await run({ path: '/h/raw', noProfile: true, body: { ...req, body }, label: `${req.method} ${req.path}`, quiet: true, key: 'raw' })
    if (r) setOut({ ok: true, code: 0, stdout: JSON.stringify((r as { result?: unknown }).result ?? r, null, 2), stderr: '', ms: 0 })
  }
  if (!hasToken) return <p className="muted">Needs a Hostinger API token (Settings tab).</p>
  return (
    <div className="stack" style={{ gap: 12 }} data-vps-hostinger="">
      <div className="vps-grid-2">
        <section className="card stack" style={{ gap: 8 }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>
              <Server size={16} /> Recent VM actions
            </h3>
            <button className="btn ghost sm" onClick={() => actions.refetch()}>
              <RefreshCw size={12} />
            </button>
          </div>
          <table className="table compact">
            <tbody>
              {acts.slice(0, 12).map((a) => (
                <tr key={a.id}>
                  <td className="small">{a.name}</td>
                  <td>
                    <span className={`chip ${a.state === 'success' ? 'st-done' : a.state === 'error' ? 'st-blocked' : 'st-in_progress'}`}>{a.state}</span>
                  </td>
                  <td className="small muted">{a.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>Docker Manager projects (hPanel)</h3>
          <p className="muted small" style={{ margin: 0 }}>Projects deployed through Hostinger's own Docker Manager. The app deployed by GitHub Actions is managed under Containers instead.</p>
          <table className="table compact">
            <tbody>
              {projs.map((pr, i) => {
                const name = pr.project ?? pr.name ?? `project-${i}`
                return (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="small">{pr.status ?? ''}</td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        {['start', 'stop', 'restart', 'update'].map((a) => (
                          <button key={a} className="btn ghost sm" disabled={busy !== ''} onClick={() => run({ path: `/h/docker/${encodeURIComponent(name)}/${a}`, noProfile: true, label: `${name}: ${a}`, invalidate: ['/h/docker'] })}>
                            {a}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {projects.data && !projs.length && (
                <tr>
                  <td className="muted small">None.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
      <div className="vps-grid-2">
        <section className="card stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>
            <KeyRound size={16} /> Root password
          </h3>
          <p className="muted small" style={{ margin: 0 }}>Sets the VPS root password through Hostinger (useful when locked out). Afterwards update the GitHub secret with the Command wizard → "Update the VPS_PASSWORD secret"; the password typed here is sent to Hostinger only and is not stored.</p>
          <div className="row" style={{ gap: 4 }}>
            <input className="input sm grow" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="new root password (8+ chars)" aria-label="New root password" autoComplete="new-password" />
            <button className="btn sm danger" disabled={pw.length < 8 || busy !== ''} onClick={async () => { const r = await run({ method: 'PUT', path: '/h/vm/root-password', noProfile: true, body: { password: pw }, label: 'Root password changed', confirm: 'Change the VPS root password now?' }); if (r) setPw('') }}>
              Change
            </button>
          </div>
        </section>
        <section className="card stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>
            <Tag size={16} /> Hostname
          </h3>
          <div className="row" style={{ gap: 4 }}>
            <input className="input sm grow" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="srv.amberxai.com" aria-label="Hostname" />
            <button className="btn sm" disabled={!hostname || busy !== ''} onClick={() => run({ method: 'PUT', path: '/h/vm/hostname', noProfile: true, body: { hostname }, label: 'Hostname set', invalidate: ['/h/vm'] })}>
              Set
            </button>
          </div>
        </section>
      </div>
      <section className="card stack" style={{ gap: 8 }} data-vps-explorer="">
        <div className="row between">
          <h3 style={{ margin: 0 }}>API explorer</h3>
          <a className="btn ghost sm" href="https://developers.hostinger.com" target="_blank" rel="noreferrer">
            Docs <ExternalLink size={11} />
          </a>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Call any Hostinger endpoint with the stored token. {'{vm}'} in a path is replaced with your VM id. Writes (POST/PUT/DELETE) are logged on the session.</p>
        <div className="row" style={{ gap: 4 }}>
          {EXAMPLES.map((e) => (
            <button key={e.label} className="chip chip-tag" onClick={() => setReq({ method: e.method, path: e.path, body: '' })}>
              {e.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 4 }}>
          <select className="select sm" value={req.method} onChange={(e) => setReq({ ...req, method: e.target.value })} aria-label="Method">
            {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input className="input sm mono grow" value={req.path} onChange={(e) => setReq({ ...req, path: e.target.value })} aria-label="API path" />
          <button className="btn primary sm" onClick={explore} disabled={busy === 'raw'}>
            <Busy on={busy === 'raw'}>
              <Play size={12} />
            </Busy>{' '}
            Send
          </button>
        </div>
        {req.method !== 'GET' && <textarea className="textarea mono" rows={4} value={req.body} onChange={(e) => setReq({ ...req, body: e.target.value })} placeholder='{"name": "..."}' aria-label="JSON body" />}
        {out && <Out out={out} title="Response" maxHeight={480} />}
      </section>
    </div>
  )
}
