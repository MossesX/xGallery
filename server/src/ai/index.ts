import { db, getSetting, now, setSetting } from '../db.js'
import { logActivity } from '../activity.js'
import type { User } from '../auth.js'
import { cliAvailable, runCli } from './cli.js'
import { runApi } from './api.js'
import { codebaseOverview, ensureWorkspace, SOURCE_DIR, sourceVersion } from './workspace.js'
import { DEFAULT_AI, type AiSettings, type RunResult, type StreamEvent } from './types.js'

export const MASK = '••••••••'

/** Saved settings, with the container's environment as a fallback for either credential. */
export function getAiSettings(): AiSettings {
  const s = { ...DEFAULT_AI, ...getSetting<Partial<AiSettings>>('ai', {}) }
  if (!s.subscriptionToken && process.env.CLAUDE_CODE_OAUTH_TOKEN) s.subscriptionToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
  if (!s.apiKey && process.env.ANTHROPIC_API_KEY) s.apiKey = process.env.ANTHROPIC_API_KEY
  return s
}

export type CredentialSource = 'none' | 'settings' | 'env'

export function credentialSources(): { subscription: CredentialSource; api: CredentialSource } {
  const saved = getSetting<Partial<AiSettings>>('ai', {})
  return {
    subscription: saved.subscriptionToken ? 'settings' : process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'env' : 'none',
    api: saved.apiKey ? 'settings' : process.env.ANTHROPIC_API_KEY ? 'env' : 'none',
  }
}

/** Owner-facing view: secrets are masked, never echoed back. */
export function publicAiSettings(): Omit<AiSettings, 'subscriptionToken' | 'apiKey'> & { hasSubscriptionToken: boolean; hasApiKey: boolean; sources: { subscription: CredentialSource; api: CredentialSource }; usage: { subscription: number; api: number; lastBackend: string | null; lastAt: number | null } } {
  const s = getAiSettings()
  const { subscriptionToken, apiKey, ...rest } = s
  const rows = db.prepare("SELECT meta, created_at FROM ai_messages WHERE role = 'assistant' ORDER BY id DESC LIMIT 2000").all() as { meta: string; created_at: number }[]
  const usage = { subscription: 0, api: 0, lastBackend: null as string | null, lastAt: null as number | null }
  for (const r of rows) {
    let backend = ''
    try {
      backend = (JSON.parse(r.meta) as { backend?: string }).backend ?? ''
    } catch {
      /* ignore */
    }
    if (backend === 'subscription') usage.subscription++
    else if (backend === 'api') usage.api++
    if (!usage.lastBackend && backend) {
      usage.lastBackend = backend
      usage.lastAt = r.created_at
    }
  }
  return { ...rest, hasSubscriptionToken: !!subscriptionToken, hasApiKey: !!apiKey, sources: credentialSources(), usage }
}

export function recordVerification(which: 'subscription' | 'api', ok: boolean, detail: string): void {
  const cur = { ...DEFAULT_AI, ...getSetting<Partial<AiSettings>>('ai', {}) }
  if (which === 'subscription') {
    cur.subscriptionVerifiedAt = ok ? now() : null
    cur.subscriptionVerifiedDetail = detail
  } else {
    cur.apiVerifiedAt = ok ? now() : null
    cur.apiVerifiedDetail = detail
  }
  setSetting('ai', cur)
}

export function saveAiSettings(patch: Partial<AiSettings> & { clearSubscriptionToken?: boolean; clearApiKey?: boolean }): void {
  const cur = { ...DEFAULT_AI, ...getSetting<Partial<AiSettings>>('ai', {}) }
  const next: AiSettings = { ...cur }
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
  if (typeof patch.allowCodeChanges === 'boolean') next.allowCodeChanges = patch.allowCodeChanges
  if (typeof patch.model === 'string' && patch.model.trim()) next.model = patch.model.trim().slice(0, 80)
  if (typeof patch.extraInstructions === 'string') next.extraInstructions = patch.extraInstructions.slice(0, 8000)
  if (typeof patch.assistantName === 'string' && patch.assistantName.trim()) next.assistantName = patch.assistantName.trim().slice(0, 40)
  if (typeof patch.subscriptionToken === 'string' && patch.subscriptionToken && patch.subscriptionToken !== MASK) {
    next.subscriptionToken = patch.subscriptionToken.trim()
    next.subscriptionVerifiedAt = null
    next.subscriptionVerifiedDetail = ''
  }
  if (typeof patch.apiKey === 'string' && patch.apiKey && patch.apiKey !== MASK) {
    next.apiKey = patch.apiKey.trim()
    next.apiVerifiedAt = null
    next.apiVerifiedDetail = ''
  }
  if (patch.clearSubscriptionToken) {
    next.subscriptionToken = ''
    next.subscriptionVerifiedAt = null
    next.subscriptionVerifiedDetail = ''
  }
  if (patch.clearApiKey) {
    next.apiKey = ''
    next.apiVerifiedAt = null
    next.apiVerifiedDetail = ''
  }
  setSetting('ai', next)
}

export interface AiStatus {
  allowed: boolean
  enabled: boolean
  assistantName: string
  model: string
  backends: { subscription: boolean; api: boolean }
  codeChanges: boolean
  sourceVersion: string
}

let cliCache: { at: number; ok: boolean } | null = null
function cliOk(): boolean {
  if (!cliCache || Date.now() - cliCache.at > 60_000) cliCache = { at: Date.now(), ok: cliAvailable() }
  return cliCache.ok
}

export function aiStatus(user: User | undefined): AiStatus {
  const s = getAiSettings()
  const allowed = !!user && (user.role === 'owner' || user.aiEnabled) && s.enabled
  return {
    allowed,
    enabled: s.enabled,
    assistantName: s.assistantName,
    model: s.model,
    backends: { subscription: !!s.subscriptionToken && cliOk(), api: !!s.apiKey },
    codeChanges: s.allowCodeChanges,
    sourceVersion: sourceVersion(),
  }
}

export interface PageContext {
  url?: string
  title?: string
  selection?: string
  element?: string
}

export function buildSystemPrompt(user: User, ctx: PageContext | undefined, allowCode: boolean, cwd: string): string {
  const s = getAiSettings()
  const site = getSetting<Record<string, unknown>>('site', {})
  const parts: string[] = []
  parts.push(`You are ${s.assistantName}, the built-in professional assistant of ${site.siteTitle ?? 'xGallery'}, a social photo and video gallery web application by ${site.brandName ?? 'AmberX'}, deployed at https://xgallery.amberxai.com.`)
  parts.push(
    'You know this application inside out: its features (galleries owned by every member, albums with draft / buddies-and-members / public visibility, a public album per gallery, likes, comments, favorites, buddy lists, private messages, themes and layouts, the My space control panel, the owner-only admin panel) and its source code, which you can inspect with your file tools. Answer questions about how the app works, help people use it, explain and troubleshoot behaviour by reading the actual code, and give precise, well-structured answers. Prefer short paragraphs and lists; use code blocks for code, commands and file paths.',
  )
  parts.push(`The person you are talking to is ${user.display_name} (@${user.username}), role: ${user.role}. ${user.role === 'owner' ? 'They are the site owner with full access.' : user.role === 'admin' ? 'They are an administrator (manage members, not the site itself).' : 'They are a regular member with their own gallery.'}`)
  parts.push(`Source of truth: the application source tree at ${cwd} (snapshot ${sourceVersion()}). Key areas: src/ (React 19 + TypeScript client: pages/, components/, api/), server/src/ (Node + Express 5 + SQLite server: routes/, access.ts, db.ts, serialize.ts, ai/), Dockerfile and deploy/ (Docker on a Hostinger VPS behind Traefik), .github/workflows/deploy.yml (CI deploy). Read files before making claims about code.`)
  if (allowCode) {
    parts.push(
      'Code changes are ENABLED by the owner for this session. You may edit files in the workspace (a writable copy of the repository). Keep changes minimal and consistent with the existing style; explain what you changed and why; the owner reviews the resulting diff before anything is committed. Never touch secrets or the data directory.',
    )
  } else {
    parts.push('Code changes are not enabled: you can read the source but must not modify files. If someone asks for a change, describe the change precisely (files, functions, the diff) so the owner can enable code changes or apply it themselves.')
  }
  if (ctx?.url || ctx?.selection || ctx?.element) {
    parts.push(`Current page context: ${ctx.url ? `URL ${ctx.url}` : ''}${ctx.title ? ` · title "${ctx.title}"` : ''}${ctx.element ? ` · right-clicked element: ${ctx.element}` : ''}${ctx.selection ? `\nSelected text:\n"""\n${ctx.selection.slice(0, 2000)}\n"""` : ''}`)
  }
  if (s.extraInstructions.trim()) parts.push(`Owner instructions:\n${s.extraInstructions.trim()}`)
  parts.push(`\n${codebaseOverview(cwd)}`)
  return parts.join('\n\n')
}

export interface AssistantTurn {
  user: User
  conversationId: number
  prompt: string
  context?: PageContext
  onEvent: (e: StreamEvent) => void
  signal?: AbortSignal
}

/** Run one assistant turn: subscription backend first, API fallback, persisting both sides. */
export async function assistantTurn(t: AssistantTurn): Promise<{ result: RunResult; messageId: number }> {
  const s = getAiSettings()
  const conv = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(t.conversationId, t.user.id) as { id: number; cli_session_id: string | null; title: string } | undefined
  if (!conv) throw new Error('Conversation not found')
  const allowCode = s.allowCodeChanges && t.user.role === 'owner'
  const cwd = allowCode ? ensureWorkspace() : SOURCE_DIR
  const system = buildSystemPrompt(t.user, t.context, allowCode, cwd)
  const history = (db.prepare('SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 40').all(conv.id) as { role: 'user' | 'assistant'; content: string }[]).reverse()
  const ts = now()
  db.prepare("INSERT INTO ai_messages(conversation_id, role, content, meta, created_at) VALUES (?, 'user', ?, ?, ?)").run(conv.id, t.prompt, JSON.stringify({ context: t.context ?? null }), ts)
  if (conv.title === 'New conversation') db.prepare('UPDATE ai_conversations SET title = ? WHERE id = ?').run(t.prompt.replace(/\s+/g, ' ').slice(0, 60), conv.id)

  const base = { prompt: t.prompt, systemPrompt: system, history, cwd, allowCodeChanges: allowCode, model: s.model, subscriptionToken: s.subscriptionToken, apiKey: s.apiKey, signal: t.signal }
  let result: RunResult | null = null
  let lastError: Error | null = null
  if (s.subscriptionToken && cliOk()) {
    try {
      t.onEvent({ type: 'status', text: 'Thinking on your Claude subscription…' })
      result = await runCli({ ...base, cliSessionId: conv.cli_session_id }, t.onEvent)
      if (result.cliSessionId) db.prepare('UPDATE ai_conversations SET cli_session_id = ? WHERE id = ?').run(result.cliSessionId, conv.id)
    } catch (e) {
      lastError = e as Error
      console.warn('[ai] subscription backend failed:', lastError.message)
    }
  }
  if (!result && s.apiKey) {
    t.onEvent({ type: 'status', text: lastError ? 'Subscription unavailable, falling back to the API…' : 'Thinking…' })
    result = await runApi(base, t.onEvent)
  }
  if (!result) throw lastError ?? new Error('The assistant is not configured yet: the owner must add a Claude subscription token or an API key in Admin → Assistant.')
  const info = db
    .prepare("INSERT INTO ai_messages(conversation_id, role, content, meta, created_at) VALUES (?, 'assistant', ?, ?, ?)")
    .run(conv.id, result.text, JSON.stringify({ backend: result.backend, tools: result.toolsUsed.slice(0, 50), model: s.model }), now())
  db.prepare('UPDATE ai_conversations SET updated_at = ? WHERE id = ?').run(now(), conv.id)
  logActivity({ userId: t.user.id, kind: 'ai.turn', targetType: 'conversation', targetId: conv.id, targetLabel: conv.title, detail: { backend: result.backend, tools: result.toolsUsed.length, codeChanges: allowCode, prompt: t.prompt.slice(0, 120) } })
  return { result, messageId: info.lastInsertRowid as number }
}
