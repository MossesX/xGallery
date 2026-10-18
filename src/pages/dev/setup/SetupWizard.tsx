import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, Circle, CircleDashed, ExternalLink, KeyRound, Loader2, Play, RefreshCw, Smartphone, Sparkles, Square, Wand2, X } from 'lucide-react'
import { api, ApiError } from '../../../api/client'
import { useOps } from '../../../api/ops'
import { phonePublicKey, setupApi, useSetupStatus, type SetupStatus } from '../../../api/setup'
import { nativeAvailable } from '../../../terminal/transport'
import { TokenField } from '../../../components/TokenField'
import { checkToken, type TokenKind } from '../../../lib/tokenFormat'
import { useUI } from '../../../store/ui'

/**
 * One-click setup. A switch at the top of the developer panel (AutoSetupSwitch) arms it; the wizard
 * then walks every step on its own — panel key, phone key, VPS access, mosh + firewall, tmux,
 * Claude Code, Termux enrolment, Hostinger / GitHub / Claude tokens, final check — and only stops to
 * ask when it genuinely needs something from you (a password once, a token, an app to install).
 * Inside the Android app it drives the phone too: generates its key, opens F-Droid or Termux, polls
 * for the key Termux uploads, and installs it on the server.
 */

export type StepState = 'pending' | 'running' | 'ok' | 'skipped' | 'failed' | 'waiting'
interface StepView { id: string; label: string; state: StepState; note: string }
interface LogLine { t: number; level: 'info' | 'ok' | 'warn' | 'error' | 'out'; text: string }

export type Prompt =
  | { kind: 'password'; title: string; body: ReactNode; placeholder: string; allowSkip: boolean; resolve: (v: string | null) => void }
  | { kind: 'token'; title: string; body: ReactNode; placeholder: string; link?: { href: string; label: string }; allowSkip: boolean; check?: TokenKind; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; body: ReactNode; yes: string; no: string; link?: { href: string; label: string }; resolve: (v: boolean) => void }
  | { kind: 'wait'; title: string; body: ReactNode; script?: string; resolve: (v: 'skip' | 'cancel') => void }

interface Options { claudeCli: boolean; termux: boolean; hostinger: boolean; github: boolean; claudeSubscription: boolean; anthropicApi: boolean }

const STEPS: { id: string; label: string }[] = [
  { id: 'panel-key', label: 'Panel SSH key' },
  { id: 'phone-key', label: 'Phone SSH key (app)' },
  { id: 'vps-access', label: 'VPS access: install keys' },
  { id: 'mosh', label: 'mosh + firewall (UDP range)' },
  { id: 'tmux', label: 'tmux on the VPS' },
  { id: 'claude-cli', label: 'Claude Code on the VPS' },
  { id: 'termux', label: 'Termux on this phone (mosh client)' },
  { id: 'hostinger', label: 'Hostinger API token + VM' },
  { id: 'github', label: 'GitHub token + webhook' },
  { id: 'claude-subscription', label: 'Claude subscription token (assistant)' },
  { id: 'anthropic-api', label: 'Anthropic API key (assistant backup)' },
  { id: 'check', label: 'Final check' },
]

export class Cancelled extends Error {
  constructor() {
    super('Setup cancelled')
  }
}

export const openUrl = (url: string) => {
  const b = window.NativeSsh
  if (b?.openUrl && b.openUrl(url)) return
  window.open(url, '_blank', 'noopener')
}
export const copyText = async (text: string) => {
  const b = window.NativeSsh
  if (b?.copy && b.copy(text)) return true
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** The wizard page (/dev/setup). `?auto=1` starts the run as soon as the status has loaded. */
export function SetupPage() {
  const qc = useQueryClient()
  const notify = useUI((s) => s.notify)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [phonePub, setPhonePub] = useState(() => phonePublicKey())
  const status = useSetupStatus(true, phonePub)
  const ops = useOps()
  const [steps, setSteps] = useState<StepView[]>(() => STEPS.map((s) => ({ ...s, state: 'pending', note: '' })))
  const [log, setLog] = useState<LogLine[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState<null | { ok: number; failed: number; skipped: number }>(null)
  const [prompt, setPromptState] = useState<Prompt | null>(null)
  const promptRef = useRef<Prompt | null>(null)
  const setPrompt = (p: Prompt | null) => {
    promptRef.current = p
    setPromptState(p)
  }
  const closePrompt = () => setPrompt(null)
  const [opts, setOpts] = useState<Options>({ claudeCli: true, termux: nativeAvailable(), hostinger: true, github: true, claudeSubscription: true, anthropicApi: true })
  const optsTouched = useRef(false)
  const cancelRef = useRef(false)
  const autoStarted = useRef(false)
  const logEnd = useRef<HTMLDivElement>(null)

  // Defaults follow what is still missing; the user can still untick anything before the run.
  useEffect(() => {
    const s = status.data
    if (!s || optsTouched.current) return
    setOpts({ claudeCli: !(s.vps?.claude ?? false), termux: nativeAvailable() && !(s.termuxKey?.installed ?? false), hostinger: !s.hostinger, github: !s.github, claudeSubscription: !s.claudeSubscription, anthropicApi: !s.anthropicApi })
  }, [status.data])
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [log])

  const set = (id: string, state: StepState, note = '') => setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, state, note } : s)))
  const add = (level: LogLine['level'], text: string) => setLog((l) => [...l, { t: Date.now(), level, text }])
  const out = (text?: string) => text && add('out', text)

  const ask = <T,>(make: (resolve: (v: T) => void) => Prompt): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (cancelRef.current) return reject(new Cancelled())
      setPrompt(make((v) => { setPrompt(null); if (cancelRef.current) reject(new Cancelled()); else resolve(v) }))
    })
  const checkCancel = () => {
    if (cancelRef.current) throw new Cancelled()
  }
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  const runAll = async () => {
    if (running) return
    cancelRef.current = false
    setRunning(true)
    setDone(null)
    setLog([])
    setSteps(STEPS.map((s) => ({ ...s, state: 'pending', note: '' })))
    const counts = { ok: 0, failed: 0, skipped: 0 }
    let s: SetupStatus
    try {
      s = await setupApi.status(phonePub)
    } catch (e) {
      add('error', `Could not read the setup status: ${(e as Error).message}`)
      setRunning(false)
      return
    }
    const profile = s.profile
    add('info', `Setting up ${profile.user}@${profile.host}:${profile.port} (${profile.name})${s.vps ? ` · reachable as ${s.vps.user}` : s.panelKey ? ' · not reachable with the panel key yet' : ' · no panel key yet'}`)
    let pub = phonePub
    const repoFull = s.githubRepo || ops.data?.ops.repo || ''

    const step = async (id: string, fn: () => Promise<{ state?: StepState; note?: string } | void>) => {
      checkCancel()
      set(id, 'running')
      try {
        const r = (await fn()) ?? {}
        const st = r.state ?? 'ok'
        set(id, st, r.note ?? '')
        if (st === 'ok') counts.ok++
        else if (st === 'skipped') counts.skipped++
        else if (st === 'failed') counts.failed++
        if (st === 'ok') add('ok', `${STEPS.find((x) => x.id === id)?.label}: ${r.note || 'done'}`)
        else if (st === 'skipped') add('info', `${STEPS.find((x) => x.id === id)?.label}: skipped${r.note ? ` (${r.note})` : ''}`)
        else if (st === 'failed') add('error', `${STEPS.find((x) => x.id === id)?.label}: ${r.note || 'failed'}`)
      } catch (e) {
        if (e instanceof Cancelled) throw e
        counts.failed++
        set(id, 'failed', (e as Error).message)
        add('error', `${STEPS.find((x) => x.id === id)?.label}: ${(e as Error).message}`)
      }
    }
    const installKeys = async (): Promise<{ installed: string[]; keys: string[]; out: string }> => {
      try {
        const r = await setupApi.run({ step: 'install-keys', profile: profile.id, phonePub: pub || undefined })
        return { installed: r.installed ?? [], keys: r.keys ?? [], out: r.out ?? '' }
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) throw e
        add('warn', e.message)
        // The panel key is not on the server yet: one password, used for this one connection only.
        for (let attempt = 0; attempt < 3; attempt++) {
          const password = await ask<string | null>((resolve) => ({
            kind: 'password',
            title: `Root password for ${profile.user}@${profile.host}`,
            body: <>The server does not accept the panel key yet. Type the password <strong>once</strong>: it is used for this single connection to install the keys and is never stored. Afterwards every connection uses keys.</>,
            placeholder: 'server password',
            allowSkip: true,
            resolve,
          }))
          if (password == null) return { installed: [], keys: [], out: 'skipped: no password given' }
          try {
            const r = await setupApi.run({ step: 'install-keys', profile: profile.id, phonePub: pub || undefined, password })
            return { installed: r.installed ?? [], keys: r.keys ?? [], out: r.out ?? '' }
          } catch (e2) {
            if (!(e2 instanceof ApiError && (e2.status === 401 || e2.status === 502))) throw e2
            add('warn', `Password refused: ${e2.message}`)
          }
        }
        throw new Error('The server refused the password three times')
      }
    }

    try {
      await step('panel-key', async () => {
        const r = await setupApi.run({ step: 'panel-key' })
        return { note: r.created ? `generated · ${r.publicKey?.split(' ').slice(0, 2).join(' ').slice(-20)}` : 'already present' }
      })
      await step('phone-key', async () => {
        const b = window.NativeSsh
        if (!b) return { state: 'skipped', note: 'not inside the Android app' }
        if (b.hasStoredKey()) {
          pub = (b.publicKey() || '').trim()
          setPhonePub(pub)
          return { note: 'the phone already has a key' }
        }
        const r = b.generateKey()
        if (r.startsWith('error')) throw new Error(r)
        pub = r.trim()
        setPhonePub(pub)
        return { note: 'RSA key generated inside the app (it never leaves the phone)' }
      })
      await step('vps-access', async () => {
        const r = await installKeys()
        out(r.out)
        if (r.out.startsWith('skipped')) return { state: 'failed', note: 'no password: keys not installed' }
        return { note: r.installed.length ? `installed ${r.installed.join(', ')}` : `all keys already present (${r.keys.join(', ')})` }
      })
      await step('mosh', async () => {
        const r = await setupApi.run({ step: 'mosh', profile: profile.id, timeout: 300 })
        out(r.out)
        if (!r.ok) throw new Error(`exit ${r.code}`)
        return { note: r.out?.split('\n').find((l) => l.startsWith('ufw')) ?? 'installed' }
      })
      await step('tmux', async () => {
        const r = await setupApi.run({ step: 'tmux', profile: profile.id, timeout: 300 })
        out(r.out)
        if (!r.ok) throw new Error(`exit ${r.code}`)
        return { note: r.out?.trim().split('\n').slice(-1)[0] ?? 'ok' }
      })
      await step('claude-cli', async () => {
        if (s.vps?.claude) return { note: 'already installed' }
        if (!opts.claudeCli) return { state: 'skipped', note: 'unticked' }
        add('info', 'Installing Node 22 + Claude Code on the VPS (this can take a few minutes)…')
        const r = await setupApi.run({ step: 'claude', profile: profile.id, timeout: 900 })
        out(r.out)
        if (!r.ok) throw new Error(`exit ${r.code}`)
        return { note: r.out?.trim().split('\n').slice(-1)[0] ?? 'installed' }
      })
      await step('termux', async () => {
        const b = window.NativeSsh
        if (!b) return { state: 'skipped', note: 'not inside the Android app' }
        if (!opts.termux) return { state: 'skipped', note: 'unticked' }
        if (s.termuxKey?.installed) return { note: `Termux key already on the server (…${s.termuxKey.fingerprint})` }
        if (b.isInstalled && !b.isInstalled('com.termux')) {
          const ok = await ask<boolean>((resolve) => ({
            kind: 'confirm',
            title: 'Termux is not installed',
            body: <>Termux gives the phone a real mosh client. Install it from F-Droid (the Play Store build is outdated), open it once, then come back here and continue.</>,
            yes: 'Termux is installed, continue',
            no: 'Skip Termux',
            link: { href: 'https://f-droid.org/packages/com.termux/', label: 'Open F-Droid page' },
            resolve,
          }))
          if (!ok) return { state: 'skipped', note: 'Termux not installed' }
        }
        const startedAt = Date.now()
        const e = await setupApi.enrol({ origin: location.origin, profile: profile.id })
        const opened = b.openTermux(e.script)
        if (opened) add('info', 'Termux opened with the enrolment script (if Termux only opened to a prompt, allow external apps in ~/.termux/termux.properties and paste the script).')
        // Poll for the key Termux uploads; the prompt shows the script so it can be pasted by hand too.
        const waiter = ask<'skip' | 'cancel'>((resolve) => ({
          kind: 'wait',
          title: opened ? 'Waiting for Termux…' : 'Run this in Termux',
          body: opened ? <>Termux is generating a key and sending it here. This closes on its own when the key arrives (up to 15 minutes).</> : <>Could not hand the command to Termux directly. Copy the script, open Termux, paste it and press Enter; this closes on its own when the key arrives.</>,
          script: e.script,
          resolve,
        }))
        let enrolled = false
        const choice: { v: 'skip' | 'cancel' | null } = { v: null }
        void waiter.then((v) => (choice.v = v)).catch(() => (choice.v = 'cancel'))
        while (!enrolled && !choice.v && Date.now() < e.expiresAt) {
          await sleep(4000)
          checkCancel()
          try {
            const st = await setupApi.status(pub)
            if (st.termuxKey && st.termuxKey.enrolledAt >= startedAt) enrolled = true
          } catch {
            /* keep polling */
          }
        }
        if (!enrolled) {
          closePrompt()
          if (choice.v === 'cancel') throw new Cancelled()
          return { state: 'skipped', note: choice.v === 'skip' ? 'skipped while waiting' : 'Termux did not send a key within 15 minutes' }
        }
        closePrompt()
        add('ok', 'Termux key received; installing it on the server')
        const r = await installKeys()
        out(r.out)
        return { note: r.installed.includes('termux') ? 'Termux key installed on the server' : 'Termux key already on the server' }
      })
      await step('hostinger', async () => {
        if (s.hostinger && s.hostingerVm) return { note: 'token and VM already set' }
        if (!opts.hostinger) return { state: 'skipped', note: 'unticked' }
        if (!s.hostinger) {
          const token = await ask<string | null>((resolve) => ({
            kind: 'token',
            title: 'Hostinger API token',
            body: <>Lets the VPS manager (snapshots, firewall, DNS, reboot) talk to Hostinger. Create a token on the hPanel API page and paste it; it is stored on the server only and never shown again.</>,
            placeholder: 'Hostinger API token',
            link: { href: 'https://hpanel.hostinger.com/profile/api', label: 'Open hPanel → API' },
            allowSkip: true,
            resolve,
          }))
          if (!token) return { state: 'skipped', note: 'no token given' }
          await api.put('/api/dev/vps/settings', { token, profileId: profile.id })
          add('ok', 'Hostinger token saved on the server')
        }
        try {
          const r = await api.get<{ vms: unknown }>('/api/dev/vps/h/vms')
          const raw = r.vms as { id: number; hostname?: string; ipv4?: { address?: string }[] }[] | { data?: { id: number; hostname?: string; ipv4?: { address?: string }[] }[] }
          const vms = Array.isArray(raw) ? raw : (raw?.data ?? [])
          const pick = vms.length === 1 ? vms[0] : vms.find((v) => (v.ipv4 ?? []).some((a) => a.address === profile.host) || v.hostname === profile.host)
          if (pick) {
            await api.put('/api/dev/vps/settings', { vmId: pick.id, domain: s.domain || undefined })
            return { note: `VM ${pick.id}${pick.hostname ? ` (${pick.hostname})` : ''} selected` }
          }
          return { note: vms.length ? `${vms.length} VMs on the account: pick one in VPS manager → Settings` : 'token saved (no VMs listed)' }
        } catch (e) {
          return { state: 'failed', note: `token saved, but listing VMs failed: ${(e as Error).message}` }
        }
      })
      await step('github', async () => {
        if (!s.github) {
          if (!opts.github) return { state: 'skipped', note: 'unticked' }
          const token = await ask<string | null>((resolve) => ({
            kind: 'token',
            title: 'GitHub token',
            body: <>Lets the GitHub manager (and the phone app through it) see commits, deploys, issues and secrets for <span className="mono">{repoFull || 'the repository'}</span>. A fine-grained token with Read & write on Contents, Issues, Pull requests, Actions, Secrets, Variables and Webhooks, or a classic token with <span className="mono">repo, workflow, admin:repo_hook</span>.</>,
            placeholder: 'github_pat_… or ghp_…',
            link: { href: 'https://github.com/settings/personal-access-tokens/new', label: 'Create a token on GitHub' },
            allowSkip: true,
            resolve,
          }))
          if (!token) return { state: 'skipped', note: 'no token given' }
          const [owner, repo] = repoFull.split('/')
          await api.put('/api/dev/github/settings', { token, ...(owner && repo ? { owner, repo } : {}) })
          add('ok', 'GitHub token saved on the server')
        } else if (!opts.github) return { note: 'token already set' }
        try {
          const hooks = await api.get<{ hooks: { config?: { url?: string } }[]; webhookUrl: string }>('/api/dev/github/hooks')
          if (hooks.hooks.some((h) => h.config?.url === hooks.webhookUrl)) return { note: 'token set · webhook already installed' }
          await api.post('/api/dev/github/hooks/install', {})
          return { note: 'token set · webhook installed (live updates for every device)' }
        } catch (e) {
          return { state: 'failed', note: `token set, but the webhook could not be installed: ${(e as Error).message}` }
        }
      })
      await step('claude-subscription', async () => {
        if (s.claudeSubscription) return { note: 'already set' }
        if (!opts.claudeSubscription) return { state: 'skipped', note: 'unticked' }
        const token = await ask<string | null>((resolve) => ({
          kind: 'token',
          title: 'Claude subscription token',
          body: <>The assistant's main connection: turns run on your Claude plan through Claude Code, no API charges. On any machine with your subscription run <span className="mono">claude setup-token</span>, open the whole sign-in link it prints (it ends with <span className="mono">state=…</span>), approve, paste the code back into that terminal, then copy the <span className="mono">sk-ant-oat01-…</span> token it prints. Line breaks from the terminal are removed for you; Continue unlocks once the badge reads "Valid format".</>,
          placeholder: 'sk-ant-oat01-…',
          link: { href: 'https://claude.ai/settings', label: 'Claude account' },
          allowSkip: true,
          check: 'subscription',
          resolve,
        }))
        if (!token) return { state: 'skipped', note: 'no token given' }
        await api.put('/api/ai/settings', { subscriptionToken: token })
        return { note: 'subscription token saved' }
      })
      await step('anthropic-api', async () => {
        if (s.anthropicApi) return { note: 'already set' }
        if (!opts.anthropicApi) return { state: 'skipped', note: 'unticked' }
        const key = await ask<string | null>((resolve) => ({
          kind: 'token',
          title: 'Anthropic API key',
          body: <>The backup connection, used when the subscription is unavailable or rate-limited (billed per use on your Anthropic console account). Create a key at console.anthropic.com → API keys and paste it; it starts with <span className="mono">sk-ant-api03-</span>.</>,
          placeholder: 'sk-ant-api03-…',
          link: { href: 'https://console.anthropic.com/settings/keys', label: 'Anthropic console' },
          allowSkip: true,
          check: 'api',
          resolve,
        }))
        if (!key) return { state: 'skipped', note: 'no key given' }
        await api.put('/api/ai/settings', { apiKey: key })
        return { note: 'API key saved' }
      })
      await step('check', async () => {
        const r = await setupApi.run({ step: 'check', profile: profile.id, timeout: 60 })
        out(r.out)
        if (!r.ok) throw new Error(`exit ${r.code}`)
        await setupApi.complete()
        return { note: 'everything reachable' }
      })
    } catch (e) {
      if (e instanceof Cancelled) add('warn', 'Setup cancelled')
      else add('error', (e as Error).message)
    }
    setPrompt(null)
    setRunning(false)
    setDone(counts)
    qc.invalidateQueries({ queryKey: ['dev-setup-status'] })
    qc.invalidateQueries({ queryKey: ['dev-vps', '/settings'] })
    qc.invalidateQueries({ queryKey: ['gh', '/settings'] })
    qc.invalidateQueries({ queryKey: ['ai-settings'] })
    if (counts.failed === 0 && !cancelRef.current) notify('Setup finished', 'success')
    else if (!cancelRef.current) notify(`Setup finished with ${counts.failed} problem${counts.failed === 1 ? '' : 's'}`, 'error')
  }

  useEffect(() => {
    if (params.get('auto') === '1' && status.data && !autoStarted.current) {
      autoStarted.current = true
      navigate('/dev/setup', { replace: true })
      void runAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, status.data])

  const cancel = () => {
    cancelRef.current = true
    const p = promptRef.current
    setPrompt(null)
    if (p?.kind === 'wait') p.resolve('cancel')
    else if (p?.kind === 'confirm') p.resolve(false)
    else if (p) p.resolve(null)
  }
  const toggle = (k: keyof Options) => {
    optsTouched.current = true
    setOpts((o) => ({ ...o, [k]: !o[k] }))
  }
  const s = status.data
  const checklist = useMemo(() => (s ? summarise(s) : []), [s])

  return (
    <div className="stack" style={{ gap: 14 }} data-setup-page="">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="eyebrow">
            <Wand2 size={11} /> One-click setup
          </div>
          <h1 style={{ margin: 0 }}>Configure everything</h1>
          <p className="muted" style={{ margin: '6px 0 0', maxWidth: 720 }}>
            Keys, VPS access, mosh, Claude Code, Termux, Hostinger, GitHub and the assistant: one run does it all and only stops when it needs something only you have. Everything it does is logged on this developer session.
          </p>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn ghost sm" onClick={() => status.refetch()} disabled={status.isFetching} title="Probe the server again">
            <RefreshCw size={13} className={status.isFetching ? 'spin' : ''} /> Re-check
          </button>
          {running ? (
            <button className="btn danger sm" onClick={cancel} data-setup-cancel="">
              <Square size={13} /> Stop
            </button>
          ) : (
            <button className="btn primary" onClick={() => void runAll()} disabled={!s} data-setup-run="">
              <Play size={14} /> {done ? 'Run again' : s?.completedAt ? 'Run setup again' : 'Run setup'}
            </button>
          )}
        </div>
      </div>

      <div className="setup-grid">
        <section className="card stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>What is configured</h3>
          {status.isLoading && <p className="muted small" style={{ margin: 0 }}>Probing the server…</p>}
          {status.error && <div className="dev-session-chip warn">{(status.error as Error).message}</div>}
          {s && (
            <ul className="setup-checklist" data-setup-checklist="">
              {checklist.map((c) => (
                <li key={c.label} data-setup-item={c.key} data-ok={c.ok ? '1' : '0'}>
                  {c.ok ? <Check size={14} className="ok" /> : <Circle size={14} className="todo" />} <span>{c.label}</span> <span className="muted small">{c.note}</span>
                </li>
              ))}
            </ul>
          )}
          {s?.vpsError && <div className="dev-session-chip warn">VPS probe: {s.vpsError}</div>}
          {s && (
            <div className="muted small">
              Target {s.profile.user}@{s.profile.host}:{s.profile.port} · {nativeAvailable() ? 'running inside the Android app (phone steps on)' : 'running in a browser (phone steps are skipped; open this page in the Android app to set the phone up)'}
            </div>
          )}
          <h4 style={{ margin: '8px 0 0' }}>Optional parts</h4>
          <div className="stack" style={{ gap: 4 }}>
            <label className="checkbox small"><input type="checkbox" checked={opts.claudeCli} onChange={() => toggle('claudeCli')} disabled={running} /> Install Claude Code on the VPS</label>
            <label className="checkbox small"><input type="checkbox" checked={opts.termux} onChange={() => toggle('termux')} disabled={running || !nativeAvailable()} /> Set up Termux on this phone (mosh client)</label>
            <label className="checkbox small"><input type="checkbox" checked={opts.hostinger} onChange={() => toggle('hostinger')} disabled={running} /> Hostinger API token (asks for it)</label>
            <label className="checkbox small"><input type="checkbox" checked={opts.github} onChange={() => toggle('github')} disabled={running} /> GitHub token + webhook (asks for it)</label>
            <label className="checkbox small"><input type="checkbox" checked={opts.claudeSubscription} onChange={() => toggle('claudeSubscription')} disabled={running} /> Claude subscription token for the assistant (asks for it)</label>
            <label className="checkbox small"><input type="checkbox" checked={opts.anthropicApi} onChange={() => toggle('anthropicApi')} disabled={running} /> Anthropic API key as the assistant's backup (asks for it)</label>
          </div>
        </section>

        <section className="card stack" style={{ gap: 8 }}>
          <h3 style={{ margin: 0 }}>Steps</h3>
          <ol className="setup-steps" data-setup-steps="">
            {steps.map((st) => (
              <li key={st.id} data-step={st.id} data-state={st.state}>
                <StepIcon state={st.state} />
                <span className="setup-step-label">{st.label}</span>
                {st.note && <span className="muted small setup-step-note">{st.note}</span>}
              </li>
            ))}
          </ol>
          {done && (
            <div className={`dev-session-chip ${done.failed ? 'warn' : ''}`} data-setup-done="">
              {done.failed ? <X size={12} /> : <Check size={12} />} {done.ok} done · {done.skipped} skipped · {done.failed} failed
              {!done.failed && (
                <>
                  {' '}· <Link to="/dev/terminal">open a terminal</Link> · <Link to="/dev/shell">mosh</Link>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {prompt && <PromptCard prompt={prompt} />}

      <section className="card stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Log</h3>
        <div className="setup-log" data-setup-log="">
          {log.length === 0 && <span className="muted small">Nothing yet. Press Run setup.</span>}
          {log.map((l, i) => (l.level === 'out' ? <pre key={i} className="setup-out">{l.text}</pre> : <div key={i} className={`setup-line ${l.level}`}>{l.text}</div>))}
          <div ref={logEnd} />
        </div>
      </section>
    </div>
  )
}

export function StepIcon({ state }: { state: StepState }) {
  if (state === 'running' || state === 'waiting') return <Loader2 size={15} className="spin" />
  if (state === 'ok') return <Check size={15} className="ok" />
  if (state === 'failed') return <X size={15} className="fail" />
  if (state === 'skipped') return <CircleDashed size={15} className="muted" />
  return <Circle size={15} className="todo" />
}

export function PromptCard({ prompt }: { prompt: Prompt }) {
  const [value, setValue] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => setValue(''), [prompt])
  const link = 'link' in prompt && prompt.link ? (
    <button type="button" className="btn sm" onClick={() => openUrl(prompt.link!.href)} data-setup-open-link="">
      <ExternalLink size={12} /> {prompt.link.label}
    </button>
  ) : null
  return (
    <section className="card setup-prompt stack" style={{ gap: 10 }} data-setup-prompt={prompt.kind}>
      <div className="eyebrow">
        <KeyRound size={11} /> Needs you
      </div>
      <h3 style={{ margin: 0 }}>{prompt.title}</h3>
      <p className="muted small" style={{ margin: 0 }}>{prompt.body}</p>
      {prompt.kind === 'token' && prompt.check && (
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (checkToken(prompt.check!, value).state === 'ok') prompt.resolve(value) }} data-setup-token-form={prompt.check}>
          <TokenField kind={prompt.check} value={value} onChange={setValue} placeholder={prompt.placeholder} label={prompt.title} autoFocus testId={`setup-${prompt.check}`} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn primary sm" disabled={checkToken(prompt.check, value).state !== 'ok'} title={checkToken(prompt.check, value).state === 'bad' ? 'Fix the format first' : ''} data-setup-submit="">
              <ChevronRight size={13} /> Continue
            </button>
            {link}
            {prompt.allowSkip && (
              <button type="button" className="btn ghost sm" onClick={() => prompt.resolve(null)} data-setup-skip="">
                Skip
              </button>
            )}
          </div>
        </form>
      )}
      {(prompt.kind === 'password' || (prompt.kind === 'token' && !prompt.check)) && (
        <form className="row" style={{ gap: 6, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); if (value.trim()) prompt.resolve(value.trim()) }}>
          <input className="input sm grow mono" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={prompt.placeholder} aria-label={prompt.title} autoFocus data-setup-input="" />
          <button className="btn primary sm" disabled={!value.trim()} data-setup-submit="">
            <ChevronRight size={13} /> Continue
          </button>
          {link}
          {prompt.allowSkip && (
            <button type="button" className="btn ghost sm" onClick={() => prompt.resolve(null)} data-setup-skip="">
              Skip
            </button>
          )}
        </form>
      )}
      {prompt.kind === 'confirm' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {link}
          <button className="btn primary sm" onClick={() => prompt.resolve(true)} data-setup-yes="">
            <Check size={13} /> {prompt.yes}
          </button>
          <button className="btn ghost sm" onClick={() => prompt.resolve(false)} data-setup-no="">
            {prompt.no}
          </button>
        </div>
      )}
      {prompt.kind === 'wait' && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 6 }}>
            <Loader2 size={14} className="spin" /> <span className="small">Waiting…</span>
          </div>
          {prompt.script && (
            <>
              <pre className="setup-out" data-setup-script="">{prompt.script}</pre>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={async () => { setCopied(await copyText(prompt.script!)) }}>
                  {copied ? 'Copied' : 'Copy script'}
                </button>
                {window.NativeSsh?.openApp && (
                  <button className="btn sm" onClick={() => window.NativeSsh?.openApp?.('com.termux')}>
                    <Smartphone size={12} /> Open Termux
                  </button>
                )}
              </div>
            </>
          )}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn ghost sm" onClick={() => prompt.resolve('skip')} data-setup-skip="">
              Skip this step
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function summarise(s: SetupStatus): { key: string; label: string; ok: boolean; note: string }[] {
  const v = s.vps
  const inApp = nativeAvailable()
  return [
    { key: 'panel-key', label: 'Panel SSH key', ok: s.panelKey, note: s.panelKey ? '' : 'none yet' },
    { key: 'vps', label: 'VPS reachable with the panel key', ok: !!v?.reachable, note: v ? `${v.user}@${v.host} · ${v.privilege}` : s.vpsError ? 'not yet' : '' },
    { key: 'mosh', label: 'mosh server + UDP range open', ok: !!v?.mosh && (v?.udpOpen || v?.ufw?.includes('inactive') || v?.ufw === 'none'), note: v ? `${v.mosh ? 'mosh ok' : 'no mosh'} · ${v.ufw || 'no ufw'}${v.udpOpen ? ' · udp open' : ''}` : '' },
    { key: 'claude', label: 'Claude Code on the VPS', ok: !!v?.claude, note: v?.node ? `node ${v.node}` : '' },
    { key: 'phone', label: 'Phone key on the VPS', ok: v?.phoneKeyInstalled === true, note: !inApp ? 'open in the app' : v?.phoneKeyInstalled == null ? 'no key on the phone yet' : '' },
    { key: 'termux', label: 'Termux key on the VPS', ok: !!s.termuxKey?.installed, note: s.termuxKey ? `…${s.termuxKey.fingerprint}${s.termuxKey.installed ? '' : ' (not installed yet)'}` : inApp ? 'not enrolled' : 'open in the app' },
    { key: 'hostinger', label: 'Hostinger API', ok: s.hostinger, note: s.hostinger ? (s.hostingerVm ? 'token + VM' : 'token, no VM picked') : 'no token' },
    { key: 'github', label: 'GitHub manager', ok: s.github, note: s.github ? s.githubRepo : 'no token' },
    { key: 'claude-subscription', label: 'Claude subscription token (assistant)', ok: s.claudeSubscription, note: s.claudeSubscription ? '' : 'optional' },
    { key: 'anthropic-api', label: 'Anthropic API key (assistant backup)', ok: s.anthropicApi, note: s.anthropicApi ? '' : 'optional' },
  ]
}

const DISMISS_KEY = 'xg-setup-switch'

/**
 * The switch at the top of the developer panel. Shown once the setup status has loaded; flipping it
 * on sends the panel into the wizard and starts the run. Folds to a small chip once setup is complete.
 */
export function AutoSetupSwitch({ hidden }: { hidden?: boolean }) {
  const navigate = useNavigate()
  const [phonePub] = useState(() => phonePublicKey())
  const status = useSetupStatus(!hidden, phonePub)
  const [dismissed, setDismissed] = useState<string>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) ?? ''
    } catch {
      return ''
    }
  })
  if (hidden || !status.data) return null
  const s = status.data
  const list = summarise(s)
  const missing = list.filter((c) => !c.ok && c.key !== 'claude-subscription' && c.key !== 'anthropic-api' && !(!nativeAvailable() && (c.key === 'phone' || c.key === 'termux')))
  const complete = !!s.completedAt && missing.length === 0
  const stamp = `${s.completedAt ?? 0}:${missing.length}`
  if (dismissed === stamp) return null
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, stamp)
    } catch {
      /* ignore */
    }
    setDismissed(stamp)
  }
  return (
    <div className={`setup-switch ${complete ? 'complete' : ''}`} data-setup-switch={complete ? 'complete' : 'pending'}>
      <label className="switch" title="Run the one-click setup: keys, VPS, mosh, Claude Code, Termux, tokens">
        <input type="checkbox" checked={false} onChange={() => navigate('/dev/setup?auto=1')} data-setup-switch-toggle="" />
        <span className="switch-track" aria-hidden />
        <span className="switch-label">
          <Sparkles size={13} /> Auto setup
        </span>
      </label>
      <span className="small muted setup-switch-text">
        {complete ? `Everything is configured (${new Date(s.completedAt!).toLocaleDateString()}).` : missing.length ? `${missing.length} thing${missing.length === 1 ? '' : 's'} left: ${missing.slice(0, 3).map((m) => m.label.toLowerCase()).join(', ')}${missing.length > 3 ? '…' : ''}.` : 'Nothing missing; the run only re-checks.'}
        {' '}
        <Link to="/dev/setup">Details</Link>
      </span>
      <button className="btn ghost icon sm" onClick={dismiss} title="Hide until something changes" aria-label="Hide" data-setup-switch-dismiss="">
        <X size={13} />
      </button>
    </div>
  )
}
