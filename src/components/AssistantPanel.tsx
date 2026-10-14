import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Code2, Cpu, History, MessageSquarePlus, Paperclip, Send, Sparkles, Square, Trash2, Wrench, X } from 'lucide-react'
import { api, ApiError } from '../api/client'
import { useAiConversation, useAiConversations, useAiStatus, useMe } from '../api/hooks'
import type { AiConversation, AiMessage, PageContext } from '../api/types'
import { useUI } from '../store/ui'
import { Markdown } from './Markdown'
import { Avatar } from './Avatar'

interface LiveTurn {
  text: string
  status: string
  tools: { name: string; input: string }[]
  error: string | null
}

/** Consume the server-sent event stream of one assistant turn. */
async function streamTurn(conversationId: number, content: string, context: PageContext, onEvent: (event: string, data: Record<string, unknown>) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/ai/conversations/${conversationId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, context }), credentials: 'include', signal })
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      let event = 'message'
      let data = ''
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data) continue
      try {
        onEvent(event, JSON.parse(data))
      } catch {
        /* ignore malformed */
      }
    }
  }
}

/** The assistant drawer: conversations, streamed replies, page context, and (owner) code-change mode. */
export function AssistantPanel() {
  const { data: me } = useMe()
  const { data: status } = useAiStatus(!!me)
  const open = useUI((s) => s.assistantOpen)
  const close = useUI((s) => s.closeAssistant)
  const convId = useUI((s) => s.assistantConversationId)
  const setConv = useUI((s) => s.setAssistantConversation)
  const draft = useUI((s) => s.assistantDraft)
  const clearDraft = useUI((s) => s.clearAssistantDraft)
  const notify = useUI((s) => s.notify)
  const qc = useQueryClient()
  const allowed = !!status?.allowed
  const { data: conversations } = useAiConversations(open && allowed)
  const { data: thread, error: threadError } = useAiConversation(open && allowed ? convId : null)
  const [text, setText] = useState('')
  const [context, setContext] = useState<PageContext>({})
  const [live, setLive] = useState<LiveTurn | null>(null)
  const [showList, setShowList] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (draft && open) {
      setText((t) => (t ? `${t}\n${draft.text}` : draft.text))
      setContext(draft.context)
      clearDraft()
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [draft, open, clearDraft])
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [thread?.messages.length, live?.text, live?.tools.length, open])
  useEffect(() => {
    // A remembered conversation that no longer exists (deleted, other account) falls back to a fresh one.
    if (threadError instanceof ApiError && threadError.status === 404) setConv(null)
  }, [threadError, setConv])

  const create = useMutation({
    mutationFn: () => api.post<{ conversation: AiConversation }>('/api/ai/conversations', {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['ai-conversations'] })
      setConv(r.conversation.id)
      setShowList(false)
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/ai/conversations/${id}`),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ['ai-conversations'] })
      if (convId === id) setConv(null)
    },
  })

  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    const content = text.trim()
    if (!content || live) return
    let id = convId
    if (id == null) {
      const r = await api.post<{ conversation: AiConversation }>('/api/ai/conversations', {})
      id = r.conversation.id
      setConv(id)
      qc.invalidateQueries({ queryKey: ['ai-conversations'] })
    }
    const ctx = { ...context, url: context.url ?? location.pathname + location.search, title: context.title ?? document.title }
    setText('')
    setContext({})
    const optimistic: AiMessage = { id: -Date.now(), role: 'user', content, createdAt: Date.now(), meta: { context: ctx } }
    qc.setQueryData<{ conversation: AiConversation; messages: AiMessage[] }>(['ai-conversation', id], (old) => (old ? { ...old, messages: [...old.messages, optimistic] } : { conversation: { id: id!, title: content.slice(0, 60), createdAt: Date.now(), updatedAt: Date.now(), messages: 1 }, messages: [optimistic] }))
    const turn: LiveTurn = { text: '', status: 'Connecting…', tools: [], error: null }
    setLive({ ...turn })
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await streamTurn(
        id,
        content,
        ctx,
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
      qc.invalidateQueries({ queryKey: ['ai-conversations'] })
      if (turn.error) notify(turn.error, 'error')
      setLive(null)
    }
  }

  if (!me || !allowed) return null
  const name = status?.assistantName ?? 'Assistant'
  const backend = status?.backends.subscription ? 'Claude subscription' : status?.backends.api ? 'Claude API' : 'not configured'

  return (
    <>
      {open && <div className="assistant-backdrop" onClick={close} />}
      <aside className={`assistant ${open ? 'open' : ''}`} aria-hidden={!open} aria-label={`${name} assistant`}>
        <header className="assistant-head">
          <button className="btn ghost icon sm" title="Conversations" onClick={() => setShowList((v) => !v)} aria-pressed={showList}>
            <History size={16} />
          </button>
          <div className="assistant-title">
            <Sparkles size={16} />
            <span>
              <strong>{name}</strong>
              <span className="muted small">
                {backend}
                {status?.codeChanges && me.role === 'owner' ? ' · code changes on' : ''}
              </span>
            </span>
          </div>
          <button className="btn ghost icon sm" title="New conversation" onClick={() => create.mutate()}>
            <MessageSquarePlus size={16} />
          </button>
          <button className="btn ghost icon sm" title="Close" onClick={close}>
            <X size={16} />
          </button>
        </header>

        {showList ? (
          <div className="assistant-list">
            {!conversations?.length ? (
              <div className="muted small" style={{ padding: 16 }}>
                No conversations yet.
              </div>
            ) : (
              conversations.map((c) => (
                <div key={c.id} className={`assistant-conv ${c.id === convId ? 'active' : ''}`}>
                  <button className="assistant-conv-main" onClick={() => { setConv(c.id); setShowList(false) }}>
                    <strong className="clamp-1">{c.title}</strong>
                    <span className="muted small">
                      {c.messages} messages · {new Date(c.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <button className="btn ghost icon sm" title="Delete" onClick={() => confirm('Delete this conversation?') && remove.mutate(c.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="assistant-body">
            {(!thread || thread.messages.length === 0) && !live && (
              <div className="assistant-welcome">
                <Sparkles size={28} />
                <h3>Ask {name} anything about this app</h3>
                <p className="muted small">
                  How features work, where something lives in the code, why a page behaves the way it does. {name} reads the real source (snapshot {status?.sourceVersion}).
                  {me.role === 'owner' && !status?.codeChanges && (
                    <>
                      {' '}
                      Turn on code changes in <Link to="/admin/assistant" onClick={close}>Admin → Assistant</Link> to let it edit the workspace.
                    </>
                  )}
                </p>
                <div className="assistant-suggestions">
                  {['How do I make an album public?', 'Explain the visibility rules in the code', 'Where is the public feed built?', 'How are buddies allowed to see albums?'].map((s) => (
                    <button key={s} className="chip chip-tag" onClick={() => setText(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {thread?.messages.map((m) => (
              <div key={m.id} className={`assistant-msg ${m.role === 'assistant' ? 'from-ai' : 'from-user'}`}>
                {m.role === 'assistant' ? (
                  <div className="assistant-avatar">
                    <Sparkles size={14} />
                  </div>
                ) : (
                  <Avatar name={me.display_name} size={26} src={me.avatarUrl} />
                )}
                <div className="assistant-bubble">
                  {m.role === 'assistant' ? <Markdown text={m.content} /> : <p>{m.content}</p>}
                  {m.role === 'user' && m.meta.context?.selection && <div className="assistant-ctx muted small">“{m.meta.context.selection.slice(0, 160)}”</div>}
                  {m.role === 'assistant' && (m.meta.backend || m.meta.tools?.length) && (
                    <div className="assistant-meta muted small">
                      {m.meta.backend === 'subscription' ? 'Subscription' : m.meta.backend === 'api' ? 'API' : ''}
                      {m.meta.tools?.length ? ` · ${m.meta.tools.length} tool call${m.meta.tools.length === 1 ? '' : 's'}` : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {live && (
              <div className="assistant-msg from-ai">
                <div className="assistant-avatar">
                  <Sparkles size={14} />
                </div>
                <div className="assistant-bubble">
                  {live.tools.length > 0 && (
                    <div className="assistant-tools">
                      {live.tools.slice(-6).map((t, i) => (
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
        )}

        <form className="assistant-compose" onSubmit={send}>
          {(context.selection || context.element) && (
            <div className="assistant-ctx-chip">
              <Paperclip size={12} /> {context.element ? `Element: ${context.element}` : `Selection: “${context.selection!.slice(0, 80)}”`}
              <button type="button" aria-label="Remove context" onClick={() => setContext({})}>
                <X size={12} />
              </button>
            </div>
          )}
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              className="textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder={`Message ${name}… (Enter to send, Shift+Enter for a new line)`}
              rows={2}
              disabled={!!live}
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
              <Cpu size={11} /> {status?.model}
            </span>
            {me.role === 'owner' && (
              <Link to="/admin/assistant" onClick={close}>
                <Code2 size={11} /> {status?.codeChanges ? 'Code changes on · review' : 'Settings'}
              </Link>
            )}
          </div>
        </form>
      </aside>
    </>
  )
}
