import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Check, Copy, Loader2, X } from 'lucide-react'
import { useVpsCall, withProfile, type ExecOut, type VpsCall } from '../../../api/vps'
import { useUI } from '../../../store/ui'

/** Which shell profile the manager talks to; set from the page header. */
export const VpsCtx = createContext<{ profile: string; p: (path: string) => string; hasToken: boolean; domain: string }>({ profile: '', p: (x) => x, hasToken: false, domain: '' })
export const useVpsCtx = () => useContext(VpsCtx)

/** The stdout/stderr of a command, with copy. */
export function Out({ out, title, maxHeight = 320, empty = 'No output' }: { out?: ExecOut | null | { stdout?: string; stderr?: string; code?: number | null; ok?: boolean; ms?: number } | string; title?: string; maxHeight?: number; empty?: string }) {
  const [copied, setCopied] = useState(false)
  if (out == null) return null
  const o = typeof out === 'string' ? { stdout: out, stderr: '', code: 0, ok: true, ms: 0 } : out
  const text = [o.stdout ?? '', o.stderr ?? ''].filter((x) => x && x.trim()).join('\n')
  const copy = () => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200) })
  return (
    <div className={`vps-out ${o.ok === false || (o.code != null && o.code !== 0) ? 'fail' : ''}`} data-vps-out="">
      <div className="vps-out-head">
        <span>{title ?? 'Output'}</span>
        {o.code != null && <span className={`chip ${o.code === 0 ? 'st-done' : 'st-blocked'}`}>exit {o.code}</span>}
        {o.code === null && typeof out !== 'string' && <span className="chip st-blocked">timed out</span>}
        {!!o.ms && <span className="muted small">{(o.ms / 1000).toFixed(1)}s</span>}
        <span className="grow" />
        <button className="btn ghost sm" onClick={copy} title="Copy output">
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre style={{ maxHeight }}>{text || empty}</pre>
    </div>
  )
}

/** Run VPS actions with a toast, a confirm for dangerous ones and the last output kept for display. */
export function useAction() {
  const notify = useUI((s) => s.notify)
  const { p } = useVpsCtx()
  const call = useVpsCall<ExecOut & Record<string, unknown>>()
  const [out, setOut] = useState<(ExecOut & Record<string, unknown>) | null>(null)
  const [busy, setBusy] = useState<string>('')
  const run = useCallback(
    async (c: VpsCall & { label?: string; confirm?: string; noProfile?: boolean; quiet?: boolean; key?: string }) => {
      if (c.confirm && !window.confirm(c.confirm)) return null
      setBusy(c.key ?? c.path)
      try {
        const r = await call.mutateAsync({ ...c, path: c.noProfile ? c.path : p(c.path) })
        setOut(r)
        if (!c.quiet) {
          if (r && typeof r === 'object' && 'ok' in r && r.ok === false) notify(`${c.label ?? 'Command'} failed${r.stderr ? `: ${String(r.stderr).trim().slice(0, 160)}` : ''}`, 'error')
          else notify(`${c.label ?? 'Done'}`, 'success')
        }
        return r
      } catch (e) {
        notify((e as Error).message, 'error')
        return null
      } finally {
        setBusy('')
      }
    },
    [call, notify, p],
  )
  return { run, out, setOut, busy, pending: call.isPending }
}

export function Busy({ on, children }: { on: boolean; children?: ReactNode }) {
  return on ? <Loader2 size={13} className="spin" /> : <>{children}</>
}

export function Kv({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="vps-kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function StateChip({ state }: { state: string }) {
  const cls = state === 'running' || state === 'healthy' ? 'st-done' : state === 'paused' || state === 'restarting' || state === 'starting' ? 'st-in_progress' : state === 'exited' || state === 'dead' || state === 'unhealthy' ? 'st-blocked' : ''
  return <span className={`chip ${cls}`}>{state || 'unknown'}</span>
}

/** Small inline dialog used for forms (create site, add rule, …). */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onClick={onClose} data-vps-dialog="">
      <div className={`modal card ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const relTime = (ms: number) => {
  const d = Date.now() - ms
  if (d < 60_000) return 'just now'
  if (d < 3600_000) return `${Math.round(d / 60_000)} min ago`
  if (d < 86400_000) return `${Math.round(d / 3600_000)} h ago`
  return new Date(ms).toLocaleDateString()
}

export { withProfile }
