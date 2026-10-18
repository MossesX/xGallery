import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Circle, Copy, ExternalLink, FolderPlus, Play, RefreshCw, Rocket, Square, Trash2, X } from 'lucide-react'
import { ApiError } from '../../../api/client'
import { newProjectApi, useNewProjectStatus, type NpCheck, type NpDraft, type NpProject, type NpResult, type NpStepId } from '../../../api/newproject'
import { Cancelled, copyText, openUrl, PromptCard, StepIcon, type Prompt, type StepState } from '../setup/SetupWizard'
import { useUI } from '../../../store/ui'

/**
 * New project (/dev/new-project): one run creates a project from this codebase and makes it
 * something Claude.ai can work on. The server runs the starter kit, creates the GitHub repository,
 * gives it a deploy key and its secrets, adds DNS, gives the Claude GitHub app access, pushes `main`,
 * waits for the site, pushes `panel`, waits for the panel; this page shows each step and only stops
 * when it needs the owner (a password, a click in GitHub, a DNS record to replace).
 */

const STEPS: { id: NpStepId; label: string }[] = [
  { id: 'generate', label: 'Generate the copy (starter kit)' },
  { id: 'repo', label: 'Create the GitHub repository' },
  { id: 'secrets', label: 'Deploy key + Actions secrets' },
  { id: 'dns', label: 'DNS for the site and the panel' },
  { id: 'claude-app', label: 'Claude GitHub app access (Claude.ai)' },
  { id: 'push-main', label: 'Push main' },
  { id: 'deploy-site', label: 'Site deploy' },
  { id: 'push-panel', label: 'Push panel' },
  { id: 'deploy-panel', label: 'Panel deploy' },
  { id: 'finish', label: 'Ready for Claude' },
]
const POLL_MS = 8000
const WATCH_LIMIT_MS = 30 * 60_000
const CLAUDE_CODE_URL = 'https://claude.ai/code'

interface StepView { id: NpStepId; label: string; state: StepState; note: string }
interface LogLine { level: 'info' | 'ok' | 'warn' | 'error' | 'out'; text: string }

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e))

export function NewProjectPage() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const status = useNewProjectStatus()
  const s = status.data
  const [draft, setDraft] = useState<NpDraft & { adminPassword: string; copyHostinger: boolean }>({ name: '', slug: '', domain: '', repo: '', purpose: '', private: true, adminPassword: '', copyHostinger: true })
  const [touched, setTouched] = useState<{ slug: boolean; domain: boolean; repo: boolean }>({ slug: false, domain: false, repo: false })
  const [check, setCheck] = useState<NpCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [steps, setSteps] = useState<StepView[]>(() => STEPS.map((x) => ({ ...x, state: 'pending', note: '' })))
  const [log, setLog] = useState<LogLine[]>([])
  const [running, setRunning] = useState(false)
  const [prompt, setPromptState] = useState<Prompt | null>(null)
  const promptRef = useRef<Prompt | null>(null)
  const cancelRef = useRef(false)
  const [current, setCurrent] = useState<NpProject | null>(null)
  const [adminShown, setAdminShown] = useState<{ domain: string; password: string } | null>(null)
  const [finished, setFinished] = useState<{ project: NpProject; firstSession: string } | null>(null)
  const [copied, setCopied] = useState('')
  const logEnd = useRef<HTMLDivElement>(null)

  const setPrompt = (p: Prompt | null) => {
    promptRef.current = p
    setPromptState(p)
  }
  const set = (id: NpStepId, state: StepState, note = '') => setSteps((prev) => prev.map((x) => (x.id === id ? { ...x, state, note } : x)))
  const add = (level: LogLine['level'], text: string) => setLog((l) => [...l, { level, text }])
  useEffect(() => logEnd.current?.scrollIntoView({ block: 'nearest' }), [log])

  // Derived fields follow the name until the owner edits them; every change is re-checked by the server.
  const sentSlug = touched.slug ? draft.slug : ''
  const sentDomain = touched.domain ? draft.domain : ''
  const sentRepo = touched.repo ? draft.repo : ''
  const sent = useMemo(() => ({ name: draft.name, slug: sentSlug, domain: sentDomain, repo: sentRepo, purpose: draft.purpose, private: draft.private }), [draft.name, sentSlug, sentDomain, sentRepo, draft.purpose, draft.private])
  useEffect(() => {
    if (running || current) return
    if (draft.name.trim().length < 2) {
      setCheck(null)
      return
    }
    let stale = false
    setChecking(true)
    const t = setTimeout(() => {
      newProjectApi
        .check(sent)
        .then((c) => {
          if (stale) return
          setCheck(c)
          setDraft((d) => {
            const next = { ...d, slug: touched.slug ? d.slug : c.plan.slug, domain: touched.domain ? d.domain : c.plan.domain, repo: touched.repo ? d.repo : c.plan.repo }
            return next.slug === d.slug && next.domain === d.domain && next.repo === d.repo ? d : next
          })
        })
        .catch((e) => !stale && setCheck({ plan: { ...sent, slug: '', domain: '', repo: '', purpose: '', private: true } as NpCheck['plan'], problems: [errText(e)], warnings: [], repo: 'unknown', dnsManaged: false, zone: '' }))
        .finally(() => !stale && setChecking(false))
    }, 350)
    return () => {
      stale = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent, running, current])

  const askPassword = (message: string) =>
    new Promise<string | null>((resolve) => setPrompt({ kind: 'password', title: 'VPS password, once', body: message, placeholder: 'VPS password (not stored)', allowSkip: false, resolve: (v) => { setPrompt(null); resolve(v) } }))
  const askConfirm = (title: string, body: string, yes: string, no: string, link?: { href: string; label: string }) =>
    new Promise<boolean>((resolve) => setPrompt({ kind: 'confirm', title, body, yes, no, link, resolve: (v) => { setPrompt(null); resolve(v) } }))
  const wait = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const t0 = Date.now()
      const tick = () => (cancelRef.current ? reject(new Cancelled()) : Date.now() - t0 >= ms ? resolve() : setTimeout(tick, 250))
      tick()
    })

  /** One step until it is done, asking whenever the server says it needs the owner. */
  async function runStep(id: NpStepId, slug: string, base: Record<string, unknown>): Promise<NpResult> {
    const extra: Record<string, unknown> = {}
    const started = Date.now()
    set(id, 'running')
    for (;;) {
      if (cancelRef.current) throw new Cancelled()
      const r = await newProjectApi.run(id, { ...base, ...extra, slug })
      if (r.out) add('out', r.out)
      if (r.ok) {
        set(id, 'ok', r.note ?? '')
        add('ok', `${STEPS.find((x) => x.id === id)!.label}: ${r.note ?? 'done'}`)
        return r
      }
      if (r.needs?.kind === 'password') {
        set(id, 'waiting', 'needs the VPS password')
        const pw = await askPassword(r.needs.message)
        if (!pw) throw new Cancelled()
        extra.password = pw
        set(id, 'running')
        continue
      }
      if (r.needs?.kind === 'confirm-dns') {
        set(id, 'waiting', 'a record already exists')
        const yes = await askConfirm('Replace the DNS records?', r.needs.message, 'Replace them', 'Leave DNS alone')
        if (cancelRef.current) throw new Cancelled()
        Object.assign(extra, yes ? { force: true } : { skip: true })
        set(id, 'running')
        continue
      }
      if (r.needs?.kind === 'link') {
        set(id, 'waiting', 'needs you in GitHub')
        add('warn', r.needs.message)
        const done = await askConfirm('Give Claude access to the repository', r.needs.message, "I've given it access", 'Check again', { href: r.needs.url ?? s?.claudeAppUrl ?? '', label: 'Open the Claude GitHub app' })
        if (cancelRef.current) throw new Cancelled()
        extra.confirmed = done
        set(id, 'running')
        continue
      }
      // A deploy being watched.
      set(id, 'running', r.note ?? '')
      if (r.run?.status === 'completed' && r.run.conclusion !== 'success') {
        add('error', `${STEPS.find((x) => x.id === id)!.label}: ${r.note} — ${r.run.url}`)
        set(id, 'waiting', r.note ?? 'deploy failed')
        const again = await askConfirm('The deploy failed', `GitHub Actions reports "${r.run.conclusion}". A connection timeout to the VPS usually passes on a re-run; open the run to read the log.`, 'Re-run the failed jobs', 'Stop here', { href: r.run.url, label: 'Open the run' })
        if (!again || cancelRef.current) throw new Error(`${id}: deploy ${r.run.conclusion}`)
        extra.rerun = true
        set(id, 'running', 're-running')
        continue
      }
      delete extra.rerun
      if (Date.now() - started > WATCH_LIMIT_MS) throw new Error(`${id}: still not finished after 30 minutes; run the wizard again later to keep watching`)
      await wait(POLL_MS)
    }
  }

  async function start(resume?: NpProject) {
    cancelRef.current = false
    setRunning(true)
    setFinished(null)
    setLog([])
    const p0 = resume ?? null
    setCurrent(p0)
    setSteps(STEPS.map((x) => ({ ...x, state: p0?.steps[x.id]?.ok ? 'ok' : 'pending', note: p0?.steps[x.id]?.note ?? '' })))
    let slug = p0?.slug ?? ''
    try {
      for (const st of STEPS) {
        if (p0?.steps[st.id]?.ok && st.id !== 'finish') continue
        const body: Record<string, unknown> =
          st.id === 'generate' ? (p0 ? { name: p0.name, slug: p0.slug, domain: p0.domain, repo: p0.repo, purpose: p0.purpose, private: p0.private } : { ...sent, slug: draft.slug, domain: draft.domain, repo: draft.repo })
          : st.id === 'secrets' ? { adminPassword: draft.adminPassword, copyHostinger: draft.copyHostinger }
          : {}
        add('info', `${st.label}…`)
        const r = await runStep(st.id, slug, body)
        if (r.project) {
          slug = r.project.slug
          setCurrent(r.project)
        }
        if (r.adminPassword && r.project) setAdminShown({ domain: r.project.domain, password: r.adminPassword })
        if (st.id === 'finish' && r.project) setFinished({ project: r.project, firstSession: r.firstSession ?? '' })
      }
      notify('New project is live and ready for Claude', 'success')
    } catch (e) {
      if (e instanceof Cancelled) add('warn', 'Stopped. Resume it from the list below whenever you like.')
      else {
        add('error', errText(e))
        setSteps((prev) => prev.map((x) => (x.state === 'running' || x.state === 'waiting' ? { ...x, state: 'failed', note: errText(e).slice(0, 160) } : x)))
        notify('New project stopped on a problem: see the log', 'error')
      }
    }
    setPrompt(null)
    setRunning(false)
    qc.invalidateQueries({ queryKey: ['dev-new-project'] })
  }

  const stop = () => {
    cancelRef.current = true
    const p = promptRef.current
    setPrompt(null)
    if (p?.kind === 'confirm') p.resolve(false)
    else if (p?.kind === 'wait') p.resolve('cancel')
    else if (p) p.resolve(null)
  }
  const copy = async (what: string, text: string) => {
    if (await copyText(text)) {
      setCopied(what)
      setTimeout(() => setCopied(''), 1500)
    }
  }
  const reset = () => {
    setCurrent(null)
    setFinished(null)
    setLog([])
    setSteps(STEPS.map((x) => ({ ...x, state: 'pending', note: '' })))
    setDraft((d) => ({ ...d, name: '', slug: '', domain: '', repo: '', purpose: '', adminPassword: '' }))
    setTouched({ slug: false, domain: false, repo: false })
  }

  const gh = s?.github
  const scopesOk = !gh?.scopes || (gh.scopes.includes('repo') && gh.scopes.includes('workflow'))
  const ready: { key: string; ok: boolean; label: string; note: string }[] = s
    ? [
        { key: 'github', ok: gh!.hasToken && !gh!.error && scopesOk, label: 'GitHub token', note: !gh!.hasToken ? 'add one in GitHub manager → Settings' : gh!.error ? gh!.error : gh!.scopes ? `${gh!.login} · ${scopesOk ? 'repo + workflow' : `scopes ${gh!.scopes.join(', ') || 'none'}: needs repo and workflow`}` : `${gh!.login} · fine-grained: needs Administration, Contents, Secrets and Workflows (write)` },
        { key: 'vps', ok: s.vps.panelKey, label: 'VPS access', note: s.vps.panelKey ? `${s.vps.user}@${s.vps.host} with the panel key` : 'no panel key: the wizard will ask for the VPS password once' },
        { key: 'hostinger', ok: s.hostinger.hasToken, label: 'Hostinger DNS', note: s.hostinger.hasToken ? `zone ${s.hostinger.zone}` : 'no token: add DNS records by hand' },
        { key: 'source', ok: true, label: 'Source', note: `${s.source} (default branch, with kit/)` },
      ]
    : []
  const canStart = !!s && !running && !current && !!check && !check.problems.length && !checking && gh?.hasToken && draft.name.trim().length >= 2
  const inProgress = (s?.projects ?? []).filter((p) => !p.steps.finish?.ok)
  const done = (s?.projects ?? []).filter((p) => p.steps.finish?.ok)

  return (
    <div className="stack" style={{ gap: 14 }} data-np-page="">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="eyebrow">
            <FolderPlus size={11} /> New project
          </div>
          <h1 style={{ margin: 0 }}>Build a new project</h1>
          <p className="muted" style={{ margin: '6px 0 0', maxWidth: 760 }}>
            Creates a renamed copy of this codebase with its own CLAUDE.md and first-session prompt, a GitHub repository Claude.ai can open, deploy secrets, DNS, and a live site and developer panel on this VPS. It only stops when it needs you.
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn ghost sm" onClick={() => status.refetch()} disabled={status.isFetching} title="Check the tokens again">
            <RefreshCw size={13} className={status.isFetching ? 'spin' : ''} /> Re-check
          </button>
          {running ? (
            <button className="btn danger sm" onClick={stop} data-np-stop="">
              <Square size={13} /> Stop
            </button>
          ) : current ? (
            <button className="btn sm" onClick={reset} data-np-new="">
              <FolderPlus size={13} /> Another project
            </button>
          ) : (
            <button className="btn primary" onClick={() => void start()} disabled={!canStart} title={check?.problems.length ? 'Fix the form first' : ''} data-np-start="">
              <Rocket size={14} /> Build it
            </button>
          )}
        </div>
      </div>

      <div className="setup-grid">
        <section className="card stack" style={{ gap: 10 }} data-np-form="">
          <h3 style={{ margin: 0 }}>The project</h3>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small">Name</span>
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Acme Notes" disabled={running || !!current} data-np-field="name" autoFocus />
          </label>
          <div className="np-fields">
            <label className="stack" style={{ gap: 4 }}>
              <span className="small">Slug <span className="muted">(containers, paths)</span></span>
              <input className="input mono sm" value={draft.slug} onChange={(e) => { setTouched({ ...touched, slug: true }); setDraft({ ...draft, slug: e.target.value.toLowerCase() }) }} disabled={running || !!current} data-np-field="slug" />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <span className="small">Domain <span className="muted">(panel on dev.)</span></span>
              <input className="input mono sm" value={draft.domain} onChange={(e) => { setTouched({ ...touched, domain: true }); setDraft({ ...draft, domain: e.target.value.toLowerCase() }) }} disabled={running || !!current} data-np-field="domain" />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <span className="small">GitHub repository</span>
              <input className="input mono sm" value={draft.repo} onChange={(e) => { setTouched({ ...touched, repo: true }); setDraft({ ...draft, repo: e.target.value }) }} disabled={running || !!current} data-np-field="repo" />
            </label>
          </div>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small">What is it for? <span className="muted">(goes into its CLAUDE.md)</span></span>
            <input className="input sm" value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} placeholder="One sentence" disabled={running || !!current} data-np-field="purpose" />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small">First owner password <span className="muted">(blank: one is generated and shown once)</span></span>
            <input className="input sm" type="password" autoComplete="new-password" value={draft.adminPassword} onChange={(e) => setDraft({ ...draft, adminPassword: e.target.value })} placeholder="8+ characters, or leave blank" disabled={running || !!current} data-np-field="admin" />
          </label>
          <div className="stack" style={{ gap: 4 }}>
            <label className="checkbox small"><input type="checkbox" checked={draft.private} onChange={() => setDraft({ ...draft, private: !draft.private })} disabled={running || !!current} data-np-private="" /> Private repository</label>
            <label className="checkbox small"><input type="checkbox" checked={draft.copyHostinger} onChange={() => setDraft({ ...draft, copyHostinger: !draft.copyHostinger })} disabled={running || !!current || !s?.hostinger.hasToken} /> Give it the Hostinger token too (its panel can manage DNS)</label>
          </div>
          {draft.adminPassword && draft.adminPassword.length < 8 && <div className="dev-session-chip warn">The owner password needs 8 or more characters</div>}
          {check && !current && (
            <div className="stack" style={{ gap: 4 }} data-np-check={check.problems.length ? 'bad' : 'ok'}>
              {check.problems.map((p) => (
                <div key={p} className="np-msg bad" data-np-problem=""><X size={13} /> {p}</div>
              ))}
              {check.warnings.map((p) => (
                <div key={p} className="np-msg warn" data-np-warning="">{p}</div>
              ))}
              {!check.problems.length && <div className="np-msg ok"><Check size={13} /> {check.repo === 'free' ? `${check.plan.repo} is free` : `${check.plan.repo}`} · {check.plan.domain} · dev.{check.plan.domain}</div>}
            </div>
          )}
          {checking && <span className="muted small">Checking…</span>}
        </section>

        <section className="card stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>{current ? current.name : 'Steps'}</h3>
          {!current && s && (
            <ul className="setup-checklist" data-np-ready="">
              {ready.map((c) => (
                <li key={c.key} data-np-ready-item={c.key} data-ok={c.ok ? '1' : '0'}>
                  {c.ok ? <Check size={14} className="ok" /> : <Circle size={14} className="todo" />} <span>{c.label}</span> <span className="muted small">{c.note}</span>
                </li>
              ))}
            </ul>
          )}
          {status.error && <div className="dev-session-chip warn">{errText(status.error)}</div>}
          <ol className="setup-steps" data-np-steps="">
            {steps.map((st) => (
              <li key={st.id} data-step={st.id} data-state={st.state}>
                <StepIcon state={st.state} />
                <span className="setup-step-label">{st.label}</span>
                {st.note && <span className="muted small setup-step-note">{st.note}</span>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {prompt && <PromptCard prompt={prompt} />}

      {adminShown && (
        <section className="card stack setup-prompt" style={{ gap: 6 }} data-np-admin="">
          <h3 style={{ margin: 0 }}>Owner password for {adminShown.domain}</h3>
          <p className="muted small" style={{ margin: 0 }}>Sign in as <b>brett</b> with this password once the site is up. It is shown only now and is not stored by this panel.</p>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <code className="mono np-secret" data-np-admin-value="">{adminShown.password}</code>
            <button className="btn sm" onClick={() => void copy('admin', adminShown.password)}><Copy size={12} /> {copied === 'admin' ? 'Copied' : 'Copy'}</button>
            <button className="btn ghost sm" onClick={() => setAdminShown(null)}>I've saved it</button>
          </div>
        </section>
      )}

      {finished && (
        <section className="card stack" style={{ gap: 8 }} data-np-finished="">
          <div className="eyebrow"><Check size={11} /> Ready for Claude</div>
          <h3 style={{ margin: 0 }}>{finished.project.name} is live</h3>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => openUrl(finished.project.repoUrl || `https://github.com/${finished.project.repo}`)}><ExternalLink size={12} /> Repository</button>
            <button className="btn sm" onClick={() => openUrl(`https://${finished.project.domain}`)}><ExternalLink size={12} /> Site</button>
            <button className="btn sm" onClick={() => openUrl(`https://dev.${finished.project.domain}/dev`)}><ExternalLink size={12} /> Developer panel</button>
            <button className="btn primary sm" onClick={() => openUrl(CLAUDE_CODE_URL)} data-np-claude=""><ExternalLink size={12} /> Open Claude Code</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            In Claude Code, pick <b>{finished.project.repo}</b> (the Claude app can see it now), then paste this first-session prompt. It is also in the repository as docs/FIRST_SESSION.md.
          </p>
          {finished.firstSession && (
            <>
              <pre className="setup-out np-first" data-np-first-session="">{finished.firstSession}</pre>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => void copy('first', finished.firstSession)} data-np-copy-first=""><Copy size={12} /> {copied === 'first' ? 'Copied' : 'Copy the prompt'}</button>
                <button className="btn ghost sm" onClick={async () => { await newProjectApi.removeFiles(finished.project.slug); add('info', 'Local working copy removed') }} data-np-remove-files=""><Trash2 size={12} /> Remove the local copy</button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Log</h3>
        <div className="setup-log" data-np-log="">
          {log.length === 0 && <span className="muted small">Nothing yet. Fill in the name and press Build it.</span>}
          {log.map((l, i) => (l.level === 'out' ? <pre key={i} className="setup-out">{l.text}</pre> : <div key={i} className={`setup-line ${l.level}`}>{l.text}</div>))}
          <div ref={logEnd} />
        </div>
      </section>

      {(inProgress.length > 0 || done.length > 0) && (
        <section className="card stack" style={{ gap: 6 }} data-np-projects="">
          <h3 style={{ margin: 0 }}>Projects</h3>
          {[...inProgress, ...done].map((p) => {
            const n = STEPS.filter((x) => p.steps[x.id]?.ok).length
            return (
              <div key={p.slug} className="np-project" data-np-project={p.slug}>
                <div className="grow">
                  <b>{p.name}</b> <span className="muted small mono">{p.repo} · {p.domain}</span>
                  <div className="muted small">{p.steps.finish?.ok ? 'Live and ready for Claude' : `${n} of ${STEPS.length} steps done`}</div>
                </div>
                {!p.steps.finish?.ok && (
                  <button className="btn sm" disabled={running} onClick={() => void start(p)} data-np-resume={p.slug}><Play size={12} /> Resume</button>
                )}
                {p.steps.finish?.ok && (
                  <button className="btn ghost sm" onClick={() => openUrl(p.repoUrl || `https://github.com/${p.repo}`)}><ExternalLink size={12} /> Repo</button>
                )}
                <button
                  className="btn ghost sm"
                  disabled={running}
                  title="Forget it here and delete the local copy (the repository, DNS and secrets stay)"
                  onClick={async () => {
                    if (!window.confirm(`Forget ${p.name} in this panel? The GitHub repository, its secrets and DNS stay.`)) return
                    await newProjectApi.forget(p.slug)
                    if (current?.slug === p.slug) reset()
                    qc.invalidateQueries({ queryKey: ['dev-new-project'] })
                  }}
                  data-np-forget={p.slug}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
