import { useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, KeyRound, Play, Save, Trash2 } from 'lucide-react'
import { api } from '../../../api/client'
import { GH, useGh, useGhSettings, useInvalidateGh } from '../../../api/github'
import { useUI } from '../../../store/ui'
import { Busy, Out } from './common'

const EXAMPLES = [
  ['Repository', 'GET', '{repo}'],
  ['Languages', 'GET', '{repo}/languages'],
  ['Traffic · views', 'GET', '{repo}/traffic/views'],
  ['Traffic · clones', 'GET', '{repo}/traffic/clones'],
  ['Branch protection', 'GET', '{repo}/branches/main/protection'],
  ['Dependabot alerts', 'GET', '{repo}/dependabot/alerts'],
  ['Code scanning', 'GET', '{repo}/code-scanning/alerts'],
  ['Packages (ghcr)', 'GET', '/users/{owner}/packages?package_type=container'],
  ['Rate limit', 'GET', '/rate_limit'],
] as const

export function GhSettingsTab() {
  const notify = useUI((s) => s.notify)
  const invalidate = useInvalidateGh()
  const { data } = useGhSettings()
  const [token, setToken] = useState('')
  const [form, setForm] = useState({ owner: '', repo: '', pollMinutes: 3, notify: true })
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (data) setForm({ owner: data.github.owner, repo: data.github.repo, pollMinutes: data.github.pollMinutes, notify: data.github.notify })
  }, [data])
  const me = useGh<{ user: { login: string; name: string; avatar: string; url: string; plan?: string }; scopes: string[]; tokenType: string; rate: { limit: number; remaining: number; reset: number } }>(data?.github.hasToken ? '/me' : null, { staleTime: 120_000 })
  const repos = useGh<{ repos: { full_name: string; private: boolean; default_branch: string; pushed_at: string }[] }>(data?.github.hasToken ? '/repos' : null, { staleTime: 300_000 })
  const [req, setReq] = useState({ method: 'GET', path: '{repo}', body: '' })
  const [out, setOut] = useState<string>('')
  const [exploring, setExploring] = useState(false)
  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true)
    try {
      await api.put(`${GH}/settings`, { ...form, ...(token ? { token } : {}), ...extra })
      setToken('')
      invalidate()
      notify('GitHub manager settings saved', 'success')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }
  const explore = async () => {
    setExploring(true)
    try {
      let body: unknown
      if (req.body.trim()) body = JSON.parse(req.body)
      const r = await api.post<{ result: unknown; status: number }>(`${GH}/raw`, { ...req, body })
      setOut(JSON.stringify(r.result, null, 2))
    } catch (e) {
      setOut((e as Error).message)
    } finally {
      setExploring(false)
    }
  }
  return (
    <div className="stack" style={{ gap: 12 }} data-gh-settings="">
      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>
          <KeyRound size={16} /> Token
        </h3>
        <p className="muted small" style={{ margin: 0 }}>
          Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">fine-grained token <ExternalLink size={10} /></a> for the repository with Read & write on Contents, Issues, Pull requests, Actions, Secrets, Variables, Webhooks and Administration (for collaborators), plus Metadata, or a classic token with <span className="mono">repo, workflow, admin:repo_hook, notifications</span>. It is stored on this server only (or comes from the GITHUB_TOKEN environment variable).
        </p>
        <div className="row" style={{ gap: 6 }}>
          {data?.github.hasToken ? (
            <span className="chip st-done">
              <CheckCircle2 size={11} /> token set ({data.github.tokenSource}) {data.github.tokenHint}
            </span>
          ) : (
            <span className="chip prio-high">no token</span>
          )}
          <input className="input sm grow mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={data?.github.hasToken ? 'paste a new token to replace it' : 'github_pat_… or ghp_…'} aria-label="GitHub token" autoComplete="off" />
          <button className="btn primary sm" disabled={!token || saving} onClick={() => save()} data-gh-save-token="">
            <Save size={12} /> Save token
          </button>
          {data?.github.tokenSource === 'settings' && (
            <button className="btn ghost sm danger" disabled={saving} onClick={() => window.confirm('Remove the stored GitHub token?') && save({ clearToken: true })}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
        {me.data && (
          <div className="row small" style={{ gap: 8 }}>
            <img src={me.data.user.avatar} alt="" width={22} height={22} style={{ borderRadius: '50%' }} />
            <span>
              Signed in as <strong>{me.data.user.login}</strong> {me.data.user.name ? `(${me.data.user.name})` : ''} · {me.data.tokenType} token
            </span>
            {me.data.scopes.length > 0 && <span className="muted">scopes: {me.data.scopes.join(', ')}</span>}
            <span className="muted">
              rate {me.data.rate.remaining}/{me.data.rate.limit}
            </span>
          </div>
        )}
        {me.error && <p className="muted small">{(me.error as Error).message}</p>}
      </section>
      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>Repository & refresh</h3>
        <div className="ops-grid">
          <label className="field">
            <span>Repository</span>
            {repos.data?.repos.length ? (
              <select className="select" value={`${form.owner}/${form.repo}`} onChange={(e) => { const [owner, repo] = e.target.value.split('/'); setForm({ ...form, owner, repo }) }} aria-label="Repository">
                {!repos.data.repos.some((r) => r.full_name === `${form.owner}/${form.repo}`) && <option value={`${form.owner}/${form.repo}`}>{form.owner}/{form.repo}</option>}
                {repos.data.repos.map((r) => (
                  <option key={r.full_name} value={r.full_name}>
                    {r.full_name} {r.private ? '(private)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="row" style={{ gap: 4 }}>
                <input className="input" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} placeholder="owner" aria-label="Owner" />
                <span>/</span>
                <input className="input" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} placeholder="repo" aria-label="Repo" />
              </div>
            )}
          </label>
          <label className="field">
            <span>Background refresh (minutes, 0 = webhook only)</span>
            <input className="input" type="number" min={0} max={60} value={form.pollMinutes} onChange={(e) => setForm({ ...form, pollMinutes: Number(e.target.value) })} aria-label="Poll minutes" />
          </label>
          <label className="field">
            <span>Owner notifications</span>
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={form.notify} onChange={(e) => setForm({ ...form, notify: e.target.checked })} /> failed runs, successful deploys, new PRs and issues, releases → site bell
            </label>
          </label>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn primary sm" disabled={saving} onClick={() => save()} data-gh-save-settings="">
            <Save size={12} /> Save
          </button>
          <button className="btn ghost sm" disabled={saving} onClick={() => save({ rotateWebhookSecret: true })} title="Then re-apply the webhook in the Webhooks tab">
            Rotate webhook secret
          </button>
          <span className="muted small">Webhook URL: <span className="mono">{data?.webhookUrl}</span></span>
        </div>
      </section>
      <section className="card stack" style={{ gap: 8 }} data-gh-explorer="">
        <h3 style={{ margin: 0 }}>API explorer</h3>
        <p className="muted small" style={{ margin: 0 }}>Any GitHub REST endpoint with the stored token. {'{repo}'} expands to /repos/owner/name, {'{owner}'} to the owner.</p>
        <div className="row" style={{ gap: 4 }}>
          {EXAMPLES.map(([l, m, p]) => (
            <button key={l} className="chip chip-tag" onClick={() => setReq({ method: m, path: p, body: '' })}>
              {l}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 4 }}>
          <select className="select sm" value={req.method} onChange={(e) => setReq({ ...req, method: e.target.value })} aria-label="Method">
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input className="input sm mono grow" value={req.path} onChange={(e) => setReq({ ...req, path: e.target.value })} aria-label="API path" />
          <button className="btn primary sm" onClick={explore} disabled={exploring}>
            <Busy on={exploring}>
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
