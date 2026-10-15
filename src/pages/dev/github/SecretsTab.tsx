import { useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { ago, useGh } from '../../../api/github'
import { Busy, useGhAction } from './common'

const KNOWN: { name: string; hint: string }[] = [
  { name: 'VPS_PASSWORD', hint: 'root password the deploy workflow uses (or set VPS_SSH_KEY instead)' },
  { name: 'VPS_SSH_KEY', hint: 'private key whose public half is in the VPS authorized_keys' },
  { name: 'VPS_USER', hint: 'SSH user on the VPS (default root)' },
  { name: 'ADMIN_PASSWORD', hint: 'initial owner password baked into the deployment' },
  { name: 'HOSTINGER_API_TOKEN', hint: 'lets the VPS manager talk to Hostinger without pasting a token' },
  { name: 'RESET_OWNER_PASSWORD', hint: 'one-time owner password recovery: set, deploy, sign in, then delete it' },
]

/** Repository secrets (write-only, sealed with GitHub's public key on this server) and variables. */
export function SecretsTab() {
  const list = useGh<{ secrets: { name: string; created_at: string; updated_at: string }[]; variables: { name: string; value: string; updated_at: string }[] }>('/secrets')
  const { run, busy } = useGhAction()
  const [form, setForm] = useState({ name: '', value: '' })
  const [vform, setVform] = useState({ name: '', value: '' })
  const set = async (name: string, value: string) => {
    const r = await run({ method: 'PUT', path: `/secrets/${encodeURIComponent(name)}`, body: { value }, label: `Secret ${name} set`, invalidate: ['/secrets'], key: `s:${name}` })
    if (r) setForm({ name: '', value: '' })
  }
  return (
    <div className="stack" style={{ gap: 10 }} data-gh-secrets="">
      <div className="vps-grid-2">
        <section className="card stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>
            <KeyRound size={16} /> Repository secrets
          </h3>
          <p className="muted small" style={{ margin: 0 }}>Values are encrypted on this server with the repository's public key (libsodium sealed box) and sent to GitHub; they can be replaced but never read back. Changing the VPS root password in the VPS manager? Set VPS_PASSWORD here right after.</p>
          {list.error && <div className="dev-session-chip warn">{(list.error as Error).message}</div>}
          <table className="table compact">
            <tbody>
              {(list.data?.secrets ?? []).map((s) => (
                <tr key={s.name} data-gh-secret={s.name}>
                  <td className="mono small">{s.name}</td>
                  <td className="small muted">updated {ago(s.updated_at)}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn ghost sm" onClick={() => setForm({ name: s.name, value: '' })}>
                        replace
                      </button>
                      <button className="btn ghost icon sm danger" disabled={busy !== ''} onClick={() => run({ method: 'DELETE', path: `/secrets/${s.name}`, label: `Secret ${s.name} deleted`, confirm: `Delete secret ${s.name}? Workflows using it will fail.`, invalidate: ['/secrets'] })}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ gap: 4, alignItems: 'flex-end' }}>
            <input className="input sm mono" placeholder="NAME" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} style={{ width: 200 }} aria-label="Secret name" list="gh-known-secrets" />
            <datalist id="gh-known-secrets">
              {KNOWN.map((k) => (
                <option key={k.name} value={k.name}>
                  {k.hint}
                </option>
              ))}
            </datalist>
            <input className="input sm grow" type="password" placeholder="value (never stored here)" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} aria-label="Secret value" autoComplete="off" />
            <button className="btn primary sm" disabled={!form.name || !form.value || busy !== ''} onClick={() => set(form.name, form.value)} data-gh-set-secret="">
              <Busy on={busy === `s:${form.name}`}>
                <Plus size={12} />
              </Busy>{' '}
              Set
            </button>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {KNOWN.map((k) => (
              <button key={k.name} className="chip chip-tag" title={k.hint} onClick={() => setForm({ name: k.name, value: '' })}>
                {k.name}
              </button>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Prefer the copy-and-paste route? The <Link to="/dev/ops">Command wizard</Link> still generates gh-CLI scripts for the same secrets.
          </p>
        </section>
        <section className="card stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>Repository variables</h3>
          <p className="muted small" style={{ margin: 0 }}>Plain-text configuration for workflows (readable).</p>
          <table className="table compact">
            <tbody>
              {(list.data?.variables ?? []).map((v) => (
                <tr key={v.name}>
                  <td className="mono small">{v.name}</td>
                  <td className="mono small">{v.value}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn ghost sm" onClick={() => setVform({ name: v.name, value: v.value })}>
                        edit
                      </button>
                      <button className="btn ghost icon sm danger" disabled={busy !== ''} onClick={() => run({ method: 'DELETE', path: `/variables/${v.name}`, label: `Variable ${v.name} deleted`, confirm: `Delete variable ${v.name}?`, invalidate: ['/secrets'] })}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.data && !list.data.variables.length && (
                <tr>
                  <td className="muted small">No variables.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="row" style={{ gap: 4 }}>
            <input className="input sm mono" placeholder="NAME" value={vform.name} onChange={(e) => setVform({ ...vform, name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} style={{ width: 180 }} aria-label="Variable name" />
            <input className="input sm grow mono" placeholder="value" value={vform.value} onChange={(e) => setVform({ ...vform, value: e.target.value })} aria-label="Variable value" />
            <button className="btn sm" disabled={!vform.name || busy !== ''} onClick={async () => { const r = await run({ method: 'PUT', path: `/variables/${vform.name}`, body: { value: vform.value }, label: `Variable ${vform.name} saved`, invalidate: ['/secrets'] }); if (r) setVform({ name: '', value: '' }) }}>
              Save
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
