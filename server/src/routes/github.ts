import { Router, type Request } from 'express'
import { recordEvent, requireDev } from '../dev.js'
import { HttpError, num, str, wrap } from '../util.js'
import { logActivity } from '../activity.js'
import { getOps } from '../ops.js'
import { getGithub, gh, ghRaw, publicGithub, qs, rate, repoPath, saveGithub, sealForRepo, SECRET_NAME_RE } from '../github/client.js'
import { getSnapshot, handleDelivery, listEvents, refreshSnapshot, snapshotVersion, verifySignature } from '../github/snapshot.js'

/**
 * The GitHub manager: everything about the repository, through the token kept on this server.
 * Reads are proxied (and the overview is served from the background snapshot); every write is
 * logged on the developer session.
 */
export const githubRouter = Router()
githubRouter.use(requireDev)

type J = Record<string, unknown>
function log(req: Request, kind: string, summary: string, detail?: unknown) {
  recordEvent(req.devSession!.id, `github.${kind}`, { summary, detail })
  logActivity({ userId: req.user!.id, kind: `github.${kind}`, targetLabel: summary.slice(0, 120), ip: req.ip ?? '' })
}
const n = (v: unknown) => {
  const x = num(v, 0)
  if (!Number.isInteger(x) || x < 1) throw new HttpError(400, 'Bad number')
  return x
}
const ref = (v: unknown, fallback = '') => {
  const s = str(v, 250) || fallback
  if (s && !/^[\w./@+-]+$/.test(s)) throw new HttpError(400, 'Bad ref')
  return s
}
const page = (req: Request) => ({ page: Math.max(1, num(req.query.page, 1)), per_page: Math.min(100, Math.max(1, num(req.query.per_page, 30))) })
const webhookUrl = () => `https://${getOps().domain}/api/github/webhook`
const user = (u: unknown) => String((u as { login?: string } | null)?.login ?? '')

/* ---------- settings & identity ---------- */

githubRouter.get('/settings', (_req, res) => res.json({ github: publicGithub(), webhookUrl: webhookUrl(), snapshotVersion: snapshotVersion() }))
githubRouter.put(
  '/settings',
  wrap(async (req, res) => {
    const g = saveGithub(req.body ?? {})
    log(req, 'settings', `GitHub manager settings saved (token ${g.hasToken ? 'set' : 'not set'}, repo ${g.full})`)
    refreshSnapshot('settings').catch(() => null)
    res.json({ github: g, webhookUrl: webhookUrl() })
  }),
)
githubRouter.get(
  '/me',
  wrap(async (_req, res) => {
    const r = await ghRaw<J>('GET', '/user')
    res.json({ user: { login: r.data.login, name: r.data.name, avatar: r.data.avatar_url, url: r.data.html_url, plan: (r.data.plan as { name?: string } | undefined)?.name }, scopes: (r.headers.get('x-oauth-scopes') ?? '').split(',').map((x) => x.trim()).filter(Boolean), tokenType: r.headers.get('x-oauth-scopes') != null ? 'classic' : 'fine-grained', rate: rate() })
  }),
)
githubRouter.get(
  '/repos',
  wrap(async (_req, res) => {
    const list = await gh<J[]>('GET', '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member')
    res.json({ repos: list.map((r) => ({ full_name: r.full_name, private: r.private, default_branch: r.default_branch, pushed_at: r.pushed_at, description: r.description ?? '', url: r.html_url })) })
  }),
)

/* ---------- overview (snapshot) & feed ---------- */

githubRouter.get(
  '/overview',
  wrap(async (req, res) => {
    const cur = getSnapshot()
    const stale = Date.now() - cur.fetchedAt > 60_000 || !cur.repo || !!cur.error
    const snap = req.query.refresh === '1' || stale || !getGithub().token ? await refreshSnapshot('overview') : cur
    res.json({ ...snap, events: listEvents().slice(0, 30), rate: rate(), version: snapshotVersion(), webhookUrl: webhookUrl() })
  }),
)
githubRouter.get('/events', (_req, res) => res.json({ events: listEvents(), version: snapshotVersion() }))
githubRouter.post('/deploy', wrap(async (req, res) => {
  const branch = ref(req.body?.ref, getSnapshot().repo?.default_branch || 'main')
  const file = str(req.body?.workflow, 120) || 'deploy.yml'
  await gh('POST', repoPath(`/actions/workflows/${encodeURIComponent(file)}/dispatches`), { ref: branch })
  log(req, 'deploy', `Deploy workflow ${file} dispatched on ${branch}`)
  setTimeout(() => refreshSnapshot('deploy').catch(() => null), 3000).unref()
  res.json({ ok: true })
}))

/* ---------- commits, branches, compare ---------- */

githubRouter.get(
  '/commits',
  wrap(async (req, res) => {
    const r = await ghRaw<J[]>('GET', repoPath(`/commits${qs({ sha: ref(req.query.branch), path: str(req.query.path, 500), author: str(req.query.author, 100), ...page(req) })}`))
    res.json({ commits: r.data.map((c) => ({ sha: c.sha, message: (c.commit as { message: string }).message, author: (c.commit as { author: { name: string; date: string } }).author?.name, login: user(c.author), date: (c.commit as { author: { date: string } }).author?.date, url: c.html_url, verified: !!((c.commit as { verification?: { verified?: boolean } }).verification?.verified) })), next: r.next })
  }),
)
githubRouter.get(
  '/commits/:sha',
  wrap(async (req, res) => {
    const c = await gh<J>('GET', repoPath(`/commits/${ref(req.params.sha)}`))
    const files = ((c.files as J[]) ?? []).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: String(f.patch ?? '').slice(0, 20_000) }))
    res.json({ sha: c.sha, message: (c.commit as { message: string }).message, author: (c.commit as { author: { name: string; date: string } }).author, login: user(c.author), stats: c.stats, files, url: c.html_url, parents: ((c.parents as { sha: string }[]) ?? []).map((p) => p.sha) })
  }),
)
githubRouter.get(
  '/compare',
  wrap(async (req, res) => {
    const c = await gh<J>('GET', repoPath(`/compare/${encodeURIComponent(ref(req.query.base))}...${encodeURIComponent(ref(req.query.head))}`))
    res.json({ status: c.status, ahead_by: c.ahead_by, behind_by: c.behind_by, total_commits: c.total_commits, commits: ((c.commits as J[]) ?? []).map((x) => ({ sha: x.sha, message: (x.commit as { message: string }).message.split('\n')[0], author: (x.commit as { author: { name: string } }).author?.name })), files: ((c.files as J[]) ?? []).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: String(f.patch ?? '').slice(0, 20_000) })), url: c.html_url })
  }),
)
githubRouter.get(
  '/branches',
  wrap(async (req, res) => {
    const r = await ghRaw<J[]>('GET', repoPath(`/branches${qs({ per_page: 100, page: num(req.query.page, 1) })}`))
    const def = getSnapshot().repo?.default_branch
    res.json({ branches: r.data.map((b) => ({ name: b.name, sha: (b.commit as { sha: string }).sha, protected: !!b.protected, isDefault: b.name === def })), next: r.next, defaultBranch: def })
  }),
)
githubRouter.post(
  '/branches',
  wrap(async (req, res) => {
    const name = ref(req.body?.name)
    const from = ref(req.body?.from, getSnapshot().repo?.default_branch || 'main')
    if (!name) throw new HttpError(400, 'Branch name required')
    const base = await gh<J>('GET', repoPath(`/git/ref/heads/${encodeURIComponent(from)}`))
    const r = await gh<J>('POST', repoPath('/git/refs'), { ref: `refs/heads/${name}`, sha: (base.object as { sha: string }).sha })
    log(req, 'branch', `Branch ${name} created from ${from}`)
    res.status(201).json({ branch: { name, sha: (r.object as { sha: string }).sha } })
  }),
)
githubRouter.delete(
  '/branches/:name',
  wrap(async (req, res) => {
    const name = ref(req.params.name)
    if (name === getSnapshot().repo?.default_branch) throw new HttpError(400, 'Refusing to delete the default branch')
    await gh('DELETE', repoPath(`/git/refs/heads/${encodeURIComponent(name)}`))
    log(req, 'branch', `Branch ${name} deleted`)
    res.json({ ok: true })
  }),
)
githubRouter.put('/default-branch', wrap(async (req, res) => { const b = ref(req.body?.branch); await gh('PATCH', repoPath(), { default_branch: b }); log(req, 'branch', `Default branch set to ${b}`); refreshSnapshot('default').catch(() => null); res.json({ ok: true }) }))

/* ---------- pull requests ---------- */

const prJson = (p: J) => ({ number: p.number, title: p.title, body: p.body ?? '', state: p.state, draft: !!p.draft, merged: !!p.merged || !!p.merged_at, mergeable: p.mergeable ?? null, mergeable_state: p.mergeable_state ?? '', author: user(p.user), head: (p.head as { ref: string; sha: string }).ref, headSha: (p.head as { sha: string }).sha, base: (p.base as { ref: string }).ref, created_at: p.created_at, updated_at: p.updated_at, merged_at: p.merged_at, url: p.html_url, labels: ((p.labels as { name: string }[]) ?? []).map((l) => l.name), comments: p.comments, review_comments: p.review_comments, commits: p.commits, additions: p.additions, deletions: p.deletions, changed_files: p.changed_files, requested_reviewers: ((p.requested_reviewers as J[]) ?? []).map(user) })

githubRouter.get(
  '/pulls',
  wrap(async (req, res) => {
    const r = await ghRaw<J[]>('GET', repoPath(`/pulls${qs({ state: ['open', 'closed', 'all'].includes(String(req.query.state)) ? String(req.query.state) : 'open', sort: 'updated', direction: 'desc', ...page(req) })}`))
    res.json({ pulls: r.data.map(prJson), next: r.next })
  }),
)
githubRouter.get(
  '/pulls/:n',
  wrap(async (req, res) => {
    const id = n(req.params.n)
    const p = await gh<J>('GET', repoPath(`/pulls/${id}`))
    const [files, reviews, comments, issueComments, checks] = await Promise.all([
      gh<J[]>('GET', repoPath(`/pulls/${id}/files?per_page=100`)),
      gh<J[]>('GET', repoPath(`/pulls/${id}/reviews?per_page=50`)),
      gh<J[]>('GET', repoPath(`/pulls/${id}/comments?per_page=100`)),
      gh<J[]>('GET', repoPath(`/issues/${id}/comments?per_page=100`)),
      gh<{ check_runs: J[] }>('GET', repoPath(`/commits/${(p.head as { sha: string }).sha}/check-runs?per_page=50`)).catch(() => ({ check_runs: [] as J[] })),
    ])
    res.json({
      pull: prJson(p),
      files: files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: String(f.patch ?? '').slice(0, 20_000) })),
      reviews: reviews.map((r) => ({ id: r.id, author: user(r.user), state: r.state, body: r.body ?? '', submitted_at: r.submitted_at })),
      reviewComments: comments.map((c) => ({ id: c.id, author: user(c.user), body: c.body, path: c.path, line: c.line ?? c.original_line, created_at: c.created_at, url: c.html_url })),
      comments: issueComments.map((c) => ({ id: c.id, author: user(c.user), body: c.body, created_at: c.created_at, url: c.html_url })),
      checks: checks.check_runs.map((c) => ({ id: c.id, name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url, app: (c.app as { name?: string } | undefined)?.name ?? '' })),
    })
  }),
)
githubRouter.post(
  '/pulls',
  wrap(async (req, res) => {
    const b = req.body ?? {}
    const title = str(b.title, 250)
    if (!title) throw new HttpError(400, 'Title required')
    const p = await gh<J>('POST', repoPath('/pulls'), { title, body: str(b.body, 60_000), head: ref(b.head), base: ref(b.base, getSnapshot().repo?.default_branch || 'main'), draft: !!b.draft })
    log(req, 'pull', `PR #${p.number} opened: ${title}`)
    refreshSnapshot('pr').catch(() => null)
    res.status(201).json({ pull: prJson(p) })
  }),
)
githubRouter.patch(
  '/pulls/:n',
  wrap(async (req, res) => {
    const b = req.body ?? {}
    const patch: J = {}
    if (typeof b.title === 'string') patch.title = str(b.title, 250)
    if (typeof b.body === 'string') patch.body = str(b.body, 60_000)
    if (b.state === 'open' || b.state === 'closed') patch.state = b.state
    if (typeof b.base === 'string') patch.base = ref(b.base)
    const p = await gh<J>('PATCH', repoPath(`/pulls/${n(req.params.n)}`), patch)
    log(req, 'pull', `PR #${req.params.n} updated (${Object.keys(patch).join(', ')})`)
    refreshSnapshot('pr').catch(() => null)
    res.json({ pull: prJson(p) })
  }),
)
githubRouter.post(
  '/pulls/:n/merge',
  wrap(async (req, res) => {
    const method = ['merge', 'squash', 'rebase'].includes(req.body?.method) ? (req.body.method as string) : 'squash'
    const r = await gh<J>('PUT', repoPath(`/pulls/${n(req.params.n)}/merge`), { merge_method: method, commit_title: str(req.body?.title, 250) || undefined, commit_message: str(req.body?.message, 10_000) || undefined })
    log(req, 'pull', `PR #${req.params.n} merged (${method}): ${r.sha}`)
    if (req.body?.deleteBranch && typeof req.body.branch === 'string') await gh('DELETE', repoPath(`/git/refs/heads/${encodeURIComponent(ref(req.body.branch))}`)).catch(() => null)
    refreshSnapshot('merge').catch(() => null)
    res.json({ merged: !!r.merged, sha: r.sha, message: r.message })
  }),
)
githubRouter.post('/pulls/:n/update-branch', wrap(async (req, res) => { await gh('PUT', repoPath(`/pulls/${n(req.params.n)}/update-branch`), {}); log(req, 'pull', `PR #${req.params.n}: branch updated from base`); res.json({ ok: true }) }))
githubRouter.post(
  '/pulls/:n/reviews',
  wrap(async (req, res) => {
    const event = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(req.body?.event) ? (req.body.event as string) : 'COMMENT'
    const body = str(req.body?.body, 20_000)
    if (event !== 'APPROVE' && !body) throw new HttpError(400, 'A comment is required')
    const r = await gh<J>('POST', repoPath(`/pulls/${n(req.params.n)}/reviews`), { event, body: body || undefined })
    log(req, 'pull', `PR #${req.params.n}: review ${event.toLowerCase().replace('_', ' ')}`)
    res.status(201).json({ review: { id: r.id, state: r.state } })
  }),
)
githubRouter.post('/pulls/:n/reviewers', wrap(async (req, res) => { const reviewers = Array.isArray(req.body?.reviewers) ? (req.body.reviewers as unknown[]).map((x) => str(x, 60)).filter(Boolean) : []; await gh('POST', repoPath(`/pulls/${n(req.params.n)}/requested_reviewers`), { reviewers }); log(req, 'pull', `PR #${req.params.n}: reviewers requested (${reviewers.join(', ')})`); res.json({ ok: true }) }))

/* ---------- issues, comments, labels ---------- */

const issueJson = (i: J) => ({ number: i.number, title: i.title, body: i.body ?? '', state: i.state, state_reason: i.state_reason ?? null, author: user(i.user), labels: ((i.labels as { name: string; color: string }[]) ?? []).map((l) => ({ name: l.name, color: l.color })), assignees: ((i.assignees as J[]) ?? []).map(user), milestone: (i.milestone as { title?: string } | null)?.title ?? null, comments: i.comments, created_at: i.created_at, updated_at: i.updated_at, closed_at: i.closed_at, url: i.html_url, isPull: !!i.pull_request })

githubRouter.get(
  '/issues',
  wrap(async (req, res) => {
    const r = await ghRaw<J[]>('GET', repoPath(`/issues${qs({ state: ['open', 'closed', 'all'].includes(String(req.query.state)) ? String(req.query.state) : 'open', labels: str(req.query.labels, 300), assignee: str(req.query.assignee, 60), sort: 'updated', ...page(req) })}`))
    res.json({ issues: r.data.filter((i) => !i.pull_request).map(issueJson), next: r.next })
  }),
)
githubRouter.get(
  '/issues/:n',
  wrap(async (req, res) => {
    const id = n(req.params.n)
    const [i, comments] = await Promise.all([gh<J>('GET', repoPath(`/issues/${id}`)), gh<J[]>('GET', repoPath(`/issues/${id}/comments?per_page=100`))])
    res.json({ issue: issueJson(i), comments: comments.map((c) => ({ id: c.id, author: user(c.user), body: c.body, created_at: c.created_at, url: c.html_url })) })
  }),
)
githubRouter.post(
  '/issues',
  wrap(async (req, res) => {
    const b = req.body ?? {}
    const title = str(b.title, 250)
    if (!title) throw new HttpError(400, 'Title required')
    const i = await gh<J>('POST', repoPath('/issues'), { title, body: str(b.body, 60_000), labels: Array.isArray(b.labels) ? b.labels.map((x: unknown) => str(x, 50)).filter(Boolean) : [], assignees: Array.isArray(b.assignees) ? b.assignees.map((x: unknown) => str(x, 60)).filter(Boolean) : [] })
    log(req, 'issue', `Issue #${i.number} opened: ${title}`)
    refreshSnapshot('issue').catch(() => null)
    res.status(201).json({ issue: issueJson(i) })
  }),
)
githubRouter.patch(
  '/issues/:n',
  wrap(async (req, res) => {
    const b = req.body ?? {}
    const patch: J = {}
    if (typeof b.title === 'string') patch.title = str(b.title, 250)
    if (typeof b.body === 'string') patch.body = str(b.body, 60_000)
    if (b.state === 'open' || b.state === 'closed') patch.state = b.state
    if (['completed', 'not_planned', 'reopened'].includes(b.state_reason)) patch.state_reason = b.state_reason
    if (Array.isArray(b.labels)) patch.labels = b.labels.map((x: unknown) => str(x, 50)).filter(Boolean)
    if (Array.isArray(b.assignees)) patch.assignees = b.assignees.map((x: unknown) => str(x, 60)).filter(Boolean)
    const i = await gh<J>('PATCH', repoPath(`/issues/${n(req.params.n)}`), patch)
    log(req, 'issue', `Issue #${req.params.n} updated (${Object.keys(patch).join(', ')})`)
    refreshSnapshot('issue').catch(() => null)
    res.json({ issue: issueJson(i) })
  }),
)
githubRouter.post('/issues/:n/comments', wrap(async (req, res) => { const body = str(req.body?.body, 60_000); if (!body) throw new HttpError(400, 'Comment required'); const c = await gh<J>('POST', repoPath(`/issues/${n(req.params.n)}/comments`), { body }); log(req, 'issue', `Comment on #${req.params.n}: ${body.slice(0, 80)}`); res.status(201).json({ comment: { id: c.id, author: user(c.user), body: c.body, created_at: c.created_at, url: c.html_url } }) }))
githubRouter.delete('/comments/:id', wrap(async (req, res) => { await gh('DELETE', repoPath(`/issues/comments/${n(req.params.id)}`)); log(req, 'issue', `Comment ${req.params.id} deleted`); res.json({ ok: true }) }))
githubRouter.get('/labels', wrap(async (_req, res) => res.json({ labels: (await gh<J[]>('GET', repoPath('/labels?per_page=100'))).map((l) => ({ name: l.name, color: l.color, description: l.description ?? '' })) })))
githubRouter.post('/labels', wrap(async (req, res) => { const name = str(req.body?.name, 50); if (!name) throw new HttpError(400, 'Name required'); const l = await gh<J>('POST', repoPath('/labels'), { name, color: (str(req.body?.color, 6) || 'ededed').replace('#', ''), description: str(req.body?.description, 100) }); log(req, 'label', `Label ${name} created`); res.status(201).json({ label: { name: l.name, color: l.color, description: l.description ?? '' } }) }))
githubRouter.delete('/labels/:name', wrap(async (req, res) => { await gh('DELETE', repoPath(`/labels/${encodeURIComponent(str(req.params.name, 50))}`)); log(req, 'label', `Label ${req.params.name} deleted`); res.json({ ok: true }) }))
githubRouter.get('/collaborators', wrap(async (_req, res) => res.json({ collaborators: (await gh<J[]>('GET', repoPath('/collaborators?per_page=100'))).map((c) => ({ login: c.login, avatar: c.avatar_url, role: c.role_name ?? '', permissions: c.permissions })) })))
githubRouter.put('/collaborators/:login', wrap(async (req, res) => { const login = str(req.params.login, 60); const permission = ['pull', 'triage', 'push', 'maintain', 'admin'].includes(req.body?.permission) ? (req.body.permission as string) : 'push'; await gh('PUT', repoPath(`/collaborators/${encodeURIComponent(login)}`), { permission }); log(req, 'collaborator', `${login} invited as ${permission}`); res.json({ ok: true }) }))
githubRouter.delete('/collaborators/:login', wrap(async (req, res) => { await gh('DELETE', repoPath(`/collaborators/${encodeURIComponent(str(req.params.login, 60))}`)); log(req, 'collaborator', `${req.params.login} removed`); res.json({ ok: true }) }))

/* ---------- actions ---------- */

const runJson = (r: J) => ({ id: r.id, name: r.name, run_number: r.run_number, attempt: r.run_attempt, status: r.status, conclusion: r.conclusion, branch: r.head_branch, sha: r.head_sha, event: r.event, title: r.display_title, actor: user(r.actor), created_at: r.created_at, updated_at: r.updated_at, run_started_at: r.run_started_at, url: r.html_url, workflow_id: r.workflow_id })

githubRouter.get('/actions/workflows', wrap(async (_req, res) => res.json({ workflows: (await gh<{ workflows: J[] }>('GET', repoPath('/actions/workflows?per_page=100'))).workflows.map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state, url: w.html_url, badge: w.badge_url })) })))
githubRouter.get(
  '/actions/runs',
  wrap(async (req, res) => {
    const wf = str(req.query.workflow, 120)
    const r = await ghRaw<{ total_count: number; workflow_runs: J[] }>('GET', repoPath(`${wf ? `/actions/workflows/${encodeURIComponent(wf)}` : '/actions'}/runs${qs({ branch: ref(req.query.branch), status: str(req.query.status, 30), event: str(req.query.event, 30), actor: str(req.query.actor, 60), ...page(req) })}`))
    res.json({ total: r.data.total_count, runs: r.data.workflow_runs.map(runJson), next: r.next })
  }),
)
githubRouter.get(
  '/actions/runs/:id',
  wrap(async (req, res) => {
    const id = n(req.params.id)
    const [r, jobs, artifacts] = await Promise.all([gh<J>('GET', repoPath(`/actions/runs/${id}`)), gh<{ jobs: J[] }>('GET', repoPath(`/actions/runs/${id}/jobs?per_page=100&filter=latest`)), gh<{ artifacts: J[] }>('GET', repoPath(`/actions/runs/${id}/artifacts`)).catch(() => ({ artifacts: [] as J[] }))])
    res.json({
      run: runJson(r),
      jobs: jobs.jobs.map((j) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, started_at: j.started_at, completed_at: j.completed_at, url: j.html_url, runner: j.runner_name ?? '', steps: ((j.steps as J[]) ?? []).map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion, number: s.number, started_at: s.started_at, completed_at: s.completed_at })) })),
      artifacts: artifacts.artifacts.map((a) => ({ id: a.id, name: a.name, size: a.size_in_bytes, expired: a.expired, created_at: a.created_at, expires_at: a.expires_at })),
    })
  }),
)
githubRouter.get(
  '/actions/jobs/:id/logs',
  wrap(async (req, res) => {
    const r = await ghRaw<string>('GET', repoPath(`/actions/jobs/${n(req.params.id)}/logs`), undefined, { text: true, accept: '*/*', timeoutMs: 60_000 })
    const text = typeof r.data === 'string' ? r.data : Buffer.from(r.data as unknown as ArrayBuffer).toString('utf8')
    const lines = text.split('\n')
    const tail = Math.min(5000, num(req.query.tail, 1000))
    res.json({ logs: lines.slice(-tail).join('\n'), lines: lines.length, truncated: lines.length > tail })
  }),
)
githubRouter.post(
  '/actions/runs/:id/:action',
  wrap(async (req, res) => {
    const id = n(req.params.id)
    const a = String(req.params.action)
    const map: Record<string, [string, string]> = { rerun: ['POST', 'rerun'], 'rerun-failed': ['POST', 'rerun-failed-jobs'], cancel: ['POST', 'cancel'], 'force-cancel': ['POST', 'force-cancel'], delete: ['DELETE', ''], approve: ['POST', 'approve'] }
    if (!map[a]) throw new HttpError(400, 'Unknown action')
    await gh(map[a][0], repoPath(`/actions/runs/${id}${map[a][1] ? `/${map[a][1]}` : ''}`), map[a][0] === 'POST' ? {} : undefined)
    log(req, 'actions', `Run ${id}: ${a}`)
    setTimeout(() => refreshSnapshot('run').catch(() => null), 3000).unref()
    res.json({ ok: true })
  }),
)
githubRouter.post(
  '/actions/workflows/:id/dispatch',
  wrap(async (req, res) => {
    const wf = str(req.params.id, 120)
    const inputs = typeof req.body?.inputs === 'object' && req.body.inputs ? (req.body.inputs as Record<string, string>) : {}
    await gh('POST', repoPath(`/actions/workflows/${encodeURIComponent(wf)}/dispatches`), { ref: ref(req.body?.ref, getSnapshot().repo?.default_branch || 'main'), inputs })
    log(req, 'actions', `Workflow ${wf} dispatched on ${ref(req.body?.ref, getSnapshot().repo?.default_branch || 'main')}`)
    setTimeout(() => refreshSnapshot('dispatch').catch(() => null), 3000).unref()
    res.json({ ok: true })
  }),
)
githubRouter.post('/actions/workflows/:id/:state', wrap(async (req, res) => { const s = String(req.params.state); if (s !== 'enable' && s !== 'disable') throw new HttpError(400, 'Unknown action'); await gh('PUT', repoPath(`/actions/workflows/${encodeURIComponent(str(req.params.id, 120))}/${s}`), {}); log(req, 'actions', `Workflow ${req.params.id} ${s}d`); res.json({ ok: true }) }))
githubRouter.delete('/actions/artifacts/:id', wrap(async (req, res) => { await gh('DELETE', repoPath(`/actions/artifacts/${n(req.params.id)}`)); log(req, 'actions', `Artifact ${req.params.id} deleted`); res.json({ ok: true }) }))

/* ---------- releases & tags ---------- */

const relJson = (r: J) => ({ id: r.id, tag: r.tag_name, name: r.name ?? '', body: r.body ?? '', draft: !!r.draft, prerelease: !!r.prerelease, author: user(r.author), created_at: r.created_at, published_at: r.published_at, url: r.html_url, target: r.target_commitish, assets: ((r.assets as J[]) ?? []).map((a) => ({ id: a.id, name: a.name, size: a.size, downloads: a.download_count, url: a.browser_download_url })) })
githubRouter.get('/releases', wrap(async (req, res) => { const r = await ghRaw<J[]>('GET', repoPath(`/releases${qs(page(req))}`)); res.json({ releases: r.data.map(relJson), next: r.next }) }))
githubRouter.get('/tags', wrap(async (req, res) => { const r = await ghRaw<J[]>('GET', repoPath(`/tags${qs(page(req))}`)); res.json({ tags: r.data.map((t) => ({ name: t.name, sha: (t.commit as { sha: string }).sha, zip: t.zipball_url })), next: r.next }) }))
githubRouter.post(
  '/releases',
  wrap(async (req, res) => {
    const b = req.body ?? {}
    const tag = ref(b.tag)
    if (!tag) throw new HttpError(400, 'Tag required')
    const r = await gh<J>('POST', repoPath('/releases'), { tag_name: tag, target_commitish: ref(b.target) || undefined, name: str(b.name, 200) || tag, body: str(b.body, 60_000), draft: !!b.draft, prerelease: !!b.prerelease, generate_release_notes: !!b.generateNotes })
    log(req, 'release', `Release ${tag} ${b.draft ? 'drafted' : 'published'}`)
    refreshSnapshot('release').catch(() => null)
    res.status(201).json({ release: relJson(r) })
  }),
)
githubRouter.patch('/releases/:id', wrap(async (req, res) => { const b = req.body ?? {}; const patch: J = {}; if (typeof b.name === 'string') patch.name = str(b.name, 200); if (typeof b.body === 'string') patch.body = str(b.body, 60_000); if (typeof b.draft === 'boolean') patch.draft = b.draft; if (typeof b.prerelease === 'boolean') patch.prerelease = b.prerelease; if (typeof b.tag === 'string') patch.tag_name = ref(b.tag); const r = await gh<J>('PATCH', repoPath(`/releases/${n(req.params.id)}`), patch); log(req, 'release', `Release ${r.tag_name} updated`); res.json({ release: relJson(r) }) }))
githubRouter.delete('/releases/:id', wrap(async (req, res) => { await gh('DELETE', repoPath(`/releases/${n(req.params.id)}`)); log(req, 'release', `Release ${req.params.id} deleted`); refreshSnapshot('release').catch(() => null); res.json({ ok: true }) }))
githubRouter.delete('/releases/:id/assets/:aid', wrap(async (req, res) => { await gh('DELETE', repoPath(`/releases/assets/${n(req.params.aid)}`)); log(req, 'release', `Release asset ${req.params.aid} deleted`); res.json({ ok: true }) }))

/* ---------- code: browse, read, commit ---------- */

const safePath = (v: unknown) => {
  const p = str(v, 1000).replace(/^\/+/, '')
  if (p.includes('..') || p.includes('\0')) throw new HttpError(400, 'Bad path')
  return p
}
githubRouter.get(
  '/contents',
  wrap(async (req, res) => {
    const p = safePath(req.query.path)
    const r = await gh<J | J[]>('GET', repoPath(`/contents/${p.split('/').map(encodeURIComponent).join('/')}${qs({ ref: ref(req.query.ref) })}`))
    if (Array.isArray(r)) return res.json({ path: p, type: 'dir', entries: r.map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size, sha: e.sha })).sort((a, b) => (a.type === b.type ? String(a.name).localeCompare(String(b.name)) : a.type === 'dir' ? -1 : 1)) })
    const content = r.encoding === 'base64' ? Buffer.from(String(r.content ?? ''), 'base64') : Buffer.from(String(r.content ?? ''))
    const binary = content.subarray(0, 4000).includes(0)
    res.json({ path: p, type: 'file', sha: r.sha, size: r.size, binary, content: binary ? '' : content.toString('utf8'), url: r.html_url, download: r.download_url })
  }),
)
githubRouter.put(
  '/contents',
  wrap(async (req, res) => {
    const b = req.body ?? {}
    const p = safePath(b.path)
    const message = str(b.message, 500) || `Update ${p} from the xGallery developer panel`
    const r = await gh<J>('PUT', repoPath(`/contents/${p.split('/').map(encodeURIComponent).join('/')}`), { message, content: Buffer.from(String(b.content ?? ''), 'utf8').toString('base64'), sha: str(b.sha, 64) || undefined, branch: ref(b.branch) || undefined })
    const commit = r.commit as { sha: string; html_url: string }
    log(req, 'commit', `${str(b.sha, 64) ? 'Updated' : 'Created'} ${p} on ${ref(b.branch) || 'default'}: ${message.slice(0, 80)} (${commit.sha.slice(0, 7)})`)
    refreshSnapshot('commit').catch(() => null)
    res.json({ sha: (r.content as { sha: string }).sha, commit: { sha: commit.sha, url: commit.html_url } })
  }),
)
githubRouter.delete(
  '/contents',
  wrap(async (req, res) => {
    const b = req.body ?? {}
    const p = safePath(b.path)
    const r = await gh<J>('DELETE', repoPath(`/contents/${p.split('/').map(encodeURIComponent).join('/')}`), { message: str(b.message, 500) || `Delete ${p} from the xGallery developer panel`, sha: str(b.sha, 64), branch: ref(b.branch) || undefined })
    log(req, 'commit', `Deleted ${p} on ${ref(b.branch) || 'default'} (${(r.commit as { sha: string }).sha.slice(0, 7)})`)
    refreshSnapshot('commit').catch(() => null)
    res.json({ commit: { sha: (r.commit as { sha: string }).sha } })
  }),
)
githubRouter.get('/search', wrap(async (req, res) => { const q = str(req.query.q, 200); if (!q) throw new HttpError(400, 'q required'); const g = getGithub(); const r = await gh<{ total_count: number; items: J[] }>('GET', `/search/code${qs({ q: `${q} repo:${g.owner}/${g.repo}`, per_page: 30 })}`); res.json({ total: r.total_count, items: r.items.map((i) => ({ name: i.name, path: i.path, url: i.html_url, sha: i.sha })) }) }))
githubRouter.get('/tree', wrap(async (req, res) => { const r = await gh<{ tree: J[]; truncated: boolean }>('GET', repoPath(`/git/trees/${encodeURIComponent(ref(req.query.ref, getSnapshot().repo?.default_branch || 'main'))}?recursive=1`)); res.json({ tree: r.tree.filter((t) => t.type === 'blob').map((t) => ({ path: t.path, size: t.size })), truncated: r.truncated }) }))

/* ---------- secrets & variables ---------- */

githubRouter.get('/secrets', wrap(async (_req, res) => { const [s, v] = await Promise.all([gh<{ secrets: J[] }>('GET', repoPath('/actions/secrets?per_page=100')), gh<{ variables: J[] }>('GET', repoPath('/actions/variables?per_page=100')).catch(() => ({ variables: [] as J[] }))]); res.json({ secrets: s.secrets.map((x) => ({ name: x.name, created_at: x.created_at, updated_at: x.updated_at })), variables: v.variables.map((x) => ({ name: x.name, value: x.value, updated_at: x.updated_at })) }) }))
githubRouter.put(
  '/secrets/:name',
  wrap(async (req, res) => {
    const name = str(req.params.name, 200).toUpperCase()
    if (!SECRET_NAME_RE.test(name)) throw new HttpError(400, 'Secret names are UPPER_CASE letters, digits and underscores')
    const value = typeof req.body?.value === 'string' ? req.body.value : ''
    if (!value) throw new HttpError(400, 'Value required')
    const sealed = await sealForRepo(value)
    await gh('PUT', repoPath(`/actions/secrets/${name}`), sealed)
    log(req, 'secret', `Repository secret ${name} set (${value.length} chars)`)
    res.json({ ok: true, name })
  }),
)
githubRouter.delete('/secrets/:name', wrap(async (req, res) => { const name = str(req.params.name, 200).toUpperCase(); if (!SECRET_NAME_RE.test(name)) throw new HttpError(400, 'Bad name'); await gh('DELETE', repoPath(`/actions/secrets/${name}`)); log(req, 'secret', `Repository secret ${name} deleted`); res.json({ ok: true }) }))
githubRouter.put('/variables/:name', wrap(async (req, res) => { const name = str(req.params.name, 200).toUpperCase(); if (!SECRET_NAME_RE.test(name)) throw new HttpError(400, 'Bad name'); const value = str(req.body?.value, 48_000); const exists = await gh('GET', repoPath(`/actions/variables/${name}`)).then(() => true).catch(() => false); await gh(exists ? 'PATCH' : 'POST', repoPath(exists ? `/actions/variables/${name}` : '/actions/variables'), { name, value }); log(req, 'variable', `Repository variable ${name} ${exists ? 'updated' : 'created'}`); res.json({ ok: true }) }))
githubRouter.delete('/variables/:name', wrap(async (req, res) => { const name = str(req.params.name, 200).toUpperCase(); if (!SECRET_NAME_RE.test(name)) throw new HttpError(400, 'Bad name'); await gh('DELETE', repoPath(`/actions/variables/${name}`)); log(req, 'variable', `Repository variable ${name} deleted`); res.json({ ok: true }) }))

/* ---------- webhooks (keep this server current) ---------- */

const HOOK_EVENTS = ['push', 'pull_request', 'pull_request_review', 'issues', 'issue_comment', 'workflow_run', 'release', 'create', 'delete', 'star', 'fork']
githubRouter.get('/hooks', wrap(async (_req, res) => { const hooks = await gh<J[]>('GET', repoPath('/hooks')); const url = webhookUrl(); res.json({ hooks: hooks.map((h) => ({ id: h.id, url: (h.config as { url?: string })?.url ?? '', events: h.events, active: h.active, ours: (h.config as { url?: string })?.url === url, last: (h.last_response as { code?: number | null; status?: string; message?: string | null } | undefined) ?? null, updated_at: h.updated_at })), webhookUrl: url, events: HOOK_EVENTS }) }))
githubRouter.post(
  '/hooks/install',
  wrap(async (req, res) => {
    const url = webhookUrl()
    const existing = (await gh<J[]>('GET', repoPath('/hooks'))).find((h) => (h.config as { url?: string })?.url === url)
    const cfg = { url, content_type: 'json', secret: getGithub().webhookSecret, insecure_ssl: '0' }
    const h = existing ? await gh<J>('PATCH', repoPath(`/hooks/${existing.id}`), { config: cfg, events: HOOK_EVENTS, active: true }) : await gh<J>('POST', repoPath('/hooks'), { name: 'web', config: cfg, events: HOOK_EVENTS, active: true })
    log(req, 'hook', `Webhook ${existing ? 'updated' : 'installed'} → ${url}`)
    res.status(existing ? 200 : 201).json({ hook: { id: h.id, url, events: h.events } })
  }),
)
githubRouter.post('/hooks/:id/ping', wrap(async (req, res) => { await gh('POST', repoPath(`/hooks/${n(req.params.id)}/pings`), {}); res.json({ ok: true }) }))
githubRouter.delete('/hooks/:id', wrap(async (req, res) => { await gh('DELETE', repoPath(`/hooks/${n(req.params.id)}`)); log(req, 'hook', `Webhook ${req.params.id} removed`); res.json({ ok: true }) }))

/* ---------- GitHub notifications for the token's user ---------- */

githubRouter.get('/notifications', wrap(async (req, res) => { const r = await ghRaw<J[]>('GET', `/notifications${qs({ all: req.query.all === '1' ? 'true' : undefined, per_page: 50 })}`); res.json({ notifications: r.data.map((x) => ({ id: x.id, reason: x.reason, unread: x.unread, updated_at: x.updated_at, title: (x.subject as { title?: string })?.title ?? '', type: (x.subject as { type?: string })?.type ?? '', repo: (x.repository as { full_name?: string })?.full_name ?? '', url: String((x.subject as { url?: string })?.url ?? '').replace('https://api.github.com/repos/', 'https://github.com/').replace('/pulls/', '/pull/') })) }) }))
githubRouter.put('/notifications/read', wrap(async (req, res) => { if (req.body?.id) await gh('PATCH', `/notifications/threads/${n(req.body.id)}`, {}); else await gh('PUT', '/notifications', { read: true }); res.json({ ok: true }) }))

/* ---------- explorer ---------- */

githubRouter.post(
  '/raw',
  wrap(async (req, res) => {
    const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.body?.method).toUpperCase()) ? String(req.body.method).toUpperCase() : 'GET'
    let path = str(req.body?.path, 400)
    if (!path.startsWith('/')) throw new HttpError(400, 'path must start with /')
    const g = getGithub()
    path = path.replace('{repo}', `/repos/${g.owner}/${g.repo}`).replace('{owner}', g.owner)
    const r = await ghRaw('GET' === method ? 'GET' : method, path, req.body?.body)
    if (method !== 'GET') log(req, 'raw', `GitHub API ${method} ${path}`)
    res.json({ result: r.data, status: r.status, next: r.next, rate: rate() })
  }),
)

/* ---------- public webhook receiver (mounted separately, raw body) ---------- */

export const githubWebhookRouter = Router()
githubWebhookRouter.post('/', (req, res) => {
  const body = req.body as Buffer
  if (!Buffer.isBuffer(body)) return res.status(400).json({ error: 'Raw body expected' })
  if (!verifySignature(getGithub().webhookSecret, body, req.headers['x-hub-signature-256'] as string | undefined)) return res.status(401).json({ error: 'Bad signature' })
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'Malformed JSON' })
  }
  const event = String(req.headers['x-github-event'] ?? 'unknown')
  const ev = handleDelivery(event, payload)
  res.json({ ok: true, id: ev?.id ?? null })
})
