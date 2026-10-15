import { useState } from 'react'
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useVps, type DnsZoneRecord } from '../../../api/vps'
import { Busy, Out, useAction, useVpsCtx } from './common'

const TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'SRV', 'NS', 'CAA']

/** DNS zone editor on Hostinger: add, edit and delete records of the chosen domain. */
export function DnsTab() {
  const { hasToken, domain: defDomain } = useVpsCtx()
  const [domain, setDomain] = useState(defDomain)
  const domains = useVps<{ domains: { domain: string; type?: string; status?: string }[] }>(hasToken ? '/h/domains' : null, { staleTime: 300_000 })
  const zone = useVps<{ zone: DnsZoneRecord[] }>(hasToken && domain ? `/h/dns?domain=${encodeURIComponent(domain)}` : null)
  const { run, out, busy } = useAction()
  const [add, setAdd] = useState({ name: '', type: 'A', ttl: 300, content: '' })
  const [edits, setEdits] = useState<Record<string, string>>({})
  const key = (r: DnsZoneRecord) => `${r.name}|${r.type}`
  const save = async (r: DnsZoneRecord) => {
    const v = edits[key(r)]
    if (v == null) return
    await run({ method: 'PUT', path: '/h/dns', noProfile: true, body: { domain, overwrite: true, records: v.split('\n').map((l) => l.trim()).filter(Boolean).map((content) => ({ name: r.name, type: r.type, ttl: r.ttl, content })) }, label: `${r.name} ${r.type} updated`, invalidate: ['/h/dns'] })
    setEdits((e) => { const n = { ...e }; delete n[key(r)]; return n })
  }
  if (!hasToken) return <p className="muted">DNS management needs a Hostinger API token (Settings tab).</p>
  return (
    <div className="stack" style={{ gap: 12 }} data-vps-dns="">
      <div className="row" style={{ gap: 6 }}>
        <label className="field" style={{ gap: 2 }}>
          <span className="muted small">Zone</span>
          {domains.data?.domains.length ? (
            <select className="select sm" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="DNS zone">
              {!domains.data.domains.some((d) => d.domain === domain) && <option value={domain}>{domain}</option>}
              {domains.data.domains.map((d) => (
                <option key={d.domain} value={d.domain}>
                  {d.domain}
                </option>
              ))}
            </select>
          ) : (
            <input className="input sm" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="DNS zone" />
          )}
        </label>
        <button className="btn ghost sm" onClick={() => zone.refetch()} style={{ alignSelf: 'flex-end' }}>
          <RefreshCw size={12} />
        </button>
        <span className="muted small" style={{ alignSelf: 'flex-end' }}>Changes go live on Hostinger's nameservers within a few minutes; caches elsewhere honour the TTL.</span>
      </div>
      {zone.error && <div className="dev-session-chip warn">{(zone.error as Error).message}</div>}
      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>Add a record</h3>
        <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
          <label className="field">
            <span className="muted small">Name</span>
            <input className="input sm" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="www or @" aria-label="Record name" />
          </label>
          <label className="field">
            <span className="muted small">Type</span>
            <select className="select sm" value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value })} aria-label="Record type">
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="muted small">TTL</span>
            <input className="input sm" type="number" value={add.ttl} onChange={(e) => setAdd({ ...add, ttl: Number(e.target.value) })} style={{ width: 90 }} />
          </label>
          <label className="field grow">
            <span className="muted small">Content</span>
            <input className="input sm mono" value={add.content} onChange={(e) => setAdd({ ...add, content: e.target.value })} placeholder="31.97.13.252" aria-label="Record content" />
          </label>
          <button className="btn primary sm" disabled={!add.content || busy !== ''} onClick={() => run({ method: 'PUT', path: '/h/dns', noProfile: true, body: { domain, overwrite: false, records: [{ ...add, name: add.name || '@' }] }, label: `${add.name || '@'} ${add.type} added`, invalidate: ['/h/dns'], key: 'add' })} data-vps-dns-add="">
            <Busy on={busy === 'add'}>
              <Plus size={12} />
            </Busy>{' '}
            Add
          </button>
        </div>
      </section>
      <div className="card table-card">
        <table className="table compact">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>TTL</th>
              <th>Content (one per line)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(zone.data?.zone ?? []).map((r) => (
              <tr key={key(r)} data-vps-dns-record={`${r.name}:${r.type}`}>
                <td className="mono small">{r.name}</td>
                <td>
                  <span className="chip">{r.type}</span>
                </td>
                <td className="small">{r.ttl}</td>
                <td>
                  <textarea className="textarea mono sm" rows={Math.max(1, r.records.length)} value={edits[key(r)] ?? r.records.map((x) => x.content).join('\n')} onChange={(e) => setEdits({ ...edits, [key(r)]: e.target.value })} style={{ minHeight: 0, width: '100%' }} aria-label={`${r.name} ${r.type} content`} />
                </td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    <button className="btn ghost icon sm" title="Save" disabled={edits[key(r)] == null || busy !== ''} onClick={() => save(r)}>
                      <Save size={12} />
                    </button>
                    <button className="btn ghost icon sm danger" title="Delete" disabled={busy !== '' || r.type === 'NS' || r.type === 'SOA'} onClick={() => run({ method: 'DELETE', path: '/h/dns', noProfile: true, body: { domain, filters: [{ name: r.name, type: r.type }] }, label: `${r.name} ${r.type} deleted`, confirm: `Delete ${r.name} ${r.type} (${r.records.map((x) => x.content).join(', ')})?`, invalidate: ['/h/dns'] })}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {zone.data && !zone.data.zone.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No records in this zone.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {out && <Out out={{ stdout: JSON.stringify(out, null, 2), stderr: '', code: 0, ok: true, ms: 0 }} title="Hostinger response" />}
    </div>
  )
}
