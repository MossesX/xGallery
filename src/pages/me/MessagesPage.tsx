import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, MessageCircle, Search, Send } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useConversations, useMe, usePeople, useSendMessage, useThread } from '../../api/hooks'
import { Avatar } from '../../components/Avatar'
import { PageLoader } from '../../components/Skeleton'
import { timeAgo } from '../../lib/media'
import { useUI } from '../../store/ui'

/** Private messaging: a conversation list beside the open thread. */
export function MessagesPage() {
  const { id } = useParams()
  const peerId = id ? Number(id) : null
  const navigate = useNavigate()
  const { data: me } = useMe()
  const { data: conversations, isLoading } = useConversations()
  const [q, setQ] = useState('')
  const { data: people } = usePeople(q, q.length > 0)
  const { data: thread } = useThread(peerId)
  const send = useSendMessage(peerId)
  const notify = useUI((s) => s.notify)
  const [body, setBody] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
    // Opening a thread marks it read on the server; refresh the unread badges to match.
    if (thread) {
      qc.invalidateQueries({ queryKey: ['unread'] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    }
  }, [thread, peerId, qc])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    send.mutate(text, { onSuccess: () => setBody(''), onError: (err: Error) => notify(err.message, 'error') })
  }

  return (
    <div className="stack" style={{ gap: 'calc(var(--space) * 2)' }}>
      <div>
        <div className="eyebrow">Private</div>
        <h1 style={{ margin: 0 }}>Messages</h1>
      </div>
      <div className={`messages ${peerId != null ? 'has-thread' : ''}`}>
        <aside className="conv-list">
          <label className="feed-search" style={{ margin: 10 }}>
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="New message to…" aria-label="Find someone to message" />
          </label>
          {q && (
            <div className="conv-results">
              {!people?.length ? (
                <div className="muted small" style={{ padding: '6px 14px' }}>
                  Nobody matches.
                </div>
              ) : (
                people.slice(0, 8).map((p) => (
                  <button key={p.id} className="conv" onClick={() => { setQ(''); navigate(`/me/messages/${p.id}`) }}>
                    <Avatar name={p.displayName} size={36} src={p.avatarUrl} />
                    <span className="conv-text">
                      <strong>{p.displayName}</strong>
                      <span className="muted small">@{p.username}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
          {isLoading ? (
            <PageLoader />
          ) : !conversations?.length ? (
            <div className="empty" style={{ margin: 10 }}>
              <MessageCircle size={32} strokeWidth={1.2} />
              <p style={{ marginTop: 8 }}>No conversations yet. Search for someone above or message them from their page.</p>
            </div>
          ) : (
            conversations.map((c) => (
              <Link key={c.person.id} to={`/me/messages/${c.person.id}`} className={`conv ${peerId === c.person.id ? 'active' : ''}`}>
                <Avatar name={c.person.displayName} size={40} src={c.person.avatarUrl} />
                <span className="conv-text">
                  <span className="row between">
                    <strong>{c.person.displayName}</strong>
                    <span className="muted small">{timeAgo(c.last.createdAt)}</span>
                  </span>
                  <span className={`small clamp-1 ${c.unread ? '' : 'muted'}`}>
                    {c.last.fromId === me?.id ? 'You: ' : ''}
                    {c.last.body}
                  </span>
                </span>
                {c.unread > 0 && <span className="nav-badge">{c.unread}</span>}
              </Link>
            ))
          )}
        </aside>
        <section className="thread">
          {peerId == null ? (
            <div className="empty thread-empty">
              <MessageCircle size={40} strokeWidth={1.2} />
              <p style={{ marginTop: 12 }}>Pick a conversation or find someone to message.</p>
            </div>
          ) : !thread ? (
            <PageLoader />
          ) : (
            <>
              <header className="thread-head">
                <Link to="/me/messages" className="btn ghost icon sm thread-back" aria-label="All conversations">
                  <ArrowLeft size={16} />
                </Link>
                <Link to={thread.person.gallerySlug ? `/public/${thread.person.gallerySlug}` : '#'} className="feed-person">
                  <Avatar name={thread.person.displayName} size={36} src={thread.person.avatarUrl} />
                  <span>
                    <strong>{thread.person.displayName}</strong>
                    <span className="muted small">@{thread.person.username}</span>
                  </span>
                </Link>
              </header>
              <div className="thread-body">
                {thread.messages.length === 0 && <div className="muted small" style={{ textAlign: 'center', padding: 24 }}>Say hello to {thread.person.displayName.split(' ')[0]}.</div>}
                {thread.messages.map((m, i) => {
                  const mine = m.fromId === me?.id
                  const prev = thread.messages[i - 1]
                  const gap = !prev || m.createdAt - prev.createdAt > 20 * 60_000
                  return (
                    <div key={m.id}>
                      {gap && <div className="thread-time muted small">{new Date(m.createdAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</div>}
                      <div className={`bubble ${mine ? 'mine' : ''}`} title={new Date(m.createdAt).toLocaleString()}>
                        {m.body}
                      </div>
                    </div>
                  )
                })}
                <div ref={endRef} />
              </div>
              <form className="thread-compose" onSubmit={submit}>
                <input className="input grow" value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Message ${thread.person.displayName.split(' ')[0]}…`} aria-label="Message" maxLength={4000} autoFocus />
                <button className="btn primary" disabled={!body.trim() || send.isPending} aria-label="Send">
                  <Send size={15} />
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
