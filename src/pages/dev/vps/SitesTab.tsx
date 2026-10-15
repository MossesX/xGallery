import { useState } from 'react'
import { CheckCircle2, ExternalLink, Globe, Plus, RefreshCw, Save, Stethoscope, Trash2 } from 'lucide-react'
import { useVps, type Site } from '../../../api/vps'
import { Busy, Dialog, Out, StateChip, useAction, useVpsCtx } from './common'

interface Check { host: string; http: number; seconds: number; certEnd: string; ip: string }

const KINDS = [
  ['static', 'Static site — nginx serving files you upload to <dir>/public'],
  ['proxy', 'Reverse proxy — forward to a port on the VPS (a Node/Python app you run yourself)'],
  ['image', 'Container — run any Docker image behind HTTPS'],
] as const

/** Subdomains as compose projects under /opt/sites with Traefik labels, plus the Hostinger DNS record. */
export function SitesTab() {
  const { p, hasToken, domain } = useVpsCtx()
  const sites = useVps<{ sites: Site[]; domain: string }>(p('/sites'))
  const { run, out, busy } = useAction()
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [create, setCreate] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [form, setForm] = useState({ sub: '', domain: domain, kind: 'static' as 'static' | 'proxy' | 'image', image: '', port: 80, target: 3000, env: '', dns: true })
  const [created, setCreated] = useState<{ site: { sub: string; domain: string }; up: { ok: boolean; stdout: string; stderr: string }; dns: unknown; dnsError: string | null } | null>(null)
  const runChecks = async () => {
    const r = await fetch(`/api/dev/vps${p('/sites/check')}`, { credentials: 'include' }).then((x) => x.json())
    setChecks(r.checks ?? [])
  }
  const submit = async () => {
    const r = (await run({ path: '/sites', body: form, label: `Site ${form.sub}.${form.domain || domain} created`, invalidate: ['/sites', '/docker', '/h/dns'], key: 'create' })) as unknown as typeof created
    if (r) {
      setCreated(r)
      setCreate(false)
    }
  }
  return (
    <div className="stack" style={{ gap: 12 }} data-vps-sites="">
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary sm" onClick={() => { setForm({ ...form, domain: domain || sites.data?.domain || '' }); setCreate(true) }} data-vps-new-site="">
          <Plus size={12} /> New subdomain
        </button>
        <button className="btn sm" onClick={runChecks}>
          <Stethoscope size={12} /> Check HTTPS & DNS
        </button>
        <button className="btn ghost sm" onClick={() => sites.refetch()}>
          <RefreshCw size={12} />
        </button>
        <span className="muted small">
          Each site is a compose project in {'/opt/sites/<sub>'} joined to the Traefik network, so it gets a Let's Encrypt certificate automatically. {hasToken ? `The A record on ${domain} is created through Hostinger.` : 'Without a Hostinger token, add the A record yourself in hPanel.'}
        </span>
      </div>
      {sites.error && <div className="dev-session-chip warn">{(sites.error as Error).message}</div>}
      <div className="card table-card">
        <table className="table compact">
          <thead>
            <tr>
              <th>Host</th>
              <th>Kind</th>
              <th>Container</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(sites.data?.sites ?? []).map((s) => (
              <tr key={s.sub} data-vps-site={s.sub}>
                <td>
                  <a href={`https://${s.host}`} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
                    {s.host} <ExternalLink size={11} />
                  </a>
                  <div className="muted small mono">{s.dir}</div>
                </td>
                <td className="small">
                  {s.kind}
                  {s.kind === 'image' && <div className="muted mono">{s.image}:{s.port}</div>}
                  {s.kind === 'proxy' && <div className="muted mono">→ 127.0.0.1:{s.target}</div>}
                </td>
                <td>{s.container ? <StateChip state={s.container.state} /> : <span className="chip">not created</span>}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn ghost sm" onClick={() => setOpen(s.sub)}>
                      edit
                    </button>
                    {['up', 'restart', 'down', 'pull', 'recreate'].map((a) => (
                      <button key={a} className="btn ghost sm" disabled={busy !== ''} onClick={() => run({ path: `/sites/${s.sub}/${a}`, label: `${s.host}: ${a}`, invalidate: ['/sites', '/docker'], key: `${s.sub}:${a}` })}>
                        <Busy on={busy === `${s.sub}:${a}`}>{a}</Busy>
                      </button>
                    ))}
                    <button className="btn ghost sm danger" disabled={busy !== ''} onClick={() => run({ path: `/sites/${s.sub}/remove${hasToken ? '?dns=1' : ''}`, label: `${s.host} removed`, confirm: `Remove ${s.host}? The container, its volumes and ${s.dir} are deleted${hasToken ? ', and the DNS record too' : ''}.`, invalidate: ['/sites', '/docker', '/h/dns'] })}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!sites.data?.sites.length && !sites.isLoading && (
              <tr>
                <td colSpan={4} className="muted">
                  No sites created from the panel yet. The main app ({domain}) is deployed by GitHub Actions and shows under Containers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {checks && (
        <section className="card stack" style={{ gap: 6 }} data-vps-site-checks="">
          <h3 style={{ margin: 0 }}>
            <Globe size={16} /> Reachability
          </h3>
          <table className="table compact">
            <thead>
              <tr>
                <th>Host</th>
                <th>HTTPS</th>
                <th>Time</th>
                <th>Certificate ends</th>
                <th>Resolves to</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.host}>
                  <td className="mono small">{c.host}</td>
                  <td>{c.http ? <span className={`chip ${c.http < 400 ? 'st-done' : 'st-blocked'}`}>{c.http}</span> : <span className="chip st-blocked">no answer</span>}</td>
                  <td className="small">{c.seconds ? `${c.seconds.toFixed(2)} s` : ''}</td>
                  <td className="small">{c.certEnd || '—'}</td>
                  <td className="mono small">{c.ip || 'not resolving'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {created && (
        <section className="card stack" style={{ gap: 6 }} data-vps-site-created="">
          <h3 style={{ margin: 0 }}>
            <CheckCircle2 size={16} /> {created.site.sub}.{created.site.domain} created
          </h3>
          <p className="muted small" style={{ margin: 0 }}>
            {created.dns ? 'DNS A record set through Hostinger; the certificate is issued on the first visit (allow a minute for DNS).' : created.dnsError ? `DNS was not set: ${created.dnsError}` : 'DNS was not touched.'}
          </p>
          <Out out={created.up} title="compose up" />
        </section>
      )}
      {out && !created && <Out out={out} title="Last action" />}

      {create && (
        <Dialog title="New subdomain" onClose={() => setCreate(false)} wide>
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
              <label className="field grow">
                <span>Subdomain</span>
                <input className="input" value={form.sub} onChange={(e) => setForm({ ...form, sub: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="blog" autoFocus aria-label="Subdomain" />
              </label>
              <span style={{ paddingBottom: 10 }}>.</span>
              <label className="field grow">
                <span>Domain</span>
                <input className="input" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} aria-label="Domain" />
              </label>
            </div>
            <label className="field">
              <span>What runs there</span>
              <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })} aria-label="Site kind">
                {KINDS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {form.kind === 'image' && (
              <div className="ops-grid">
                <label className="field">
                  <span>Docker image</span>
                  <input className="input mono" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="ghcr.io/you/app:latest" aria-label="Image" />
                </label>
                <label className="field">
                  <span>Port the app listens on</span>
                  <input className="input" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
                </label>
                <label className="field" style={{ gridColumn: '1 / -1' }}>
                  <span>Environment (KEY=value per line)</span>
                  <textarea className="textarea mono" value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} rows={3} />
                </label>
              </div>
            )}
            {form.kind === 'proxy' && (
              <label className="field">
                <span>Port on the VPS to forward to</span>
                <input className="input" type="number" value={form.target} onChange={(e) => setForm({ ...form, target: Number(e.target.value) })} />
              </label>
            )}
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={form.dns} onChange={(e) => setForm({ ...form, dns: e.target.checked })} disabled={!hasToken} /> Create the DNS A record through Hostinger {hasToken ? '' : '(needs an API token)'}
            </label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={submit} disabled={!form.sub || busy === 'create'} data-vps-create-site="">
                <Busy on={busy === 'create'}>
                  <Plus size={13} />
                </Busy>{' '}
                Create & start
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {open && <SiteEditor sub={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function SiteEditor({ sub, onClose }: { sub: string; onClose: () => void }) {
  const { p } = useVpsCtx()
  const d = useVps<{ compose: string; meta: Record<string, unknown>; files: string; logs: string; dir: string }>(p(`/sites/${sub}`))
  const { run, out, busy } = useAction()
  const [compose, setCompose] = useState<string | null>(null)
  const text = compose ?? d.data?.compose ?? ''
  return (
    <Dialog title={`Site ${sub}`} onClose={onClose} wide>
      <div className="stack" style={{ gap: 8 }}>
        <div className="row between">
          <span className="muted small mono">{d.data?.dir}/docker-compose.yml</span>
          <button className="btn primary sm" disabled={compose == null || busy !== ''} onClick={() => run({ method: 'PUT', path: `/sites/${sub}`, body: { compose: text }, label: 'Compose saved and applied', invalidate: ['/sites', '/docker'] })}>
            <Save size={12} /> Save & apply
          </button>
        </div>
        <textarea className="textarea mono" value={text} onChange={(e) => setCompose(e.target.value)} rows={16} spellCheck={false} aria-label="Compose file" />
        {d.data?.files && (
          <>
            <strong className="small">public/</strong>
            <pre className="vps-pre">{d.data.files || '(no files; upload them in Files · SFTP)'}</pre>
          </>
        )}
        <strong className="small">Recent logs</strong>
        <pre className="vps-pre">{d.data?.logs || '—'}</pre>
        {out && <Out out={out} />}
      </div>
    </Dialog>
  )
}
