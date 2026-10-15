import { Router } from 'express'
import { db, getSetting, now } from '../db.js'
import { requireOwner, verifyPassword } from '../auth.js'
import { HttpError, num, str, wrap, type IdRow } from '../util.js'
import { logActivity } from '../activity.js'
import { getAiSettings } from '../ai/index.js'
import { runApi } from '../ai/api.js'
import { cliAvailable, runCli } from '../ai/cli.js'
import { SOURCE_DIR, sourceVersion } from '../ai/workspace.js'
import {
  buildSummary,
  changesSinceSnapshot,
  checkpoint,
  deleteWorkspaceFile,
  devPasswordSet,
  devSettings,
  devStatus,
  endSession,
  eventJson,
  factoryResetDesign,
  fileDiff,
  FLAG_LABELS,
  fullDiff,
  getUi,
  headSha,
  listCheckpoints,
  readWorkspaceFile,
  recordEvent,
  requireDev,
  resetWorkspaceAll,
  restoreCheckpoint,
  restoreSnapshot,
  restoreWorkspaceFile,
  rootSha,
  saveUi,
  sessionJson,
  setDevPassword,
  setDevSessionMinutes,
  snapshotJson,
  takeSnapshot,
  unlockDev,
  workspaceTree,
  writeWorkspaceFile,
  DEFAULT_UI,
  type DevSession,
} from '../dev.js'

export const devRouter = Router()

/* ---------- gate ---------- */

devRouter.get('/status', requireOwner, (req, res) => {
  res.json(devStatus(req))
})

/** The owner sets (or changes) the developer password; their account password confirms it. */
devRouter.post(
  '/password',
  requireOwner,
  wrap((req, res) => {
    const account = str(req.body?.accountPassword, 200)
    const password = str(req.body?.password, 200)
    const row = db.prepare('SELECT salt, password_hash FROM users WHERE id = ?').get(req.user!.id) as { salt: string; password_hash: string }
    if (!verifyPassword(account, row.salt, row.password_hash)) throw new HttpError(401, 'Your account password is not right')
    const first = !devPasswordSet()
    setDevPassword(password, req.user!.id)
    logActivity({ userId: req.user!.id, kind: first ? 'dev.password_set' : 'dev.password_changed', ip: req.ip ?? '' })
    if (req.devSession) recordEvent(req.devSession.id, 'settings.password', { summary: 'Developer password changed' })
    res.json({ ok: true, status: devStatus(req) })
  }),
)

devRouter.post(
  '/unlock',
  requireOwner,
  wrap((req, res) => {
    const s = unlockDev(req, str(req.body?.password, 200))
    res.json({ session: sessionJson(s), status: devStatus(req) })
  }),
)

devRouter.post(
  '/lock',
  requireOwner,
  wrap((req, res) => {
    if (req.devSession) endSession(req.devSession.id, 'lock')
    req.devSession = undefined
    res.json({ ok: true, status: devStatus(req) })
  }),
)

devRouter.put(
  '/settings',
  requireDev,
  wrap((req, res) => {
    if (req.body?.sessionMinutes != null) {
      setDevSessionMinutes(num(req.body.sessionMinutes, 120))
      recordEvent(req.devSession!.id, 'settings.save', { summary: `Developer session length set to ${devSettings().sessionMinutes} minutes` })
    }
    res.json({ status: devStatus(req) })
  }),
)

/* ---------- overview ---------- */

devRouter.get(
  '/overview',
  requireDev,
  wrap((req, res) => {
    const sessions = db.prepare('SELECT * FROM dev_sessions ORDER BY id DESC LIMIT 6').all() as unknown as DevSession[]
    const counts = {
      sessions: (db.prepare('SELECT COUNT(*) c FROM dev_sessions').get() as { c: number }).c,
      events: (db.prepare('SELECT COUNT(*) c FROM dev_events').get() as { c: number }).c,
      snapshots: (db.prepare('SELECT COUNT(*) c FROM dev_snapshots').get() as { c: number }).c,
      themes: (db.prepare('SELECT COUNT(*) c FROM themes').get() as { c: number }).c,
    }
    const changes = changesSinceSnapshot()
    const ai = getAiSettings()
    res.json({
      status: devStatus(req),
      counts,
      recentSessions: sessions.map(sessionJson),
      workspace: { head: headSha(), root: rootSha(), changedFiles: changes.length, added: changes.reduce((a, f) => a + f.added, 0), removed: changes.reduce((a, f) => a + f.removed, 0), checkpoints: listCheckpoints(200).length },
      ai: { subscription: !!ai.subscriptionToken && cliAvailable(), api: !!ai.apiKey, model: ai.model, assistantName: ai.assistantName, chatCodeChanges: ai.allowCodeChanges },
      site: { title: (getSetting<{ siteTitle?: string }>('site', {}).siteTitle ?? 'xGallery') as string },
    })
  }),
)

/* ---------- sessions and the change log ---------- */

devRouter.get(
  '/sessions',
  requireDev,
  wrap((req, res) => {
    const limit = Math.min(200, Math.max(1, num(req.query.limit, 50)))
    const rows = db.prepare('SELECT * FROM dev_sessions ORDER BY id DESC LIMIT ?').all(limit) as unknown as DevSession[]
    res.json({ sessions: rows.map(sessionJson) })
  }),
)

devRouter.get(
  '/sessions/:id',
  requireDev,
  wrap((req, res) => {
    const s = db.prepare('SELECT * FROM dev_sessions WHERE id = ?').get(Number(req.params.id)) as unknown as DevSession | undefined
    if (!s) throw new HttpError(404, 'Session not found')
    const events = (db.prepare('SELECT * FROM dev_events WHERE session_id = ? ORDER BY id').all(s.id) as IdRow[]).map(eventJson)
    res.json({ session: sessionJson(s), events, liveSummary: s.ended_at ? s.summary : buildSummary(s.id) })
  }),
)

devRouter.put(
  '/sessions/:id',
  requireDev,
  wrap((req, res) => {
    const s = db.prepare('SELECT * FROM dev_sessions WHERE id = ?').get(Number(req.params.id)) as unknown as DevSession | undefined
    if (!s) throw new HttpError(404, 'Session not found')
    const summary = str(req.body?.summary, 8000)
    db.prepare("UPDATE dev_sessions SET summary = ?, summary_source = 'manual' WHERE id = ?").run(summary, s.id)
    res.json({ session: sessionJson(db.prepare('SELECT * FROM dev_sessions WHERE id = ?').get(s.id) as unknown as DevSession) })
  }),
)

/** Ask the configured Claude backend for a narrative summary of a session's log. */
devRouter.post(
  '/sessions/:id/summarize',
  requireDev,
  wrap(async (req, res) => {
    const s = db.prepare('SELECT * FROM dev_sessions WHERE id = ?').get(Number(req.params.id)) as unknown as DevSession | undefined
    if (!s) throw new HttpError(404, 'Session not found')
    const events = (db.prepare('SELECT * FROM dev_events WHERE session_id = ? ORDER BY id').all(s.id) as IdRow[]).map(eventJson)
    const log = events.map((e) => `${new Date(e.ts as number).toISOString()} ${e.kind}${e.path ? ` ${e.path}` : ''} — ${e.summary}${Object.keys(e.detail as object).length ? ` ${JSON.stringify(e.detail).slice(0, 300)}` : ''}`).join('\n')
    const ai = getAiSettings()
    const base = {
      prompt: `Write a detailed but readable summary (markdown, max ~250 words) of this developer session on the ${sourceVersion()} snapshot of the xGallery codebase. Group by: source files changed (what and why, inferred from the AI turn prompts), site design changes, restores, and anything risky. Session log:\n\n${log.slice(0, 30_000) || '(no events)'}`,
      systemPrompt: 'You summarise developer session logs for the site owner. Be concrete, name files, never invent changes that are not in the log.',
      history: [],
      cwd: SOURCE_DIR,
      allowCodeChanges: false,
      model: ai.model,
      subscriptionToken: ai.subscriptionToken,
      apiKey: ai.apiKey,
      timeoutMs: 120_000,
    }
    let text = ''
    let backend = ''
    try {
      if (ai.subscriptionToken && cliAvailable()) {
        const r = await runCli({ ...base, cliSessionId: null }, () => {})
        text = r.text
        backend = 'subscription'
      }
    } catch (e) {
      console.warn('[dev] subscription summary failed:', (e as Error).message)
    }
    if (!text && ai.apiKey) {
      const r = await runApi(base, () => {})
      text = r.text
      backend = 'api'
    }
    if (!text) throw new HttpError(503, 'No Claude backend is configured (Admin → Assistant)')
    db.prepare("UPDATE dev_sessions SET summary = ?, summary_source = 'ai' WHERE id = ?").run(text.slice(0, 8000), s.id)
    recordEvent(req.devSession!.id, 'session.summarize', { summary: `AI summary written for session #${s.id} (${backend})`, detail: { sessionId: s.id, backend } })
    res.json({ session: sessionJson(db.prepare('SELECT * FROM dev_sessions WHERE id = ?').get(s.id) as unknown as DevSession) })
  }),
)

devRouter.get(
  '/sessions/:id/export.md',
  requireDev,
  wrap((req, res) => {
    const s = db.prepare('SELECT * FROM dev_sessions WHERE id = ?').get(Number(req.params.id)) as unknown as DevSession | undefined
    if (!s) throw new HttpError(404, 'Session not found')
    const events = (db.prepare('SELECT * FROM dev_events WHERE session_id = ? ORDER BY id').all(s.id) as IdRow[]).map(eventJson)
    const user = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(s.user_id) as { display_name: string; username: string } | undefined
    const lines = [
      `# Developer session #${s.id}`,
      '',
      `- Developer: ${user ? `${user.display_name} (@${user.username})` : `#${s.user_id}`}`,
      `- Started: ${new Date(s.started_at).toISOString()}`,
      `- Ended: ${s.ended_at ? `${new Date(s.ended_at).toISOString()} (${s.end_reason})` : 'still open'}`,
      `- From: ${s.ip} · ${s.user_agent}`,
      `- Changes: ${s.changes} · Events: ${events.length}`,
      '',
      '## Summary',
      '',
      s.summary || buildSummary(s.id),
      '',
      '## Event log',
      '',
      '| Time | Kind | Path | What happened | Detail |',
      '| --- | --- | --- | --- | --- |',
      ...events.map((e) => `| ${new Date(e.ts as number).toISOString()} | ${e.kind} | ${e.path || ''} | ${String(e.summary).replace(/\|/g, '\\|')} | ${JSON.stringify(e.detail).replace(/\|/g, '\\|').slice(0, 200)} |`),
      '',
    ]
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="dev-session-${s.id}.md"`)
    res.send(lines.join('\n'))
  }),
)

/** Every logged event across sessions, newest first, filterable. */
devRouter.get(
  '/events',
  requireDev,
  wrap((req, res) => {
    const limit = Math.min(500, Math.max(1, num(req.query.limit, 100)))
    const before = req.query.before ? num(req.query.before) : null
    const kind = str(req.query.kind, 60)
    const q = str(req.query.q, 120)
    const sessionId = req.query.sessionId ? num(req.query.sessionId) : null
    const where: string[] = []
    const args: (number | string)[] = []
    if (before) {
      where.push('id < ?')
      args.push(before)
    }
    if (kind) {
      where.push('kind LIKE ?')
      args.push(`${kind}%`)
    }
    if (q) {
      where.push('(path LIKE ? OR summary LIKE ? OR detail LIKE ?)')
      args.push(`%${q}%`, `%${q}%`, `%${q}%`)
    }
    if (sessionId) {
      where.push('session_id = ?')
      args.push(sessionId)
    }
    const rows = db.prepare(`SELECT * FROM dev_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit) as IdRow[]
    const kinds = (db.prepare('SELECT DISTINCT kind FROM dev_events ORDER BY kind').all() as { kind: string }[]).map((k) => k.kind)
    res.json({ events: rows.map(eventJson), kinds, nextBefore: rows.length === limit ? (rows[rows.length - 1].id as number) : null })
  }),
)

/* ---------- site design: builder config, snapshots, factory reset ---------- */

devRouter.get('/ui', requireOwner, (_req, res) => {
  res.json({ ui: getUi(), defaults: DEFAULT_UI, flagLabels: FLAG_LABELS })
})

devRouter.put(
  '/ui',
  requireDev,
  wrap((req, res) => {
    const label = str(req.body?.label, 80)
    takeSnapshot(req.devSession!.id, label ? `Before: ${label}` : 'Before design save')
    const { ui, changed } = saveUi(req.body?.ui ?? req.body)
    recordEvent(req.devSession!.id, 'config.save', { path: 'settings/ui', detail: { changed }, summary: `Site design saved${label ? ` (${label})` : ''}: ${changed.length ? changed.join(', ') : 'no visible change'}` })
    logActivity({ userId: req.user!.id, kind: 'dev.design_save', detail: { changed }, ip: req.ip ?? '' })
    res.json({ ui })
  }),
)

devRouter.post(
  '/ui/reset',
  requireDev,
  wrap((req, res) => {
    factoryResetDesign(req.devSession!.id)
    res.json({ ui: getUi() })
  }),
)

devRouter.get(
  '/snapshots',
  requireDev,
  wrap((_req, res) => {
    const rows = db.prepare('SELECT * FROM dev_snapshots ORDER BY id DESC LIMIT 300').all() as IdRow[]
    res.json({ snapshots: rows.map(snapshotJson) })
  }),
)

devRouter.post(
  '/snapshots',
  requireDev,
  wrap((req, res) => {
    const name = str(req.body?.name, 120) || `Manual snapshot ${new Date().toLocaleString()}`
    const id = takeSnapshot(req.devSession!.id, name, 'manual')
    res.status(201).json({ snapshot: snapshotJson(db.prepare('SELECT * FROM dev_snapshots WHERE id = ?').get(id) as IdRow) })
  }),
)

devRouter.post(
  '/snapshots/:id/restore',
  requireDev,
  wrap((req, res) => {
    restoreSnapshot(Number(req.params.id), req.devSession!.id)
    logActivity({ userId: req.user!.id, kind: 'dev.snapshot_restore', targetType: 'snapshot', targetId: Number(req.params.id), ip: req.ip ?? '' })
    res.json({ ok: true, ui: getUi() })
  }),
)

devRouter.delete(
  '/snapshots/:id',
  requireDev,
  wrap((req, res) => {
    db.prepare('DELETE FROM dev_snapshots WHERE id = ?').run(Number(req.params.id))
    res.json({ ok: true })
  }),
)

/* ---------- source workspace ---------- */

devRouter.get(
  '/files',
  requireDev,
  wrap((_req, res) => {
    res.json({ files: workspaceTree(), head: headSha(), sourceVersion: sourceVersion() })
  }),
)

devRouter.get(
  '/file',
  requireDev,
  wrap((req, res) => {
    const rel = str(req.query.path, 500)
    if (!rel) throw new HttpError(400, 'path is required')
    res.json({ file: readWorkspaceFile(rel), diff: fileDiff(rootSha() || 'HEAD', rel) })
  }),
)

devRouter.put(
  '/file',
  requireDev,
  wrap((req, res) => {
    const rel = str(req.body?.path, 500)
    if (!rel) throw new HttpError(400, 'path is required')
    if (typeof req.body?.contents !== 'string') throw new HttpError(400, 'contents must be a string')
    const r = writeWorkspaceFile(rel, req.body.contents, req.devSession!.id)
    logActivity({ userId: req.user!.id, kind: 'dev.file_write', targetLabel: rel, detail: { added: r.added, removed: r.removed }, ip: req.ip ?? '' })
    res.json(r)
  }),
)

devRouter.delete(
  '/file',
  requireDev,
  wrap((req, res) => {
    const rel = str(req.query.path, 500)
    if (!rel) throw new HttpError(400, 'path is required')
    deleteWorkspaceFile(rel, req.devSession!.id)
    res.json({ ok: true })
  }),
)

devRouter.post(
  '/file/restore',
  requireDev,
  wrap((req, res) => {
    const rel = str(req.body?.path, 500)
    if (!rel) throw new HttpError(400, 'path is required')
    restoreWorkspaceFile(rel, req.devSession!.id)
    res.json({ ok: true })
  }),
)

devRouter.get(
  '/changes',
  requireDev,
  wrap((_req, res) => {
    res.json({ files: changesSinceSnapshot(), head: headSha(), root: rootSha(), sourceVersion: sourceVersion() })
  }),
)

devRouter.get(
  '/diff',
  requireDev,
  wrap((req, res) => {
    const rel = str(req.query.path, 500)
    const ref = str(req.query.ref, 60) || rootSha() || 'HEAD'
    if (!/^[0-9a-f]{0,40}$|^HEAD$/i.test(ref)) throw new HttpError(400, 'Bad ref')
    res.json({ diff: rel ? fileDiff(ref, rel) : fullDiff(ref).slice(0, 400_000) })
  }),
)

devRouter.get(
  '/patch',
  requireDev,
  wrap((req, res) => {
    const diff = fullDiff(rootSha() || 'HEAD')
    recordEvent(req.devSession!.id, 'workspace.export', { summary: `Patch exported (${diff.length} bytes)` })
    res.setHeader('Content-Type', 'text/x-patch')
    res.setHeader('Content-Disposition', `attachment; filename="xgallery-dev-${sourceVersion()}-${now()}.patch"`)
    res.send(diff)
  }),
)

devRouter.get(
  '/checkpoints',
  requireDev,
  wrap((_req, res) => {
    res.json({ checkpoints: listCheckpoints(200), head: headSha(), root: rootSha() })
  }),
)

devRouter.post(
  '/checkpoints',
  requireDev,
  wrap((req, res) => {
    const label = str(req.body?.label, 120) || `Checkpoint ${new Date().toLocaleString()}`
    const cp = checkpoint(label, req.devSession!.id)
    res.status(cp ? 201 : 200).json({ checkpoint: cp, head: headSha(), unchanged: !cp })
  }),
)

devRouter.post(
  '/checkpoints/:sha/restore',
  requireDev,
  wrap((req, res) => {
    const cp = restoreCheckpoint(String(req.params.sha), req.devSession!.id)
    logActivity({ userId: req.user!.id, kind: 'dev.checkpoint_restore', targetLabel: String(req.params.sha), ip: req.ip ?? '' })
    res.json({ checkpoint: cp, head: headSha() })
  }),
)

devRouter.post(
  '/workspace/reset',
  requireDev,
  wrap((req, res) => {
    resetWorkspaceAll(req.devSession!.id)
    logActivity({ userId: req.user!.id, kind: 'dev.workspace_reset', ip: req.ip ?? '' })
    res.json({ ok: true, head: headSha() })
  }),
)
