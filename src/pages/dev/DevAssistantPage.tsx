import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Cpu, FileDiff, MessageSquarePlus, Send, Sparkles, Square, Trash2, Wrench } from 'lucide-react'
import { api } from '../../api/client'
import { useAiConversation, useAiConversations, useAiStatus, useMe } from '../../api/hooks'
import { useChanges, useDevStatus, useInvalidateWorkspace } from '../../api/dev'
import type { AiConversation, AiMessage } from '../../api/types'
import { streamTurn, type LiveTurn } from '../../components/AssistantPanel'
import { Markdown } from '../../components/Markdown'
import { Avatar } from '../../components/Avatar'
import { useUI } from '../../store/ui'

const SUGGESTIONS = [
  'Add a "Download all" button to the gallery page that zips every public album',
  'Make the album card show the number of videos next to the photo count',
  'Review server/src/routes/media.ts for security problems and fix what you find',
  'Add a dark/light toggle to the public landing page footer',
  'Explain how the registry of albums and galleries is wired, file by file',
]

/** The integrated Claude Code developer: full workspace access, checkpointed and logged on this session. */
export function DevAssistantPage() {
  const { data: me } = useMe()
  const { data: status } = useAiStatus(!!me)
  const { data: dev } = useDevStatus()
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const invalidateWs = useInvalidateWorkspace()
  const { data: conversations } = useAiConversations(true, 'dev')
  const { data: changes } = useChanges()
  const [convId, setConvId] = useState<number | null>(null)
  const { data: thread } = useAiConversation(convId)
  const [text, setText] = useState('')
  const [live, setLive] = useState<LiveTurn | null>(null)
  const location = useLocation()
  useEffect(() => {
    const p = (location.state as { prompt?: string } | null)?.prompt
    if (p) setText(p)
  }, [location.state])
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (convId == null && conversations?.length) setConvId(conversations[0].id)
  }, [conversations, convId])
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [thread?.messages.length, live?.text, live?.tools.length])

  const create = useMutation({
    mutationFn: () => api.post<{ conversation: AiConversation }>('/api/ai/conversations', { mode: 'dev' }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['ai-conversations', 'dev'] })
      setConvId(r.conversation.id)
    },
    onError: (e: Error) => notify(e.message, 'error'),
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/ai/conversations/${id}`),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ['ai-conversations', 'dev'] })
      if (convId === id) setConvId(null)
    },
  })

  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    const content = text.trim()
    if (!content || live) return
    let id = convId
    if (id == null) {
      const r = await api.post<{ conversation: AiConversation }>('/api/ai/conversations', { mode: 'dev' })
      id = r.conversation.id
      setConvId(id)
      qc.invalidateQueries({ queryKey: ['ai-conversations', 'dev'] })
    }
    setText('')
    const optimistic: AiMessage = { id: -Date.now(), role: 'user', content, createdAt: Date.now(), meta: {} }
    qc.setQueryData<{ conversation: AiConversation; messages: AiMessage[] }>(['ai-conversation', id], (old) => (old ? { ...old, messages: [...old.messages, optimistic] } : { conversation: { id: id!, title: content.slice(0, 60), mode: 'dev', createdAt: Date.now(), updatedAt: Date.now(), messages: 1 }, messages: [optimistic] }))
    const turn: LiveTurn = { text: '', status: 'Checkpointing the workspace…', tools: [], error: null }
    setLive({ ...turn })
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await streamTurn(
        id,
        content,
        { url: '/dev/assistant', title: 'Developer panel' },
        (event, data) => {
          if (event === 'text') turn.text += String(data.text ?? '')
          else if (event === 'status') turn.status = String(data.text ?? '')
          else if (event === 'tool') turn.tools.push({ name: String(data.name ?? ''), input: String(data.input ?? '') })
          else if (event === 'error') turn.error = String(data.message ?? 'Something went wrong')
          else if (event === 'done') turn.text = String(data.text ?? turn.text)
          setLive({ ...turn, tools: [...turn.tools] })
        },
        ac.signal,
      )
    } catch (err) {
      if ((err as Error).name !== 'AbortError') turn.error = (err as Error).message
    } finally {
      abortRef.current = null
      await qc.invalidateQueries({ queryKey: ['ai-conversation', id] })
      qc.invalidateQueries({ queryKey: ['ai-conversations', 'dev'] })
      invalidateWs()
      if (turn.error) notify(turn.error, 'error')
      setLive(null)
    }
  }

  const name = status?.assistantName ?? 'Developer AI'
  const backend = status?.backends.subscription ? 'Claude subscription' : status?.backends.api ? 'Claude API' : 'not connected'
  const connected = !!(status?.backends.subscription || status?.backends.api)

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="eyebrow">Developer</div>
          <h1 style={{ margin: 0 }}>{name} · developer mode</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {backend} · {status?.model} · full write access to the workspace (snapshot {dev?.sourceVersion}) · checkpoint before every turn · every file change logged to session #{dev?.session?.id}
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Link to="/dev/code" className="btn sm">
            <FileDiff size={13} /> {changes?.files.length ?? 0} changed file{changes?.files.length === 1 ? '' : 's'}
          </Link>
          <button className="btn sm" onClick={() => create.mutate()}>
            <MessageSquarePlus size={13} /> New conversation
          </button>
        </div>
      </div>
      {!connected && (
        <div className="error">
          No Claude backend is connected. Add your subscription token or an API key in <Link to="/admin/assistant">Owner console → Assistant</Link>; the developer AI uses the same connection.
        </div>
      )}

      <div className="dev-chat">
        <aside className="card dev-chat-list">
          {(conversations ?? []).map((c) => (
            <div key={c.id} className={`assistant-conv ${c.id === convId ? 'active' : ''}`}>
              <button className="assistant-conv-main" onClick={() => setConvId(c.id)}>
                <strong className="clamp-1">{c.title}</strong>
                <span className="muted small">
                  {c.messages} messages · {new Date(c.updatedAt).toLocaleDateString()}
                </span>
              </button>
              <button className="btn ghost icon sm" title="Delete" onClick={() => confirm('Delete this conversation? (Workspace changes stay.)') && remove.mutate(c.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {conversations && conversations.length === 0 && (
            <div className="muted small" style={{ padding: 12 }}>
              No developer conversations yet.
            </div>
          )}
        </aside>
        <div className="card dev-chat-main">
          <div className="dev-chat-body">
            {(!thread || thread.messages.length === 0) && !live && (
              <div className="assistant-welcome">
                <Sparkles size={28} />
                <h3>Tell {name} what to build</h3>
                <p className="muted small">It reads and edits the real source in the workspace copy. Try one of these, or describe any change in plain words.</p>
                <div className="assistant-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="chip chip-tag" onClick={() => setText(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {thread?.messages.map((m) => {
              const changed = (m.meta.tools ?? []).filter((t) => t.startsWith('changed:')).map((t) => t.slice(8))
              return (
                <div key={m.id} className={`assistant-msg ${m.role === 'assistant' ? 'from-ai' : 'from-user'}`}>
                  {m.role === 'assistant' ? (
                    <div className="assistant-avatar">
                      <Sparkles size={14} />
                    </div>
                  ) : (
                    <Avatar name={me?.display_name ?? ''} size={26} src={me?.avatarUrl} />
                  )}
                  <div className="assistant-bubble">
                    {m.role === 'assistant' ? <Markdown text={m.content} /> : <p>{m.content}</p>}
                    {m.role === 'assistant' && (
                      <div className="assistant-meta muted small">
                        {m.meta.backend === 'subscription' ? 'Subscription' : m.meta.backend === 'api' ? 'API' : ''}
                        {m.meta.tools?.length ? ` · ${m.meta.tools.filter((t) => !t.startsWith('changed:')).length} tool calls` : ''}
                        {changed.length > 0 && (
                          <span className="dev-changed-files">
                            {' · changed: '}
                            {changed.map((p) => (
                              <Link key={p} to={`/dev/code?path=${encodeURIComponent(p)}`}>
                                {p}
                              </Link>
                            ))}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {live && (
              <div className="assistant-msg from-ai">
                <div className="assistant-avatar">
                  <Sparkles size={14} />
                </div>
                <div className="assistant-bubble">
                  {live.tools.length > 0 && (
                    <div className="assistant-tools">
                      {live.tools.slice(-8).map((t, i) => (
                        <span key={i} className="chip">
                          <Wrench size={10} /> {t.name}
                          {t.input ? `: ${t.input}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {live.text ? <Markdown text={live.text} /> : <div className="muted small assistant-status">{live.status}</div>}
                  {live.error && <div className="error">{live.error}</div>}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form className="assistant-compose" onSubmit={send}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <textarea
                className="textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder="Describe the change you want built… (Enter to send, Shift+Enter for a new line)"
                rows={3}
                disabled={!!live}
                aria-label="Developer prompt"
              />
              {live ? (
                <button type="button" className="btn icon" title="Stop" onClick={() => abortRef.current?.abort()}>
                  <Square size={15} />
                </button>
              ) : (
                <button className="btn primary icon" title="Send" disabled={!text.trim()}>
                  <Send size={15} />
                </button>
              )}
            </div>
            <div className="assistant-foot muted small">
              <span>
                <Cpu size={11} /> {status?.model} · {backend}
              </span>
              <span>Developer mode: edits are checkpointed and logged</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
