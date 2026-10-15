import { createHmac, timingSafeEqual } from 'node:crypto'
import { getSetting, setSetting } from '../db.js'
import { notifyOwner } from '../notifications.js'
import { sourceVersion } from '../ai/workspace.js'
import { getGithub, gh, ghRaw, repoPath, qs } from './client.js'

/**
 * A server-side picture of the repository that every client (browser, Android app) reads from:
 * refreshed in the background on a timer, immediately when GitHub calls our webhook, and on demand.
 * So a phone opening the panel gets the current state instantly and consistently, and the offline
 * cache holds something recent.
 */

export interface RunSummary { id: number; name: string; status: string; conclusion: string | null; branch: string; sha: string; event: string; created_at: string; updated_at: string; url: string; title: string; actor: string; run_number: number }
export interface Snapshot {
  fetchedAt: number
  repo: { full_name: string; description: string; default_branch: string; private: boolean; stars: number; forks: number; open_issues: number; size: number; pushed_at: string; url: string; language: string; license: string; visibility: string } | null
  headSha: string
  headCommit: { sha: string; message: string; author: string; date: string } | null
  commits: { sha: string; message: string; author: string; date: string; url: string }[]
  runs: RunSummary[]
  pulls: { number: number; title: string; state: string; draft: boolean; author: string; head: string; base: string; updated_at: string; url: string; mergeable_state?: string }[]
  issues: { number: number; title: string; state: string; author: string; labels: string[]; comments: number; updated_at: string; url: string }[]
  release: { tag: string; name: string; published_at: string; url: string; prerelease: boolean; draft: boolean } | null
  branches: number
  live: { version: string; upToDate: boolean | null; deploying: boolean; lastDeploy: RunSummary | null }
  error: string | null
}

export interface GhEvent { id: number; ts: number; event: string; action: string; summary: string; actor: string; url: string; sha?: string }

const EMPTY: Snapshot = { fetchedAt: 0, repo: null, headSha: '', headCommit: null, commits: [], runs: [], pulls: [], issues: [], release: null, branches: 0, live: { version: sourceVersion(), upToDate: null, deploying: false, lastDeploy: null }, error: null }
let snapshot: Snapshot = getSetting<Snapshot>('githubSnapshot', EMPTY)
let refreshing: Promise<Snapshot> | null = null
let version = 1
export const snapshotVersion = () => version

export function getSnapshot(): Snapshot {
  return { ...snapshot, live: { ...snapshot.live, version: sourceVersion() } }
}

const run = (r: Record<string, unknown>): RunSummary => ({ id: r.id as number, name: String(r.name ?? ''), status: String(r.status ?? ''), conclusion: (r.conclusion as string | null) ?? null, branch: String(r.head_branch ?? ''), sha: String(r.head_sha ?? ''), event: String(r.event ?? ''), created_at: String(r.created_at ?? ''), updated_at: String(r.updated_at ?? ''), url: String(r.html_url ?? ''), title: String(r.display_title ?? ''), actor: String((r.actor as { login?: string } | undefined)?.login ?? ''), run_number: Number(r.run_number ?? 0) })

/** Fetch everything the overview needs (about 6 requests) and persist it. */
export function refreshSnapshot(reason = 'manual'): Promise<Snapshot> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const s = getGithub()
    const next: Snapshot = { ...EMPTY, fetchedAt: Date.now(), live: { ...EMPTY.live, version: sourceVersion() } }
    if (!s.token || !s.owner || !s.repo) {
      next.error = !s.token ? 'No GitHub token saved' : 'No repository picked'
      snapshot = next
      return next
    }
    try {
      const repo = await gh<Record<string, unknown>>('GET', repoPath())
      next.repo = { full_name: String(repo.full_name), description: String(repo.description ?? ''), default_branch: String(repo.default_branch), private: !!repo.private, stars: Number(repo.stargazers_count ?? 0), forks: Number(repo.forks_count ?? 0), open_issues: Number(repo.open_issues_count ?? 0), size: Number(repo.size ?? 0), pushed_at: String(repo.pushed_at ?? ''), url: String(repo.html_url ?? ''), language: String(repo.language ?? ''), license: String((repo.license as { spdx_id?: string } | null)?.spdx_id ?? ''), visibility: String(repo.visibility ?? '') }
      const [commits, runs, pulls, issues, releases, branches] = await Promise.all([
        gh<Record<string, unknown>[]>('GET', repoPath(`/commits${qs({ sha: next.repo.default_branch, per_page: 10 })}`)),
        gh<{ workflow_runs: Record<string, unknown>[] }>('GET', repoPath('/actions/runs?per_page=12')),
        gh<Record<string, unknown>[]>('GET', repoPath('/pulls?state=open&per_page=20')),
        gh<Record<string, unknown>[]>('GET', repoPath('/issues?state=open&per_page=30')),
        gh<Record<string, unknown>[]>('GET', repoPath('/releases?per_page=1')),
        ghRaw<unknown[]>('GET', repoPath('/branches?per_page=1')),
      ])
      next.commits = commits.map((c) => ({ sha: String(c.sha), message: String((c.commit as { message: string }).message.split('\n')[0]), author: String((c.commit as { author: { name: string } }).author?.name ?? (c.author as { login?: string } | null)?.login ?? ''), date: String((c.commit as { author: { date: string } }).author?.date ?? ''), url: String(c.html_url ?? '') }))
      next.headSha = next.commits[0]?.sha ?? ''
      next.headCommit = next.commits[0] ?? null
      next.runs = runs.workflow_runs.map(run)
      next.pulls = pulls.map((p) => ({ number: Number(p.number), title: String(p.title), state: String(p.state), draft: !!p.draft, author: String((p.user as { login?: string })?.login ?? ''), head: String((p.head as { ref: string }).ref), base: String((p.base as { ref: string }).ref), updated_at: String(p.updated_at), url: String(p.html_url) }))
      next.issues = issues.filter((i) => !i.pull_request).map((i) => ({ number: Number(i.number), title: String(i.title), state: String(i.state), author: String((i.user as { login?: string })?.login ?? ''), labels: ((i.labels as { name: string }[]) ?? []).map((l) => l.name), comments: Number(i.comments ?? 0), updated_at: String(i.updated_at), url: String(i.html_url) }))
      next.release = releases[0] ? { tag: String(releases[0].tag_name), name: String(releases[0].name ?? ''), published_at: String(releases[0].published_at ?? ''), url: String(releases[0].html_url), prerelease: !!releases[0].prerelease, draft: !!releases[0].draft } : null
      const last = branches.headers.get('link')?.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/)?.[1]
      next.branches = last ? Number(last) : branches.data.length
      const v = sourceVersion()
      const deploy = next.runs.find((r) => /deploy/i.test(r.name) && r.branch === next.repo!.default_branch) ?? null
      next.live = { version: v, upToDate: v === 'dev' || !next.headSha ? null : next.headSha.startsWith(v) || v.startsWith(next.headSha.slice(0, 7)), deploying: !!deploy && deploy.status !== 'completed', lastDeploy: deploy }
    } catch (e) {
      next.error = (e as Error).message
      // keep the last good data so the panel still shows something
      snapshot = { ...snapshot, fetchedAt: Date.now(), error: next.error, live: next.live }
      version++
      return snapshot
    }
    snapshot = next
    version++
    setSetting('githubSnapshot', next)
    return next
  })().finally(() => {
    refreshing = null
  })
  void reason
  return refreshing
}

/* ---------- polling ---------- */

let timer: NodeJS.Timeout | null = null
export function startGithubPolling(): void {
  const tick = async () => {
    const s = getGithub()
    if (s.token && s.owner && s.repo && s.pollMinutes > 0) await refreshSnapshot('poll').catch(() => null)
    const mins = Math.max(1, getGithub().pollMinutes || 3)
    timer = setTimeout(tick, mins * 60_000)
    timer.unref()
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(tick, 5_000)
  timer.unref()
}

/* ---------- webhook events ---------- */

export function listEvents(): GhEvent[] {
  return getSetting<GhEvent[]>('githubEvents', [])
}

function pushEvent(e: Omit<GhEvent, 'id' | 'ts'>): GhEvent {
  const list = listEvents()
  const ev: GhEvent = { id: (list[0]?.id ?? 0) + 1, ts: Date.now(), ...e }
  setSetting('githubEvents', [ev, ...list].slice(0, 150))
  version++
  return ev
}

export function verifySignature(secret: string, body: Buffer, signature: string | undefined): boolean {
  if (!signature || !signature.startsWith('sha256=')) return false
  const mac = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  const a = Buffer.from(mac)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Turn a delivery into a feed line, notify the owner when it matters, and refresh the snapshot. */
export function handleDelivery(event: string, payload: Record<string, unknown>): GhEvent | null {
  const s = getGithub()
  const action = String(payload.action ?? '')
  const sender = String((payload.sender as { login?: string } | undefined)?.login ?? '')
  const repoName = String((payload.repository as { full_name?: string } | undefined)?.full_name ?? '')
  let summary = ''
  let url = String((payload.repository as { html_url?: string } | undefined)?.html_url ?? '')
  let sha: string | undefined
  let notifyTitle = ''
  let notifyBody = ''
  switch (event) {
    case 'ping':
      summary = `Webhook connected to ${repoName} (${String((payload.hook as { events?: string[] } | undefined)?.events?.join(', ') ?? '')})`
      break
    case 'push': {
      const commits = (payload.commits as { message: string }[] | undefined) ?? []
      const ref = String(payload.ref ?? '').replace('refs/heads/', '')
      sha = String(payload.after ?? '')
      summary = payload.deleted ? `Branch ${ref} deleted` : `${sender} pushed ${commits.length} commit${commits.length === 1 ? '' : 's'} to ${ref}${commits[0] ? `: ${commits[0].message.split('\n')[0]}` : ''}`
      url = String(payload.compare ?? url)
      break
    }
    case 'workflow_run': {
      const r = payload.workflow_run as Record<string, unknown>
      sha = String(r.head_sha ?? '')
      url = String(r.html_url ?? url)
      summary = `Workflow "${r.name}" #${r.run_number} ${action === 'completed' ? r.conclusion : action} on ${r.head_branch}`
      if (action === 'completed' && r.conclusion !== 'success') {
        notifyTitle = `${r.name} #${r.run_number} ${r.conclusion}`
        notifyBody = `${String(r.display_title ?? '')} on ${r.head_branch}`
      } else if (action === 'completed' && /deploy/i.test(String(r.name))) {
        notifyTitle = `Deployed: ${r.name} #${r.run_number} succeeded`
        notifyBody = String(r.display_title ?? '')
      }
      break
    }
    case 'pull_request': {
      const p = payload.pull_request as Record<string, unknown>
      url = String(p.html_url ?? url)
      summary = `PR #${payload.number} ${action}${action === 'closed' && p.merged ? ' (merged)' : ''}: ${p.title} (${sender})`
      if (action === 'opened' || action === 'reopened') { notifyTitle = `PR #${payload.number} opened by ${sender}`; notifyBody = String(p.title) }
      break
    }
    case 'pull_request_review':
      summary = `${sender} ${String((payload.review as { state?: string })?.state ?? 'reviewed')} PR #${(payload.pull_request as { number?: number })?.number}`
      url = String((payload.review as { html_url?: string })?.html_url ?? url)
      break
    case 'issues': {
      const i = payload.issue as Record<string, unknown>
      url = String(i.html_url ?? url)
      summary = `Issue #${i.number} ${action}: ${i.title} (${sender})`
      if (action === 'opened') { notifyTitle = `Issue #${i.number} opened by ${sender}`; notifyBody = String(i.title) }
      break
    }
    case 'issue_comment': {
      const i = payload.issue as Record<string, unknown>
      url = String((payload.comment as { html_url?: string })?.html_url ?? url)
      summary = `${sender} commented on #${i.number}: ${String((payload.comment as { body?: string })?.body ?? '').split('\n')[0].slice(0, 120)}`
      break
    }
    case 'release': {
      const r = payload.release as Record<string, unknown>
      url = String(r.html_url ?? url)
      summary = `Release ${r.tag_name} ${action}${r.name ? `: ${r.name}` : ''}`
      if (action === 'published') { notifyTitle = `Release ${r.tag_name} published`; notifyBody = String(r.name ?? '') }
      break
    }
    case 'create':
    case 'delete':
      summary = `${payload.ref_type} ${payload.ref} ${event}d by ${sender}`
      break
    case 'check_run':
    case 'check_suite':
      summary = `${event.replace('_', ' ')} ${action}${(payload[event] as { conclusion?: string } | undefined)?.conclusion ? `: ${(payload[event] as { conclusion?: string }).conclusion}` : ''}`
      break
    case 'star':
    case 'watch':
    case 'fork':
      summary = `${sender} ${event === 'fork' ? 'forked' : event === 'star' ? (action === 'created' ? 'starred' : 'unstarred') : 'is watching'} the repository`
      break
    default:
      summary = `${event}${action ? ` ${action}` : ''}${sender ? ` by ${sender}` : ''}`
  }
  const ev = pushEvent({ event, action, summary, actor: sender, url, sha })
  if (notifyTitle && s.notify) notifyOwner({ kind: `github.${event}`, title: notifyTitle, body: notifyBody, data: { url, event, action } })
  // Refresh in the background so the next read is current.
  if (event !== 'ping') setTimeout(() => refreshSnapshot('webhook').catch(() => null), 1500).unref()
  return ev
}
