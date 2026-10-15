import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Code2, KeyRound, Timer } from 'lucide-react'
import { api } from '../../api/client'
import { devKeys, useDevStatus } from '../../api/dev'
import type { AiSettingsView } from '../../api/types'
import { useUI } from '../../store/ui'

export function DevSettingsPage() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const { data: status } = useDevStatus()
  const [params] = useSearchParams()
  const [account, setAccount] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [minutes, setMinutes] = useState(120)
  useEffect(() => {
    if (status) setMinutes(status.sessionMinutes)
  }, [status])
  const ai = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<{ settings: AiSettingsView }>('/api/ai/settings') })

  const change = useMutation({
    mutationFn: () => {
      if (pw !== confirm) throw new Error('The two developer passwords do not match')
      return api.post('/api/dev/password', { accountPassword: account, password: pw })
    },
    onSuccess: () => {
      setAccount('')
      setPw('')
      setConfirm('')
      qc.invalidateQueries({ queryKey: devKeys.status })
      notify('Developer password changed', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const saveMinutes = useMutation({
    mutationFn: () => api.put('/api/dev/settings', { sessionMinutes: minutes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devKeys.status })
      notify('Session length saved', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const chatCode = useMutation({
    mutationFn: (on: boolean) => api.put('/api/ai/settings', { allowCodeChanges: on }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-settings'] })
      qc.invalidateQueries({ queryKey: ['ai-status'] })
      notify('Saved', 'success')
    },
  })

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div>
        <div className="eyebrow">Developer</div>
        <h1 style={{ margin: 0 }}>Developer settings</h1>
      </div>

      <form className="card stack" style={{ gap: 12 }} onSubmit={(e: FormEvent) => { e.preventDefault(); change.mutate() }}>
        <h3 style={{ margin: 0 }}>
          <KeyRound size={15} /> Developer password
        </h3>
        <p className="muted small" style={{ margin: 0 }}>
          {params.get('reset') ? 'Reset the developer password with your account password. ' : ''}
          Set {status?.passwordSetAt ? new Date(status.passwordSetAt).toLocaleString() : 'never'}. It is asked once per sign-in session that opens this panel.
        </p>
        <div className="field">
          <label htmlFor="ds-account">Your account password</label>
          <input id="ds-account" className="input" type="password" autoComplete="current-password" value={account} onChange={(e) => setAccount(e.target.value)} required />
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field grow">
            <label htmlFor="ds-new">New developer password</label>
            <input id="ds-new" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required />
          </div>
          <div className="field grow">
            <label htmlFor="ds-confirm">Confirm</label>
            <input id="ds-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
        </div>
        <div>
          <button className="btn primary" disabled={change.isPending || !account || pw.length < 8 || !confirm}>
            Change developer password
          </button>
        </div>
      </form>

      <section className="card stack" style={{ gap: 12 }}>
        <h3 style={{ margin: 0 }}>
          <Timer size={15} /> Session length
        </h3>
        <p className="muted small" style={{ margin: 0 }}>A developer session locks itself after this many minutes without activity, and always when you sign out.</p>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 160 }}>
            <label htmlFor="ds-minutes">Minutes (10–720)</label>
            <input id="ds-minutes" className="input" type="number" min={10} max={720} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </div>
          <button className="btn" onClick={() => saveMinutes.mutate()} disabled={saveMinutes.isPending}>
            Save
          </button>
        </div>
      </section>

      <section className="card stack" style={{ gap: 12 }}>
        <h3 style={{ margin: 0 }}>
          <Code2 size={15} /> Chat assistant and source code
        </h3>
        <p className="muted small" style={{ margin: 0 }}>
          The developer AI on this panel always edits the workspace (checkpointed and logged). The everyday chat assistant (the drawer, Ctrl/⌘ J) only reads the code unless you allow it here; its edits land in the same workspace but are not tied to a developer session.
        </p>
        <label className="checkbox between">
          <span>Let the chat assistant edit the source workspace (owner conversations only)</span>
          <input type="checkbox" checked={!!ai.data?.settings.allowCodeChanges} onChange={(e) => chatCode.mutate(e.target.checked)} />
        </label>
        <p className="muted small" style={{ margin: 0 }}>
          Connection, model and persona live in the owner console under Assistant; the developer AI uses the same connection.
        </p>
      </section>
    </div>
  )
}
