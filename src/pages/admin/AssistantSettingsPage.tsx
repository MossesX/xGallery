import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Code2, Download, FlaskConical, KeyRound, Plug, RefreshCw, Sparkles, X } from 'lucide-react'
import { api } from '../../api/client'
import { useAiSettings } from '../../api/hooks'
import type { AiSettingsView } from '../../api/types'
import { useUI } from '../../store/ui'

type Draft = Pick<AiSettingsView, 'enabled' | 'model' | 'allowCodeChanges' | 'extraInstructions' | 'assistantName'> & { subscriptionToken: string; apiKey: string }

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (most capable)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (lightest)' },
]

/** Owner only: assistant backends, access defaults, persona and the code-change workspace. */
export function AssistantSettingsPage() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const { data } = useAiSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [testing, setTesting] = useState<'both' | 'subscription' | 'api' | null>(null)
  useEffect(() => {
    if (data && !draft) setDraft({ enabled: data.settings.enabled, model: data.settings.model, allowCodeChanges: data.settings.allowCodeChanges, extraInstructions: data.settings.extraInstructions, assistantName: data.settings.assistantName, subscriptionToken: '', apiKey: '' })
  }, [data, draft])
  const workspace = useQuery({ queryKey: ['ai-workspace'], queryFn: () => api.get<{ diff: string; files: string[]; sourceVersion: string }>('/api/ai/workspace'), enabled: !!data?.settings.allowCodeChanges })

  const save = useMutation({
    mutationFn: (patch: Partial<Draft> & { clearSubscriptionToken?: boolean; clearApiKey?: boolean }) => api.put<{ settings: AiSettingsView }>('/api/ai/settings', patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
      qc.invalidateQueries({ queryKey: ['ai-status'] })
      setDraft((d) => (d ? { ...d, subscriptionToken: '', apiKey: '' } : d))
      notify('Assistant settings saved', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const runTest = useMutation({
    mutationFn: (which: 'both' | 'subscription' | 'api') => {
      setTesting(which)
      return api.post<{ subscription?: { ok: boolean; detail: string }; api?: { ok: boolean; detail: string } }>('/api/ai/settings/test', { which })
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
      qc.invalidateQueries({ queryKey: ['ai-status'] })
      const bits = [r.subscription && `Subscription: ${r.subscription.ok ? 'connected' : 'failed'}`, r.api && `API: ${r.api.ok ? 'connected' : 'failed'}`].filter(Boolean)
      notify(bits.join(' · '), (r.subscription?.ok ?? true) && (r.api?.ok ?? true) ? 'success' : 'error')
    },
    onError: (e: Error) => notify(e.message, 'error'),
    onSettled: () => setTesting(null),
  })
  const reset = useMutation({
    mutationFn: () => api.post('/api/ai/workspace/reset', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-workspace'] })
      notify('Workspace reset to the deployed source', 'success')
    },
  })

  if (!data || !draft) return null
  const s = data.settings

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div>
        <div className="eyebrow">Owner only</div>
        <h1 style={{ margin: 0 }}>Assistant</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          A built-in Claude assistant that knows this app and its source (snapshot {data.sourceVersion}). Runs on your Claude subscription first and falls back to the API. Choose who may use it in Members.
        </p>
      </div>

      <div className="two-col">
        <section className="card stack" style={{ gap: 'calc(var(--space) * 2)' }}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>
              <Sparkles size={15} /> General
            </h3>
            {s.enabled ? <span className="badge success">On</span> : <span className="badge">Off</span>}
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Assistant available to allowed members
          </label>
          <div className="field">
            <label>Assistant name</label>
            <input className="input" value={draft.assistantName} onChange={(e) => setDraft({ ...draft, assistantName: e.target.value })} />
          </div>
          <div className="field">
            <label>Model</label>
            <select className="select" value={MODELS.some((m) => m.id === draft.model) ? draft.model : 'custom'} onChange={(e) => e.target.value !== 'custom' && setDraft({ ...draft, model: e.target.value })}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            <input className="input" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="model id" style={{ marginTop: 6 }} />
          </div>
          <div className="field">
            <label>Extra instructions (added to the system prompt)</label>
            <textarea className="textarea" value={draft.extraInstructions} onChange={(e) => setDraft({ ...draft, extraInstructions: e.target.value })} placeholder="House style, things to avoid, who the members are…" style={{ minHeight: 100 }} />
          </div>
          <div>
            <button className="btn primary" onClick={() => save.mutate({ enabled: draft.enabled, model: draft.model, extraInstructions: draft.extraInstructions, assistantName: draft.assistantName })} disabled={save.isPending}>
              Save general settings
            </button>
          </div>
        </section>

        <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
          <section className="card stack" style={{ gap: 'calc(var(--space) * 2)' }}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>
                <Plug size={15} /> Connection
              </h3>
              <button className="btn sm" onClick={() => runTest.mutate('both')} disabled={!!testing}>
                <FlaskConical size={14} /> {testing === 'both' ? 'Verifying…' : 'Verify both'}
              </button>
            </div>
            <div className="conn-rows">
              <ConnRow
                title="1 · Claude subscription"
                hint="Primary. Turns run through Claude Code on your plan; no API charges."
                has={s.hasSubscriptionToken}
                source={s.sources.subscription}
                verifiedAt={s.subscriptionVerifiedAt}
                detail={s.subscriptionVerifiedDetail}
                extra={!data.cliInstalled ? 'Claude Code CLI is missing in this container' : ''}
                busy={testing === 'subscription' || testing === 'both'}
                onVerify={() => runTest.mutate('subscription')}
              />
              <ConnRow
                title="2 · Backup: Anthropic API"
                hint="Used when the subscription backend is missing or fails. Billed per token."
                has={s.hasApiKey}
                source={s.sources.api}
                verifiedAt={s.apiVerifiedAt}
                detail={s.apiVerifiedDetail}
                busy={testing === 'api' || testing === 'both'}
                onVerify={() => runTest.mutate('api')}
              />
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Used so far: {s.usage.subscription} subscription turn{s.usage.subscription === 1 ? '' : 's'}, {s.usage.api} API turn{s.usage.api === 1 ? '' : 's'}
              {s.usage.lastBackend ? ` · last reply via ${s.usage.lastBackend === 'subscription' ? 'subscription' : 'API'} ${s.usage.lastAt ? new Date(s.usage.lastAt).toLocaleString() : ''}` : ''}.
            </p>
          </section>

          <section className="card stack" style={{ gap: 'calc(var(--space) * 2)' }}>
            <h3 style={{ margin: 0 }}>
              <KeyRound size={15} /> Credentials
            </h3>
            <div className="field">
              <label>Claude subscription token</label>
              <input className="input" type="password" autoComplete="off" value={draft.subscriptionToken} onChange={(e) => setDraft({ ...draft, subscriptionToken: e.target.value })} placeholder={s.hasSubscriptionToken ? 'Paste a new token to replace it' : 'sk-ant-oat01-…'} />
              <details className="setup-steps">
                <summary className="muted small">How to get the token</summary>
                <ol className="small">
                  <li>
                    On your own computer install Claude Code: <code>npm install -g @anthropic-ai/claude-code</code>
                  </li>
                  <li>
                    Sign in to your Claude subscription: <code>claude login</code>
                  </li>
                  <li>
                    Create a long-lived token: <code>claude setup-token</code>
                  </li>
                  <li>Paste the token here, save, then press Verify. The token is stored on the server and never shown again.</li>
                </ol>
                <p className="muted small" style={{ margin: 0 }}>
                  Alternative: set <code>CLAUDE_CODE_OAUTH_TOKEN</code> in the container environment; a saved token here takes precedence.
                </p>
              </details>
            </div>
            <div className="field">
              <label>Anthropic API key (backup)</label>
              <input className="input" type="password" autoComplete="off" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder={s.hasApiKey ? 'Paste a new key to replace it' : 'sk-ant-api03-…'} />
              <p className="muted small" style={{ margin: '6px 0 0' }}>
                From console.anthropic.com → API keys. Alternative: set <code>ANTHROPIC_API_KEY</code> in the container environment.
              </p>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => save.mutate({ subscriptionToken: draft.subscriptionToken || undefined, apiKey: draft.apiKey || undefined })} disabled={save.isPending || (!draft.subscriptionToken && !draft.apiKey)}>
                Save credentials
              </button>
              {s.sources.subscription === 'settings' && (
                <button className="btn ghost sm" onClick={() => save.mutate({ clearSubscriptionToken: true })}>
                  Remove token
                </button>
              )}
              {s.sources.api === 'settings' && (
                <button className="btn ghost sm" onClick={() => save.mutate({ clearApiKey: true })}>
                  Remove API key
                </button>
              )}
            </div>
          </section>

          <section className="card stack" style={{ gap: 'calc(var(--space) * 2)' }}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>
                <Code2 size={15} /> Building source code
              </h3>
              {s.allowCodeChanges ? <span className="badge success">Allowed</span> : <span className="badge">Read only</span>}
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={draft.allowCodeChanges} onChange={(e) => { setDraft({ ...draft, allowCodeChanges: e.target.checked }); save.mutate({ allowCodeChanges: e.target.checked }) }} /> Allow the assistant to edit source code (you only)
            </label>
            <p className="muted small" style={{ margin: 0 }}>
              When on, your conversations run against a writable copy of the repository. The assistant can create and edit files; nothing is deployed. Review the diff below, download it as a patch and apply it in git, then reset the workspace.
            </p>
            {s.allowCodeChanges && (
              <div className="stack" style={{ gap: 10 }}>
                <div className="row between">
                  <span className="small muted">
                    {workspace.data?.files.length ? `${workspace.data.files.length} changed file${workspace.data.files.length === 1 ? '' : 's'}` : 'No changes in the workspace'}
                    {workspace.data ? ` · snapshot ${workspace.data.sourceVersion}` : ''}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn ghost icon sm" title="Refresh" onClick={() => workspace.refetch()}>
                      <RefreshCw size={14} />
                    </button>
                    {!!workspace.data?.files.length && (
                      <>
                        <a className="btn sm" href="/api/ai/workspace/patch">
                          <Download size={14} /> Patch
                        </a>
                        <button className="btn ghost sm danger" onClick={() => confirm('Discard every change the assistant made?') && reset.mutate()}>
                          Reset
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {!!workspace.data?.files.length && (
                  <>
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      {workspace.data.files.map((f) => (
                        <li key={f}>
                          <code>{f}</code>
                        </li>
                      ))}
                    </ul>
                    <pre className="diff">{workspace.data.diff.slice(0, 60000)}</pre>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function ConnRow({ title, hint, has, source, verifiedAt, detail, extra, busy, onVerify }: { title: string; hint: string; has: boolean; source: 'none' | 'settings' | 'env'; verifiedAt: number | null; detail: string; extra?: string; busy: boolean; onVerify: () => void }) {
  const state = extra ? 'blocked' : !has ? 'missing' : verifiedAt ? 'connected' : detail ? 'failed' : 'unverified'
  return (
    <div className={`conn-row is-${state}`}>
      <span className={`conn-dot ${state}`} aria-hidden />
      <div className="conn-main">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <strong>{title}</strong>
          {state === 'connected' && <span className="badge success">Connected</span>}
          {state === 'unverified' && <span className="badge primary">Saved · not verified</span>}
          {state === 'failed' && <span className="badge danger">Failed</span>}
          {state === 'missing' && <span className="badge">Not set</span>}
          {state === 'blocked' && <span className="badge accent">Unavailable</span>}
          {source === 'env' && <span className="badge">from environment</span>}
        </div>
        <div className="muted small">{hint}</div>
        {(extra || detail) && (
          <div className={`small ${state === 'connected' ? 'success' : 'muted'}`}>
            {state === 'connected' ? <Check size={12} /> : <X size={12} />} {extra || detail}
            {verifiedAt ? ` · verified ${new Date(verifiedAt).toLocaleString()}` : ''}
          </div>
        )}
      </div>
      <button className="btn sm" onClick={onVerify} disabled={busy || !has || !!extra}>
        {busy ? 'Verifying…' : 'Verify'}
      </button>
    </div>
  )
}
