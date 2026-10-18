import { Router } from 'express'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ssh2 from 'ssh2'
import { recordEvent, requireDev } from '../dev.js'
import { DATA_DIR, getSetting, setSetting } from '../db.js'
import { getOps } from '../ops.js'
import { HttpError, str, wrap } from '../util.js'
import { getGithub, gh, ghRaw, sealForRepo } from '../github/client.js'
import { getHostinger, hapi } from '../vps/hostinger.js'
import { getSshConfig } from '../terminal.js'
import { connect, execOn, profileById, q } from '../vps/ssh.js'
import { logActivity } from '../activity.js'

const { utils } = ssh2

/**
 * The new-project wizard (/dev/new-project). It runs the starter kit (kit/new-project.mjs) on the
 * server and then does everything a new project needs to deploy and to show up in Claude.ai:
 * creates the GitHub repository, gives it its own deploy key (installed on the VPS) and the Actions
 * secrets, adds the DNS records, gives the Claude GitHub app access to the repository, pushes `main`,
 * waits for the site deploy, pushes `panel`, waits for the panel deploy. The client runs one step
 * per call so it can show progress and ask when something needs the owner.
 *
 * Only non-secret facts are kept (setting `devNewProjects`); the deploy key's private half goes
 * straight into the repository secret, and a generated owner password is shown once.
 */
export const newProjectRouter = Router()
newProjectRouter.use(requireDev)

export const CLAUDE_APP_URL = 'https://github.com/apps/claude/installations/select_target'
const ROOT = path.join(DATA_DIR, 'newprojects')
// Where the kit comes from (a clone URL or a local path) and where new repositories are pushed.
const SOURCE = () => process.env.NEWPROJECT_SOURCE || `https://github.com/${getOps().repo}.git`
const GIT_BASE = () => (process.env.NEWPROJECT_GIT_BASE || 'https://github.com').replace(/\/+$/, '')

type StepId = 'generate' | 'repo' | 'secrets' | 'dns' | 'claude-app' | 'push-main' | 'deploy-site' | 'push-panel' | 'deploy-panel' | 'finish'
const STEP_IDS: StepId[] = ['generate', 'repo', 'secrets', 'dns', 'claude-app', 'push-main', 'deploy-site', 'push-panel', 'deploy-panel', 'finish']

interface Project {
  slug: string
  name: string
  domain: string
  repo: string
  purpose: string
  private: boolean
  createdAt: number
  updatedAt: number
  steps: Partial<Record<StepId, { ok: boolean; at: number; note: string }>>
  sha?: string
  repoId?: number
  repoUrl?: string
  author?: { name: string; email: string }
}

const all = () => getSetting<Record<string, Project>>('devNewProjects', {})
const get = (slug: string) => all()[slug] ?? null
function put(p: Project): Project {
  p.updatedAt = Date.now()
  setSetting('devNewProjects', { ...all(), [p.slug]: p })
  return p
}
function mark(p: Project, step: StepId, note: string, ok = true): Project {
  p.steps[step] = { ok, at: Date.now(), note: note.slice(0, 300) }
  return put(p)
}
const dirOf = (slug: string) => path.join(ROOT, slug)

/* ---------- names ---------- */

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '')

interface Plan { name: string; slug: string; domain: string; repo: string; purpose: string; private: boolean }

/** Fill the blanks from the name (slug, domain under the Hostinger zone, repo under the token's account). */
function plan(body: Record<string, unknown>, login: string): { plan: Plan; problems: string[] } {
  const name = str(body.name, 60)
  const slug = str(body.slug, 32).toLowerCase() || slugOf(name)
  const zone = getHostinger().domain
  const domain = (str(body.domain, 253) || (slug && zone ? `${slug}.${zone}` : '')).toLowerCase()
  const owner = login || getGithub().owner
  const repo = str(body.repo, 201) || (owner && slug ? `${owner}/${slug}` : '')
  const p: Plan = { name, slug, domain, repo, purpose: str(body.purpose, 300), private: body.private !== false }
  const problems: string[] = []
  if (name.length < 2) problems.push('Give the project a name (2+ characters)')
  if (!SLUG_RE.test(slug)) problems.push('The slug must be 3-32 characters of a-z, 0-9 and hyphens, starting with a letter')
  else if (slug.includes('xgallery')) problems.push('Pick a slug without "xgallery": it would collide with the running xGallery containers')
  if (!HOST_RE.test(domain)) problems.push('The domain must be a host name such as notes.amberxai.com')
  else if (domain === getOps().domain || domain === `dev.${getOps().domain}`) problems.push("The domain must differ from this site's")
  if (!REPO_RE.test(repo)) problems.push('The repository must look like Owner/name')
  else if (repo.toLowerCase() === getOps().repo.toLowerCase()) problems.push("The repository must differ from this site's")
  return { plan: p, problems }
}

/* ---------- GitHub ---------- */

interface GhUser { login: string; id: number; name: string | null }

/** Who the panel's GitHub token belongs to, and its classic scopes (null for fine-grained tokens). */
async function whoami(): Promise<{ user: GhUser; scopes: string[] | null }> {
  const r = await ghRaw<GhUser>('GET', '/user')
  const h = r.headers.get('x-oauth-scopes')
  return { user: r.data, scopes: h == null ? null : h.split(',').map((s) => s.trim()).filter(Boolean) }
}

type RepoState = 'free' | 'empty' | 'exists' | 'unknown'
async function repoState(repo: string): Promise<{ state: RepoState; id?: number; url?: string; note?: string }> {
  try {
    const r = await gh<{ id: number; html_url: string; size: number }>('GET', `/repos/${repo}`)
    try {
      const c = await ghRaw<unknown[]>('GET', `/repos/${repo}/commits?per_page=1`)
      return { state: Array.isArray(c.data) && c.data.length ? 'exists' : 'empty', id: r.id, url: r.html_url }
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) return { state: 'empty', id: r.id, url: r.html_url }
      throw e
    }
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { state: 'free' }
    return { state: 'unknown', note: (e as Error).message }
  }
}

/* ---------- git ---------- */

/** Run git (or node) with the GitHub token passed as an HTTP header through the environment, never on the command line. */
function run(cmd: string, args: string[], cwd: string, opts: { auth?: boolean; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<string> {
  const token = getGithub().token
  const basic = token ? Buffer.from(`x-access-token:${token}`).toString('base64') : ''
  const env: Record<string, string> = { ...(process.env as Record<string, string>), GIT_TERMINAL_PROMPT: '0', ...opts.env }
  if (opts.auth && basic) Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}` })
  const scrub = (s: string) => (token ? s.split(token).join('***').split(basic).join('***') : s)
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, env, timeout: opts.timeoutMs ?? 180_000, maxBuffer: 8_000_000 }, (err, stdout, stderr) => {
      if (err) reject(new HttpError(502, scrub(`${cmd} ${args[0]} failed: ${(stderr || stdout || err.message).trim().slice(-1500)}`)))
      else resolve(scrub(`${stdout}${stderr ? `\n${stderr}` : ''}`.trim()))
    }),
  )
}

/* ---------- routes ---------- */

const locks = new Set<string>()

/** Everything the form needs: the token's account and scopes, the DNS zone, the VPS, earlier projects. */
newProjectRouter.get(
  '/status',
  wrap(async (_req, res) => {
    const gs = getGithub()
    let github: Record<string, unknown> = { hasToken: !!gs.token, login: '', scopes: null, error: null }
    if (gs.token) {
      try {
        const w = await whoami()
        github = { hasToken: true, login: w.user.login, scopes: w.scopes, error: null }
      } catch (e) {
        github = { ...github, error: (e as Error).message }
      }
    }
    const hs = getHostinger()
    const profile = profileById()
    res.json({
      github,
      hostinger: { hasToken: !!hs.token, zone: hs.domain },
      vps: { host: profile.host, user: profile.user, panelKey: !!getSshConfig().privateKey },
      source: getOps().repo,
      claudeAppUrl: CLAUDE_APP_URL,
      steps: STEP_IDS,
      projects: Object.values(all()).sort((a, b) => b.updatedAt - a.updatedAt),
    })
  }),
)

/** Validate a draft and report what already exists (repository, DNS records). */
newProjectRouter.post(
  '/check',
  wrap(async (req, res) => {
    const login = getGithub().token ? await whoami().then((w) => w.user.login).catch(() => '') : ''
    const { plan: p, problems } = plan(req.body ?? {}, login)
    const warnings: string[] = []
    let repo: Awaited<ReturnType<typeof repoState>> = { state: 'unknown' }
    if (!problems.length && getGithub().token) {
      repo = await repoState(p.repo)
      const mine = get(p.slug)
      if (repo.state === 'exists' && !(mine && mine.repo === p.repo && mine.steps['push-main']?.ok)) problems.push(`${p.repo} already exists and has commits: pick another name`)
      if (repo.state === 'empty') warnings.push(`${p.repo} exists and is empty: the wizard will use it`)
      if (repo.state === 'unknown' && repo.note) warnings.push(`Could not check the repository: ${repo.note}`)
    }
    if (!getGithub().token) problems.push('No GitHub token: add one in GitHub manager → Settings (classic token with repo + workflow scopes)')
    const zone = getHostinger().domain
    const dnsManaged = !!getHostinger().token && (p.domain === zone || p.domain.endsWith(`.${zone}`))
    if (!dnsManaged) warnings.push(getHostinger().token ? `${p.domain} is outside the Hostinger zone ${zone}: add the DNS records by hand` : 'No Hostinger token: the DNS records must be added by hand')
    if (get(p.slug) && get(p.slug)!.repo !== p.repo) problems.push(`A project with the slug ${p.slug} is already in progress for ${get(p.slug)!.repo}: remove it first or pick another slug`)
    res.json({ plan: p, problems, warnings, repo: repo.state, dnsManaged, zone })
  }),
)

/** One step of one project. `generate` creates the project record from the form. */
newProjectRouter.post(
  '/run',
  wrap(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const step = str(b.step, 20) as StepId
    if (!STEP_IDS.includes(step)) throw new HttpError(400, 'Unknown step')
    const slug = str(b.slug, 32).toLowerCase()
    if (step !== 'generate' && !get(slug)) throw new HttpError(404, 'No such project: start with Generate')
    const key = slug || slugOf(str(b.name, 60))
    if (locks.has(key)) throw new HttpError(409, 'That project is already running a step')
    locks.add(key)
    try {
      const result = await STEPS[step](req.body ?? {}, slug)
      const p = get(result.project?.slug ?? slug)
      if (p) {
        const note = result.note ?? ''
        recordEvent(req.devSession!.id, `newproject.${step}`, { summary: `${p.name}: ${step}${note ? ` — ${note}` : ''}`.slice(0, 600) })
        if (step === 'generate' || step === 'repo' || step === 'finish') logActivity({ userId: req.user!.id, kind: `newproject.${step}`, targetLabel: `${p.name} (${p.repo})`, ip: req.ip ?? '' })
      }
      res.json({ ...result, project: p })
    } finally {
      locks.delete(key)
    }
  }),
)

/** Forget a project and delete its local working copy (the GitHub repository, DNS and secrets stay). */
newProjectRouter.delete(
  '/projects/:slug',
  wrap(async (req, res) => {
    const slug = String(req.params.slug)
    if (!SLUG_RE.test(slug)) throw new HttpError(400, 'Bad slug')
    const rest = { ...all() }
    delete rest[slug]
    setSetting('devNewProjects', rest)
    fs.rmSync(dirOf(slug), { recursive: true, force: true })
    recordEvent(req.devSession!.id, 'newproject.forget', { summary: `New project ${slug} forgotten; local copy removed` })
    res.json({ ok: true })
  }),
)

/** Delete only the local working copy (after the project is live). */
newProjectRouter.delete(
  '/projects/:slug/files',
  wrap(async (req, res) => {
    const slug = String(req.params.slug)
    if (!SLUG_RE.test(slug)) throw new HttpError(400, 'Bad slug')
    fs.rmSync(dirOf(slug), { recursive: true, force: true })
    res.json({ ok: true })
  }),
)

/* ---------- steps ---------- */

interface StepOut {
  ok: boolean
  note?: string
  out?: string
  project?: Project
  /** The owner has to do something (open a link, confirm, type a password). */
  needs?: { kind: 'password' | 'link' | 'confirm-dns'; message: string; url?: string }
  adminPassword?: string
  run?: { id: number; status: string; conclusion: string | null; url: string } | null
  health?: number
  firstSession?: string
}

function requireStep(p: Project, step: StepId, what: string) {
  if (!p.steps[step]?.ok) throw new HttpError(409, `${what} first`)
}

const STEPS: Record<StepId, (b: Record<string, unknown>, slug: string) => Promise<StepOut>> = {
  /** Clone the source, run the kit into DATA_DIR/newprojects/<slug>. */
  async generate(b) {
    const w = await whoami().catch(() => null)
    const { plan: pl, problems } = plan(b, w?.user.login ?? '')
    if (problems.length) throw new HttpError(400, problems.join(' · '))
    const prev = get(pl.slug)
    if (prev && prev.repo !== pl.repo) throw new HttpError(409, `The slug ${pl.slug} is in use for ${prev.repo}`)
    if (prev?.steps['push-main']?.ok) throw new HttpError(409, 'This project is already pushed: its code now lives in the repository')
    fs.mkdirSync(ROOT, { recursive: true })
    const src = path.join(ROOT, `.source-${pl.slug}`)
    const out = dirOf(pl.slug)
    fs.rmSync(src, { recursive: true, force: true })
    fs.rmSync(out, { recursive: true, force: true })
    const author = w ? { name: w.user.name || w.user.login, email: `${w.user.id}+${w.user.login}@users.noreply.github.com` } : { name: 'xGallery panel', email: 'panel@users.noreply.github.com' }
    const gitEnv = { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email }
    let log = ''
    try {
      log += await run('git', ['clone', '-q', '--depth', '1', SOURCE(), src], ROOT, { auth: SOURCE().startsWith('https://') })
      if (!fs.existsSync(path.join(src, 'kit', 'new-project.mjs'))) throw new HttpError(502, `${getOps().repo} has no kit/new-project.mjs on its default branch`)
      const args = ['kit/new-project.mjs', '--name', pl.name, '--slug', pl.slug, '--domain', pl.domain, '--repo', pl.repo, '--out', out]
      if (pl.purpose) args.push('--purpose', pl.purpose)
      log += `\n${await run(process.execPath, args, src, { env: gitEnv, timeoutMs: 120_000 })}`
    } finally {
      fs.rmSync(src, { recursive: true, force: true })
    }
    const sha = (await run('git', ['rev-parse', 'HEAD'], out)).trim()
    const branches = await run('git', ['branch', '--list'], out)
    if (!branches.includes('panel')) throw new HttpError(502, `The kit did not commit (no panel branch):\n${log.slice(-800)}`)
    const p: Project = prev ?? { ...pl, createdAt: Date.now(), updatedAt: Date.now(), steps: {} }
    // A new copy has to be pushed again; the repository, secrets, DNS and Claude access still hold.
    const keep = (['repo', 'secrets', 'dns', 'claude-app'] as StepId[]).filter((k) => p.steps[k]?.ok)
    Object.assign(p, pl, { sha, author, steps: Object.fromEntries(keep.map((k) => [k, p.steps[k]])) })
    const left = log.match(/(\d+) line\(s\) still mention xgallery/)
    mark(p, 'generate', `${sha.slice(0, 7)} · ${left ? `${left[1]} leftover line(s)` : 'no leftovers'}`)
    return { ok: true, note: p.steps.generate!.note, out: log.trim(), project: p }
  },

  /** Create the repository (or adopt an empty one with that name). */
  async repo(b, slug) {
    const p = get(slug)!
    requireStep(p, 'generate', 'Generate the project')
    const st = await repoState(p.repo)
    if (st.state === 'unknown') throw new HttpError(502, st.note ?? 'Could not check the repository')
    if (st.state === 'exists' && !p.steps['push-main']?.ok) throw new HttpError(409, `${p.repo} already exists and has commits`)
    let id = st.id
    let url = st.url
    let note = st.state === 'free' ? 'created' : 'already there, empty'
    if (st.state === 'free') {
      const [owner, name] = p.repo.split('/')
      const login = (await whoami()).user.login
      const body = { name, description: p.purpose || `${p.name}, created from xGallery`, private: b.private === undefined ? p.private : b.private !== false, has_wiki: false, auto_init: false }
      const r = await gh<{ id: number; html_url: string }>('POST', owner.toLowerCase() === login.toLowerCase() ? '/user/repos' : `/orgs/${owner}/repos`, body)
      id = r.id
      url = r.html_url
      note = `created (${body.private ? 'private' : 'public'})`
    }
    Object.assign(p, { repoId: id, repoUrl: url })
    mark(p, 'repo', note)
    return { ok: true, note, project: p }
  },

  /** A deploy key of its own (public half on the VPS), plus ADMIN_PASSWORD and the optional Hostinger token. */
  async secrets(b, slug) {
    const p = get(slug)!
    requireStep(p, 'repo', 'Create the repository')
    const password = typeof b.password === 'string' ? b.password : ''
    if (!getSshConfig().privateKey && !password) return { ok: false, needs: { kind: 'password', message: `The panel has no SSH key yet, so the new deploy key cannot be installed on the VPS by itself. Type the VPS password for ${profileById().user}@${profileById().host} once (not stored), or run One-click setup first.` } }
    const adminTyped = str(b.adminPassword, 200)
    if (adminTyped && adminTyped.length < 8) throw new HttpError(400, 'The owner password must have 8 or more characters')
    const pair = utils.generateKeyPairSync('ed25519', { comment: `${p.slug}-deploy` })
    const pub = pair.public.trim()
    const profile = profileById()
    const client = await connect(profile, password || undefined)
    try {
      const r = await execOn(client, `umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && sed -i ${q(`/ ${p.slug}-deploy$/d`)} ~/.ssh/authorized_keys && printf '%s\\n' ${q(pub)} >> ~/.ssh/authorized_keys && echo installed`, { timeoutMs: 20_000 })
      if (!r.stdout.includes('installed')) throw new HttpError(502, `Could not install the deploy key on the VPS: ${(r.stderr || r.stdout).trim().slice(0, 300)}`)
    } finally {
      client.end()
    }
    const admin = adminTyped || randomBytes(12).toString('base64url')
    const secrets: Record<string, string> = { VPS_SSH_KEY: pair.private, ADMIN_PASSWORD: admin }
    if (profile.user !== 'root') secrets.VPS_USER = profile.user
    const hs = getHostinger()
    if (b.copyHostinger !== false && hs.token) secrets.HOSTINGER_API_TOKEN = hs.token
    for (const [name, value] of Object.entries(secrets)) {
      const sealed = await sealForRepo(value, 'actions', p.repo)
      await gh('PUT', `/repos/${p.repo}/actions/secrets/${name}`, sealed)
    }
    // The workflows deploy to the VPS_HOST they were copied with: say so if this panel targets another one.
    const wf = path.join(dirOf(p.slug), '.github/workflows/deploy.yml')
    const host = fs.existsSync(wf) ? fs.readFileSync(wf, 'utf8').match(/VPS_HOST:\s*(\S+)/)?.[1] : ''
    const note = `${Object.keys(secrets).join(', ')} set · deploy key on ${profile.host}${host && host !== profile.host ? ` (workflows target ${host})` : ''}`
    mark(p, 'secrets', note)
    return { ok: true, note, project: p, adminPassword: adminTyped ? undefined : admin }
  },

  /** A records for the site and the panel, when the domain is in the Hostinger zone. */
  async dns(b, slug) {
    const p = get(slug)!
    const hs = getHostinger()
    const zone = hs.domain
    const profile = profileById()
    const ip = /^\d+\.\d+\.\d+\.\d+$/.test(profile.host) ? profile.host : str(b.ip, 60)
    if (b.skip === true) {
      mark(p, 'dns', `skipped: add A records for ${p.domain} and dev.${p.domain} → ${ip || 'the VPS'} by hand`)
      return { ok: true, note: p.steps.dns!.note, project: p }
    }
    if (!hs.token) throw new HttpError(400, `No Hostinger token: add A records for ${p.domain} and dev.${p.domain} → ${ip || 'the VPS'} by hand, then skip this step`)
    if (p.domain !== zone && !p.domain.endsWith(`.${zone}`)) throw new HttpError(400, `${p.domain} is not in the Hostinger zone ${zone}: add the records by hand, then skip this step`)
    if (!ip) throw new HttpError(400, 'The VPS address is not an IPv4 address: pass it as ip')
    const sub = p.domain === zone ? '' : p.domain.slice(0, -(zone.length + 1))
    const names = [sub || '@', sub ? `dev.${sub}` : 'dev']
    const current = await hapi<{ name: string; type: string; records: { content: string }[] }[]>('GET', `/dns/v1/zones/${zone}`).catch(() => [])
    const clash = (Array.isArray(current) ? current : []).filter((r) => names.includes(r.name) && (r.type === 'A' || r.type === 'CNAME') && !(r.type === 'A' && r.records.every((x) => x.content === ip)))
    if (clash.length && b.force !== true)
      return { ok: false, needs: { kind: 'confirm-dns', message: `${clash.map((r) => `${r.name === '@' ? zone : `${r.name}.${zone}`} already points at ${r.records.map((x) => x.content).join(', ')} (${r.type})`).join('; ')}. Replace with ${ip}?` } }
    await hapi('PUT', `/dns/v1/zones/${zone}`, { overwrite: true, zone: names.map((name) => ({ name, type: 'A', ttl: 300, records: [{ content: ip }] })) })
    const note = `${p.domain} and dev.${p.domain} → ${ip}`
    mark(p, 'dns', note)
    return { ok: true, note, project: p }
  },

  /** Give the Claude GitHub app access, so the repository can be picked in Claude.ai and Claude Code on the web. */
  async 'claude-app'(b, slug) {
    const p = get(slug)!
    requireStep(p, 'repo', 'Create the repository')
    const owner = p.repo.split('/')[0].toLowerCase()
    type Inst = { id: number; app_slug: string; repository_selection: 'all' | 'selected'; html_url?: string; account: { login: string; type?: string } }
    let inst: Inst | undefined
    let listError = ''
    try {
      const r = await gh<{ installations: Inst[] }>('GET', '/user/installations?per_page=100')
      inst = (r.installations ?? []).find((i) => i.app_slug === 'claude' && i.account?.login?.toLowerCase() === owner)
    } catch (e) {
      listError = (e as Error).message
    }
    const manage = inst ? (inst.account.type === 'Organization' ? `https://github.com/organizations/${inst.account.login}/settings/installations/${inst.id}` : `https://github.com/settings/installations/${inst.id}`) : CLAUDE_APP_URL
    const ask = (message: string): StepOut => ({ ok: false, needs: { kind: 'link', message, url: manage } })
    if (inst?.repository_selection === 'all') {
      mark(p, 'claude-app', 'Claude app has access to every repository')
      return { ok: true, note: p.steps['claude-app']!.note, project: p }
    }
    if (inst && p.repoId) {
      try {
        await ghRaw('PUT', `/user/installations/${inst.id}/repositories/${p.repoId}`)
        mark(p, 'claude-app', `${p.repo} added to the Claude app`)
        return { ok: true, note: p.steps['claude-app']!.note, project: p }
      } catch (e) {
        if (b.confirmed === true) return confirmed(p)
        return ask(`Could not add ${p.repo} to the Claude app with the panel's token (${(e as Error).message}). Open the app's settings, add ${p.repo} under Repository access, save, then come back.`)
      }
    }
    if (b.confirmed === true) return confirmed(p)
    return ask(listError
      ? `The panel's token cannot list GitHub app installations (${listError}). Open the Claude app, choose ${owner}, give it access to ${p.repo} (or all repositories), then come back.`
      : `The Claude GitHub app is not installed on ${owner} yet. Install it, give it access to ${p.repo} (or all repositories), then come back.`)
  },

  async 'push-main'(_b, slug) {
    const p = get(slug)!
    requireStep(p, 'secrets', 'Set the secrets')
    const dir = dirOf(p.slug)
    if (!fs.existsSync(path.join(dir, '.git'))) throw new HttpError(409, 'The local copy is gone: generate again')
    const out = await run('git', ['push', '-q', `${GIT_BASE()}/${p.repo}.git`, 'main:main'], dir, { auth: GIT_BASE().startsWith('https://') })
    mark(p, 'push-main', `main pushed (${p.sha?.slice(0, 7)})`)
    return { ok: true, note: p.steps['push-main']!.note, out, project: p }
  },

  async 'deploy-site'(b, slug) {
    return watch(get(slug)!, 'main', 'deploy.yml', 'deploy-site', p0(b), get(slug)!.domain)
  },

  async 'push-panel'(_b, slug) {
    const p = get(slug)!
    requireStep(p, 'deploy-site', 'Wait for the site deploy (the panel shares its data volume)')
    const out = await run('git', ['push', '-q', `${GIT_BASE()}/${p.repo}.git`, 'panel:panel'], dirOf(p.slug), { auth: GIT_BASE().startsWith('https://') })
    mark(p, 'push-panel', 'panel pushed')
    return { ok: true, note: p.steps['push-panel']!.note, out, project: p }
  },

  async 'deploy-panel'(b, slug) {
    return watch(get(slug)!, 'panel', 'panel.yml', 'deploy-panel', p0(b), `dev.${get(slug)!.domain}`)
  },

  /** The first-session prompt for Claude Code on the web, and the links. */
  async finish(_b, slug) {
    const p = get(slug)!
    requireStep(p, 'push-main', 'Push the code')
    const f = path.join(dirOf(p.slug), 'docs', 'FIRST_SESSION.md')
    const firstSession = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
    mark(p, 'finish', 'ready for Claude')
    return { ok: true, note: 'ready for Claude', project: p, firstSession }
  },
}

const p0 = (b: Record<string, unknown>) => ({ rerun: b.rerun === true })

function confirmed(p: Project): StepOut {
  mark(p, 'claude-app', 'confirmed by you in GitHub')
  return { ok: true, note: p.steps['claude-app']!.note, project: p }
}

/** The deploy run for this push: its state, a re-run of failed jobs on request, and the host's /healthz. */
async function watch(p: Project, branch: string, file: string, step: StepId, opts: { rerun: boolean }, host: string): Promise<StepOut> {
  requireStep(p, branch === 'main' ? 'push-main' : 'push-panel', `Push ${branch}`)
  type Run = { id: number; status: string; conclusion: string | null; html_url: string; head_sha: string; path?: string; name?: string }
  const r = await gh<{ workflow_runs: Run[] }>('GET', `/repos/${p.repo}/actions/runs?branch=${branch}&per_page=20`)
  const runs = (r.workflow_runs ?? []).filter((x) => (x.path ? x.path.endsWith(`/${file}`) : true) && (!p.sha || x.head_sha === p.sha))
  const latest = runs[0]
  if (!latest) return { ok: false, note: 'waiting for GitHub Actions to start', run: null }
  const run = { id: latest.id, status: latest.status, conclusion: latest.conclusion, url: latest.html_url }
  if (opts.rerun && latest.status === 'completed' && latest.conclusion !== 'success') {
    await gh('POST', `/repos/${p.repo}/actions/runs/${latest.id}/rerun-failed-jobs`)
    return { ok: false, note: 're-running the failed jobs', run: { ...run, status: 'queued', conclusion: null } }
  }
  let health = 0
  if (latest.status === 'completed') health = await fetch(`https://${host}/healthz`, { signal: AbortSignal.timeout(6000) }).then((x) => x.status).catch(() => 0)
  if (latest.status === 'completed' && latest.conclusion === 'success') {
    const note = `deployed${health === 200 ? `, https://${host} answers` : `; https://${host} not answering here yet (DNS may still be propagating)`}`
    mark(p, step, note)
    return { ok: true, note, run, health, project: p }
  }
  if (latest.status === 'completed') return { ok: false, note: `deploy ${latest.conclusion}`, run, health }
  return { ok: false, note: `deploy ${latest.status.replace('_', ' ')}`, run }
}
