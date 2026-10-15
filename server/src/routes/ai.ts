import { Router, type Request, type Response, type NextFunction } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { db, now } from '../db.js'
import { requireOwner, requireUser } from '../auth.js'
import { HttpError, str, wrap, IdRow } from '../util.js'
import { aiStatus, assistantTurn, getAiSettings, publicAiSettings, recordVerification, saveAiSettings, type PageContext } from '../ai/index.js'
import { cliAvailable, pingCli } from '../ai/cli.js'
import { ensureWorkspace, resetWorkspace, sourceVersion, workspaceDiff } from '../ai/workspace.js'

export const aiRouter = Router()

/** The assistant is for the owner and for members the owner enabled, while the owner keeps it switched on. */
function requireAi(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in required' })
    return
  }
  if (!aiStatus(req.user).allowed) {
    res.status(403).json({ error: 'The assistant is not enabled for your account' })
    return
  }
  next()
}

aiRouter.get('/status', requireUser, (req, res) => {
  res.json(aiStatus(req.user))
})

/* ---------- owner settings ---------- */

aiRouter.get('/settings', requireOwner, (_req, res) => {
  res.json({ settings: publicAiSettings(), cliInstalled: cliAvailable(), sourceVersion: sourceVersion() })
})

aiRouter.put(
  '/settings',
  requireOwner,
  wrap((req, res) => {
    saveAiSettings(req.body ?? {})
    res.json({ settings: publicAiSettings() })
  }),
)

/** Verify one or both backends for real: a one-line turn through Claude Code, a model lookup on the API. */
aiRouter.post(
  '/settings/test',
  requireOwner,
  wrap(async (req, res) => {
    const which = str(req.body?.which, 20) || 'both'
    const s = getAiSettings()
    const out: { subscription?: { ok: boolean; detail: string }; api?: { ok: boolean; detail: string } } = {}
    if (which === 'both' || which === 'subscription') {
      if (!cliAvailable()) out.subscription = { ok: false, detail: 'Claude Code CLI is not installed in this container' }
      else if (!s.subscriptionToken) out.subscription = { ok: false, detail: 'No subscription token saved' }
      else out.subscription = await pingCli(s.subscriptionToken, s.model)
      recordVerification('subscription', out.subscription.ok, out.subscription.detail)
    }
    if (which === 'both' || which === 'api') {
      if (!s.apiKey) out.api = { ok: false, detail: 'No API key saved' }
      else {
        try {
          const client = new Anthropic({ apiKey: s.apiKey, timeout: 20_000 })
          const m = await client.models.retrieve(s.model)
          out.api = { ok: true, detail: `Key accepted · ${m.display_name ?? s.model}` }
        } catch (e) {
          out.api = { ok: false, detail: e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : (e as Error).message }
        }
      }
      recordVerification('api', out.api.ok, out.api.detail)
    }
    res.json({ ...out, settings: publicAiSettings() })
  }),
)

/* ---------- conversations ---------- */

function convJson(r: IdRow) {
  const count = (db.prepare('SELECT COUNT(*) c FROM ai_messages WHERE conversation_id = ?').get(r.id) as { c: number }).c
  return { id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, messages: count }
}

function msgJson(r: IdRow) {
  let meta: Record<string, unknown> = {}
  try {
    meta = JSON.parse(r.meta as string)
  } catch {
    /* ignore */
  }
  return { id: r.id, role: r.role, content: r.content, createdAt: r.created_at, meta }
}

aiRouter.get(
  '/conversations',
  requireAi,
  wrap((req, res) => {
    const rows = db.prepare('SELECT * FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100').all(req.user!.id) as IdRow[]
    res.json({ conversations: rows.map(convJson) })
  }),
)

aiRouter.post(
  '/conversations',
  requireAi,
  wrap((req, res) => {
    const t = now()
    const info = db.prepare('INSERT INTO ai_conversations(user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(req.user!.id, str(req.body?.title, 80) || 'New conversation', t, t)
    res.status(201).json({ conversation: convJson(db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(info.lastInsertRowid as number) as IdRow) })
  }),
)

function ownConv(req: Request): IdRow {
  const row = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user!.id) as IdRow | undefined
  if (!row) throw new HttpError(404, 'Conversation not found')
  return row
}

aiRouter.get(
  '/conversations/:id',
  requireAi,
  wrap((req, res) => {
    const row = ownConv(req)
    const msgs = db.prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY id').all(row.id) as IdRow[]
    res.json({ conversation: convJson(row), messages: msgs.map(msgJson) })
  }),
)

aiRouter.put(
  '/conversations/:id',
  requireAi,
  wrap((req, res) => {
    const row = ownConv(req)
    const title = str(req.body?.title, 80)
    if (title) db.prepare('UPDATE ai_conversations SET title = ? WHERE id = ?').run(title, row.id)
    res.json({ conversation: convJson(db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(row.id) as IdRow) })
  }),
)

aiRouter.delete(
  '/conversations/:id',
  requireAi,
  wrap((req, res) => {
    const row = ownConv(req)
    db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(row.id)
    res.json({ ok: true })
  }),
)

/** One turn, streamed as server-sent events: text deltas, tool calls, status, then done or error. */
aiRouter.post(
  '/conversations/:id/messages',
  requireAi,
  wrap(async (req, res) => {
    const row = ownConv(req)
    const prompt = str(req.body?.content, 20000).trim()
    if (!prompt) throw new HttpError(400, 'Message is empty')
    const c = req.body?.context ?? {}
    const context: PageContext = { url: str(c.url, 500), title: str(c.title, 200), selection: str(c.selection, 4000), element: str(c.element, 300) }
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    const abort = new AbortController()
    // The response closing before we end it means the client went away: stop the model run.
    res.on('close', () => {
      if (!res.writableEnded) abort.abort()
    })
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000)
    try {
      const { result, messageId } = await assistantTurn({ user: req.user!, conversationId: row.id as number, prompt, context, onEvent: (e) => send(e.type, e), signal: abort.signal })
      send('done', { messageId, backend: result.backend, tools: result.toolsUsed, text: result.text })
    } catch (e) {
      send('error', { message: (e as Error).message })
    } finally {
      clearInterval(keepAlive)
      res.end()
    }
  }),
)

/* ---------- owner: workspace review ---------- */

aiRouter.get(
  '/workspace',
  requireOwner,
  wrap((_req, res) => {
    ensureWorkspace()
    const d = workspaceDiff()
    res.json({ ...d, sourceVersion: sourceVersion() })
  }),
)

aiRouter.get(
  '/workspace/patch',
  requireOwner,
  wrap((_req, res) => {
    const d = workspaceDiff()
    res.setHeader('Content-Type', 'text/x-patch')
    res.setHeader('Content-Disposition', `attachment; filename="xgallery-assistant-${sourceVersion()}.patch"`)
    res.send(d.diff)
  }),
)

aiRouter.post(
  '/workspace/reset',
  requireOwner,
  wrap((_req, res) => {
    resetWorkspace()
    res.json({ ok: true })
  }),
)
