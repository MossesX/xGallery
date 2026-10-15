import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ExternalLink, KeyRound, Save, Trash2 } from 'lucide-react'
import { api } from '../../../api/client'
import { useInvalidateVps, useVps, useVpsSettings, VPS } from '../../../api/vps'
import { useUI } from '../../../store/ui'
import { useVpsCtx } from './common'

interface Vm { id: number; hostname: string; state: string; ipv4?: { address: string }[]; plan?: string }

/** Hostinger token (server-side only), which VM/domain/firewall the manager targets, and which SSH profile it runs on. */
export function VpsSettingsTab() {
  const notify = useUI((s) => s.notify)
  const invalidate = useInvalidateVps()
  const { data } = useVpsSettings()
  const { hasToken } = useVpsCtx()
  const [token, setToken] = useState('')
  const [form, setForm] = useState({ vmId: '' as string | number, domain: '', firewallId: '' as string | number, profileId: '' })
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (data) setForm({ vmId: data.hostinger.vmId ?? '', domain: data.hostinger.domain, firewallId: data.hostinger.firewallId ?? '', profileId: data.hostinger.profileId })
  }, [data])
  const vms = useVps<{ vms: Vm[] | { data?: Vm[] } }>(hasToken ? '/h/vms' : null, { staleTime: 60_000 })
  const vmList: Vm[] = Array.isArray(vms.data?.vms) ? vms.data!.vms : ((vms.data?.vms as { data?: Vm[] } | undefined)?.data ?? [])
  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true)
    try {
      await api.put(`${VPS}/settings`, { ...form, vmId: form.vmId === '' ? null : Number(form.vmId), firewallId: form.firewallId === '' ? null : Number(form.firewallId), ...(token ? { token } : {}), ...extra })
      setToken('')
      invalidate()
      notify('VPS manager settings saved', 'success')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="stack" style={{ gap: 12 }} data-vps-settings="">
      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>
          <KeyRound size={16} /> Hostinger API token
        </h3>
        <p className="muted small" style={{ margin: 0 }}>
          Create a token in hPanel → Account → API (<a href="https://hpanel.hostinger.com/profile/api" target="_blank" rel="noreferrer">hpanel.hostinger.com/profile/api <ExternalLink size={10} /></a>). It is stored on the server in the panel's settings and never shown again; it can also come from a HOSTINGER_API_TOKEN environment variable.
        </p>
        <div className="row" style={{ gap: 6 }}>
          {data?.hostinger.hasToken ? (
            <span className="chip st-done">
              <CheckCircle2 size={11} /> token set ({data.hostinger.tokenSource}) {data.hostinger.tokenHint}
            </span>
          ) : (
            <span className="chip prio-high">no token</span>
          )}
          <input className="input sm grow mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={data?.hostinger.hasToken ? 'paste a new token to replace it' : 'paste the API token'} aria-label="Hostinger API token" autoComplete="off" />
          <button className="btn primary sm" disabled={!token || saving} onClick={() => save()} data-vps-save-token="">
            <Save size={12} /> Save token
          </button>
          {data?.hostinger.tokenSource === 'settings' && (
            <button className="btn ghost sm danger" disabled={saving} onClick={() => window.confirm('Remove the stored Hostinger token?') && save({ clearToken: true })}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </section>
      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>Targets</h3>
        <div className="ops-grid">
          <label className="field">
            <span>VPS (Hostinger VM)</span>
            {vmList.length ? (
              <select className="select" value={form.vmId} onChange={(e) => setForm({ ...form, vmId: e.target.value })} aria-label="VM">
                <option value="">— pick —</option>
                {vmList.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.hostname} · {(v.ipv4 ?? []).map((x) => x.address).join(', ')} · {v.state} (#{v.id})
                  </option>
                ))}
              </select>
            ) : (
              <input className="input" value={form.vmId} onChange={(e) => setForm({ ...form, vmId: e.target.value })} placeholder="VM id (listed once a token is saved)" aria-label="VM id" />
            )}
          </label>
          <label className="field">
            <span>Default domain (DNS zone)</span>
            <input className="input" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} aria-label="Domain" />
          </label>
          <label className="field">
            <span>Hostinger firewall id (optional)</span>
            <input className="input" value={form.firewallId} onChange={(e) => setForm({ ...form, firewallId: e.target.value })} aria-label="Firewall id" />
          </label>
          <label className="field">
            <span>SSH profile for machine actions</span>
            <select className="select" value={form.profileId} onChange={(e) => setForm({ ...form, profileId: e.target.value })} aria-label="SSH profile">
              <option value="">default profile ({data?.profiles.find((x) => x.id === data.defaultProfile)?.name ?? '—'})</option>
              {(data?.profiles ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {x.user}@{x.host}:{x.port}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn primary sm" disabled={saving} onClick={() => save()} data-vps-save-settings="">
            <Save size={12} /> Save
          </button>
          <span className="muted small">
            Machine actions use the panel SSH key from <Link to="/dev/terminal">Terminal · SSH → Key</Link>; profiles are edited under <Link to="/dev/shell">Remote shell</Link>.
          </span>
        </div>
      </section>
      <section className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Where things live</h3>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Sites created here: {data?.sitesDir}/&lt;subdomain&gt; (compose file, public/ for static sites, .xg-site.json)</li>
          <li>Container/image exports: {data?.exportDir}</li>
          <li>The main app is deployed by GitHub Actions into /opt/xgallery; redeploy from the Command wizard or Terminal.</li>
        </ul>
      </section>
    </div>
  )
}
