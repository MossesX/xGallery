import { Link } from 'react-router-dom'
import { Code2, FileDiff, GitCommitHorizontal, History, LifeBuoy, Palette, ScrollText, Sparkles, Wand2 } from 'lucide-react'
import { useDevOverview } from '../../api/dev'
import { formatDate } from '../../components/Comments'
import { useUI } from '../../store/ui'

export function DevOverviewPage() {
  const { data, isLoading } = useDevOverview()
  const setDesignMode = useUI((s) => s.setDesignMode)
  if (isLoading || !data) return <div className="muted">Loading…</div>
  const w = data.workspace
  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 3)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow">Developer</div>
          <h1 style={{ margin: 0 }}>{data.site.title} developer panel</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Source snapshot <code>{data.status.sourceVersion}</code> · workspace at <code>{w.head || 'n/a'}</code> · {data.ai.subscription ? 'Claude subscription connected' : data.ai.api ? 'Claude API connected' : 'no Claude backend yet'}
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link to="/dev/assistant" className="btn primary">
            <Sparkles size={14} /> Ask the developer AI
          </Link>
          <button className="btn" onClick={() => setDesignMode(true)}>
            <Wand2 size={14} /> Design mode
          </button>
        </div>
      </div>

      <div className="stat-grid dev-stats">
        <Link to="/dev/code" className="card stat">
          <FileDiff size={18} />
          <strong>{w.changedFiles}</strong>
          <span>changed source file{w.changedFiles === 1 ? '' : 's'} (+{w.added} / −{w.removed})</span>
        </Link>
        <Link to="/dev/restore" className="card stat">
          <GitCommitHorizontal size={18} />
          <strong>{w.checkpoints}</strong>
          <span>code checkpoints</span>
        </Link>
        <Link to="/dev/restore" className="card stat">
          <History size={18} />
          <strong>{data.counts.snapshots}</strong>
          <span>design snapshots</span>
        </Link>
        <Link to="/dev/sessions" className="card stat">
          <ScrollText size={18} />
          <strong>{data.counts.events}</strong>
          <span>logged events in {data.counts.sessions} session{data.counts.sessions === 1 ? '' : 's'}</span>
        </Link>
        <Link to="/dev/themes" className="card stat">
          <Palette size={18} />
          <strong>{data.counts.themes}</strong>
          <span>themes</span>
        </Link>
      </div>

      <section className="card stack" style={{ gap: 12 }}>
        <div className="row between">
          <h3 style={{ margin: 0 }}>How this panel keeps the site safe</h3>
          <LifeBuoy size={16} className="muted" />
        </div>
        <ul className="dev-safety">
          <li>
            <strong>Design edits</strong> (menus, toolbar, footer, home page, themes, CSS, switches) are stored as data and snapshotted before every save. <Link to="/dev/restore">Restore any snapshot</Link> or factory-reset the design in one click.
          </li>
          <li>
            <strong>Source edits</strong> happen in a git-backed copy of the code, never in the running site. A checkpoint is taken before every change (yours or the AI's); <Link to="/dev/restore">restore any checkpoint</Link>, restore single files, or re-seed the workspace. Deploy by exporting the patch.
          </li>
          <li>
            <strong>Everything is logged</strong>: who, when, every file (+/− lines), every design save, every AI turn, every restore — per session, with a written summary. See the <Link to="/dev/sessions">session log</Link>.
          </li>
          <li>
            <strong>Safe mode</strong>: if a design change ever breaks the page, open <code>{window.location.origin}/dev?safe=1</code> — the custom design is ignored in that tab so you can fix or restore it.
          </li>
        </ul>
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <div className="row between">
          <h3 style={{ margin: 0 }}>Recent developer sessions</h3>
          <Link to="/dev/sessions" className="btn sm ghost">
            All sessions
          </Link>
        </div>
        {data.recentSessions.length === 0 && <p className="muted small">No sessions yet.</p>}
        {data.recentSessions.map((s) => (
          <Link key={s.id} to={`/dev/sessions?id=${s.id}`} className="dev-session-row">
            <span className={`badge ${s.open ? 'success' : ''}`}>{s.open ? 'open' : s.endReason || 'ended'}</span>
            <span>
              <strong>#{s.id}</strong> · {formatDate(s.startedAt)} · {s.changes} change{s.changes === 1 ? '' : 's'} · {s.files} file{s.files === 1 ? '' : 's'}
            </span>
            <span className="muted small clamp-1">{s.summary.split('\n')[0]}</span>
          </Link>
        ))}
      </section>

      <section className="card stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>Quick actions</h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link to="/dev/code" className="btn sm">
            <Code2 size={13} /> Open the code editor
          </Link>
          <Link to="/dev/navigation" className="btn sm">
            Edit navigation
          </Link>
          <Link to="/dev/home" className="btn sm">
            Build the home page
          </Link>
          <Link to="/dev/css" className="btn sm">
            Custom CSS
          </Link>
          <Link to="/dev/features" className="btn sm">
            Feature switches
          </Link>
          <a className="btn sm" href="/api/dev/patch">
            Export patch
          </a>
        </div>
      </section>
    </div>
  )
}
