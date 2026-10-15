import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, RefreshCw, Search, Sparkles } from 'lucide-react'
import { api } from '../../api/client'
import { devKeys, KIND_LABELS, useDevEvents, useDevSession, useDevSessions, type DevEvent } from '../../api/dev'
import { formatDate } from '../../components/Comments'
import { Markdown } from '../../components/Markdown'
import { useUI } from '../../store/ui'

function kindClass(kind: string): string {
  if (kind.startsWith('file.') || kind === 'ai.file_change') return 'k-file'
  if (kind.startsWith('ai.')) return 'k-ai'
  if (kind.includes('restore') || kind.includes('reset')) return 'k-restore'
  if (kind.startsWith('config') || kind.startsWith('theme')) return 'k-design'
  if (kind.startsWith('session')) return 'k-session'
  return ''
}

export function EventRow({ e, showSession }: { e: DevEvent; showSession?: boolean }) {
  const [open, setOpen] = useState(false)
  const d = e.detail as { added?: number; removed?: number }
  return (
    <div className={`dev-event ${kindClass(e.kind)}`} data-kind={e.kind}>
      <span className="dev-event-time muted small">{new Date(e.ts).toLocaleTimeString()}</span>
      <span className="chip">{KIND_LABELS[e.kind] ?? e.kind}</span>
      <span className="dev-event-main">
        {showSession && <span className="muted small">#{e.sessionId} · </span>}
        {e.path && <code>{e.path}</code>} {e.summary}
        {(d.added || d.removed) && (
          <span className="muted small">
            {' '}
            (+{d.added ?? 0} / −{d.removed ?? 0})
          </span>
        )}
      </span>
      {Object.keys(e.detail).length > 0 && (
        <button className="btn ghost sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Detail'}
        </button>
      )}
      {open && <pre className="dev-event-detail">{JSON.stringify(e.detail, null, 2)}</pre>}
    </div>
  )
}

/** Every developer session with its written summary and full event log, plus a global event search. */
export function DevSessionsPage() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'sessions' | 'events'>('sessions')
  const { data: sessions } = useDevSessions()
  const selectedId = params.get('id') ? Number(params.get('id')) : (sessions?.[0]?.id ?? null)
  const { data: detail } = useDevSession(selectedId)
  const [note, setNote] = useState('')
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [evKind, setEvKind] = useState('')
  const [evQ, setEvQ] = useState('')
  const events = useDevEvents({ kind: evKind, q: evQ, limit: '200' }, tab === 'events')
  useEffect(() => setNote(detail?.session.summary ?? ''), [detail?.session.id, detail?.session.summary])

  const summarize = useMutation({
    mutationFn: (id: number) => api.post(`/api/dev/sessions/${id}/summarize`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devKeys.session(selectedId) })
      qc.invalidateQueries({ queryKey: devKeys.sessions })
      notify('AI summary written', 'success')
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const saveNote = useMutation({
    mutationFn: (id: number) => api.put(`/api/dev/sessions/${id}`, { summary: note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devKeys.session(selectedId) })
      qc.invalidateQueries({ queryKey: devKeys.sessions })
      notify('Summary saved', 'success')
    },
  })

  const kinds = Array.from(new Set((detail?.events ?? []).map((e) => e.kind)))
  const filtered = (detail?.events ?? []).filter((e) => (!kind || e.kind === kind) && (!q || `${e.path} ${e.summary} ${JSON.stringify(e.detail)}`.toLowerCase().includes(q.toLowerCase())))

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 2)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="eyebrow">Developer</div>
          <h1 style={{ margin: 0 }}>Session log</h1>
        </div>
        <div className="feed-tabs">
          <button className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}>
            Sessions
          </button>
          <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>
            All events
          </button>
        </div>
      </div>

      {tab === 'events' ? (
        <section className="card stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="select" value={evKind} onChange={(e) => setEvKind(e.target.value)} aria-label="Event kind">
              <option value="">All kinds</option>
              {(events.data?.kinds ?? []).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k] ?? k}
                </option>
              ))}
            </select>
            <div className="search grow">
              <Search size={14} />
              <input value={evQ} onChange={(e) => setEvQ(e.target.value)} placeholder="Search path, summary, detail…" aria-label="Search events" />
            </div>
            <button className="btn ghost icon sm" onClick={() => events.refetch()} title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="dev-events">
            {(events.data?.events ?? []).map((e) => (
              <EventRow key={e.id} e={e} showSession />
            ))}
            {events.data && events.data.events.length === 0 && <p className="muted small">No events match.</p>}
          </div>
        </section>
      ) : (
        <div className="dev-sessions">
          <aside className="card dev-session-list">
            {(sessions ?? []).map((s) => (
              <button key={s.id} className={`dev-session-item ${s.id === selectedId ? 'active' : ''}`} onClick={() => setParams({ id: String(s.id) })}>
                <span className="row between">
                  <strong>#{s.id}</strong>
                  <span className={`badge ${s.open ? 'success' : ''}`}>{s.open ? 'open' : s.endReason || 'ended'}</span>
                </span>
                <span className="muted small">{formatDate(s.startedAt)}</span>
                <span className="muted small">
                  {s.changes} change{s.changes === 1 ? '' : 's'} · {s.files} file{s.files === 1 ? '' : 's'} · {s.events} events
                </span>
              </button>
            ))}
            {sessions && sessions.length === 0 && <p className="muted small">No sessions yet.</p>}
          </aside>
          <div className="stack grow" style={{ gap: 12, minWidth: 0 }}>
            {detail && (
              <>
                <section className="card stack" style={{ gap: 10 }}>
                  <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>Session #{detail.session.id}</h3>
                      <div className="muted small">
                        {formatDate(detail.session.startedAt)} → {detail.session.endedAt ? `${formatDate(detail.session.endedAt)} (${detail.session.endReason})` : 'still open'} · from {detail.session.ip} · {detail.session.userAgent.slice(0, 60)}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn sm" onClick={() => summarize.mutate(detail.session.id)} disabled={summarize.isPending}>
                        <Sparkles size={13} /> {summarize.isPending ? 'Summarising…' : 'Summarise with AI'}
                      </button>
                      <a className="btn sm" href={`/api/dev/sessions/${detail.session.id}/export.md`}>
                        <Download size={13} /> Export .md
                      </a>
                    </div>
                  </div>
                  <div className="eyebrow">
                    <FileText size={11} /> Summary {detail.session.summarySource ? `(${detail.session.summarySource})` : '(live)'}
                  </div>
                  {detail.session.summarySource === 'ai' ? <Markdown text={detail.session.summary} /> : <pre className="dev-summary">{detail.session.endedAt ? detail.session.summary : detail.liveSummary}</pre>}
                  <details>
                    <summary className="muted small">Write your own notes</summary>
                    <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 100, marginTop: 8 }} />
                    <button className="btn sm" style={{ marginTop: 6 }} onClick={() => saveNote.mutate(detail.session.id)} disabled={saveNote.isPending}>
                      Save notes as the summary
                    </button>
                  </details>
                </section>
                <section className="card stack" style={{ gap: 10 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0 }}>Events ({filtered.length})</h3>
                    <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter kind">
                      <option value="">All kinds</option>
                      {kinds.map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABELS[k] ?? k}
                        </option>
                      ))}
                    </select>
                    <div className="search grow">
                      <Search size={14} />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" aria-label="Filter events" />
                    </div>
                  </div>
                  <div className="dev-events">
                    {filtered.map((e) => (
                      <EventRow key={e.id} e={e} />
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
