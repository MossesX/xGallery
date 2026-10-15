import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, Plug, Smartphone, TerminalSquare, Trash2 } from 'lucide-react'
import { useOps } from '../../../api/ops'
import { type ExecOut } from '../../../api/vps'
import { Out, useAction, useVpsCtx } from './common'

interface Entry { cmd: string; out: ExecOut; at: number }
const KEY = 'xg-vps-console-history'

const SNIPPETS: { label: string; cmd: string }[] = [
  { label: 'Containers', cmd: "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'" },
  { label: 'App logs', cmd: 'docker logs --tail 100 xgallery-app' },
  { label: 'Disk', cmd: 'df -h; echo; du -sh /var/lib/docker /opt/* 2>/dev/null' },
  { label: 'Memory', cmd: 'free -h; echo; ps -eo pid,%mem,comm --sort=-%mem | head' },
  { label: 'Who is logged in', cmd: 'who; last -n 10' },
  { label: 'Failed logins', cmd: "journalctl -u ssh --since '24h ago' | grep -c 'Failed password'; fail2ban-client status sshd 2>/dev/null" },
  { label: 'Traefik routers', cmd: "docker ps --filter label=traefik.enable=true --format '{{.Names}}' | xargs -I{} sh -c \"docker inspect {} --format '{{.Name}}: {{range \\$k,\\$v := .Config.Labels}}{{if eq \\$k \\\"traefik.http.routers.\\\"}}{{end}}{{end}}'\"" },
  { label: 'Git status (deploy dir)', cmd: 'cd /opt/xgallery && git status --short | head; git log --oneline -5' },
  { label: 'Claude version', cmd: 'claude --version 2>&1; node --version; docker compose version' },
  { label: 'Open ports', cmd: 'ss -tulpn | head -40' },
]

/** One-shot commands over SSH with history; interactive work goes to the Terminal tab. */
export function ConsoleTab() {
  const { profile } = useVpsCtx()
  const { data: opsData } = useOps()
  const { run, busy } = useAction()
  const [cmd, setCmd] = useState('')
  const [timeout_, setTimeout_] = useState(60)
  const [history, setHistory] = useState<Entry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Entry[]
    } catch {
      return []
    }
  })
  const [hidx, setHidx] = useState(-1)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(history.slice(0, 50)))
    } catch {
      /* ignore */
    }
  }, [history])
  const exec = async (c = cmd) => {
    if (!c.trim()) return
    const r = await run({ path: '/exec', body: { command: c, timeout: timeout_ }, label: 'Ran', quiet: true, key: 'exec' })
    if (r) setHistory((h) => [{ cmd: c, out: r, at: Date.now() }, ...h].slice(0, 50))
    setCmd('')
    setHidx(-1)
  }
  const prof = opsData?.ops.shell.profiles.find((x) => x.id === profile) ?? opsData?.ops.shell.profiles[0]
  return (
    <div className="stack" style={{ gap: 12 }} data-vps-console="">
      <div className="row" style={{ gap: 6 }}>
        <span className="muted small">
          Runs as {prof ? `${prof.user}@${prof.host}` : 'the default profile'} with the panel key, non-interactive, up to {timeout_}s. Need a real shell, Claude Code, vim or a long job?
        </span>
        <Link className="btn sm" to="/dev/terminal">
          <Plug size={12} /> Terminal · SSH
        </Link>
        <Link className="btn sm" to="/dev/shell">
          <TerminalSquare size={12} /> mosh
        </Link>
        <Link className="btn sm" to="/dev/android">
          <Smartphone size={12} /> Phone
        </Link>
      </div>
      <div className="row" style={{ gap: 4 }}>
        {SNIPPETS.map((s) => (
          <button key={s.label} className="chip chip-tag" onClick={() => setCmd(s.cmd)} title={s.cmd}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="card stack" style={{ gap: 6 }}>
        <textarea
          ref={input}
          className="textarea mono"
          rows={3}
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="Command (Enter runs, Shift+Enter for a new line, ↑/↓ for history)"
          aria-label="Command"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              exec()
            } else if (e.key === 'ArrowUp' && (!cmd || hidx >= 0) && history.length) {
              e.preventDefault()
              const n = Math.min(history.length - 1, hidx + 1)
              setHidx(n)
              setCmd(history[n].cmd)
            } else if (e.key === 'ArrowDown' && hidx >= 0) {
              e.preventDefault()
              const n = hidx - 1
              setHidx(n)
              setCmd(n < 0 ? '' : history[n].cmd)
            }
          }}
        />
        <div className="row" style={{ gap: 6 }}>
          <button className="btn primary sm" onClick={() => exec()} disabled={busy === 'exec' || !cmd.trim()} data-vps-run="">
            <Play size={12} /> {busy === 'exec' ? 'Running…' : 'Run'}
          </button>
          <label className="row small muted" style={{ gap: 4 }}>
            timeout
            <select className="select sm" value={timeout_} onChange={(e) => setTimeout_(Number(e.target.value))}>
              {[15, 60, 300, 600].map((n) => (
                <option key={n} value={n}>
                  {n}s
                </option>
              ))}
            </select>
          </label>
          <span className="grow" />
          <button className="btn ghost sm" onClick={() => setHistory([])} disabled={!history.length}>
            <Trash2 size={12} /> Clear history
          </button>
        </div>
      </div>
      {history.map((h, i) => (
        <div key={h.at + i} className="stack" style={{ gap: 2 }}>
          <div className="row" style={{ gap: 6 }}>
            <code className="small">$ {h.cmd}</code>
            <span className="muted small">{new Date(h.at).toLocaleTimeString()}</span>
            <button className="btn ghost sm" onClick={() => exec(h.cmd)} disabled={busy === 'exec'}>
              run again
            </button>
          </div>
          <Out out={h.out} title={h.cmd.slice(0, 60)} maxHeight={i === 0 ? 480 : 160} />
        </div>
      ))}
    </div>
  )
}
