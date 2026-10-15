import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { recordEvent, requireDev } from '../dev.js'
import { HttpError, num, str, wrap } from '../util.js'
import { getSetting, setSetting } from '../db.js'
import { getOps } from '../ops.js'
import { generateSshKey, getSshConfig, publicSshConfig } from '../terminal.js'
import { connect, execOn, profileById, q, sshBatch, type ExecResult } from '../vps/ssh.js'
import { publicHostinger } from '../vps/hostinger.js'
import { publicGithub } from '../github/client.js'
import { publicAiSettings } from '../ai/index.js'
import { logActivity } from '../activity.js'

/**
 * One-click setup. The wizard in the panel asks for the state of everything, then runs the steps
 * it can do by itself: keys, their installation on the VPS (with the root password typed once and
 * never stored), mosh and Claude Code on the VPS, and the enrolment of the phone's Termux key,
 * which Termux uploads to a public, single-use endpoint.
 */
export const setupRouter = Router()
setupRouter.use(requireDev)

interface SetupData {
  termuxKey: { pub: string; at: number; installed: boolean } | null
  enrol: { token: string; exp: number } | null
  completedAt: number | null
}
const data = () => ({ termuxKey: null, enrol: null, completedAt: null, ...getSetting<Partial<SetupData>>('devSetup', {}) }) as SetupData
const save = (patch: Partial<SetupData>) => setSetting('devSetup', { ...data(), ...patch })
const KEY_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]+( [^\n]{0,80})?$/
const lineFor = (pub: string) => pub.trim().split('\n')[0]

/** What is configured, as far as the server can tell quickly (SSH probes have short timeouts). */
setupRouter.get(
  '/status',
  wrap(async (req, res) => {
    const ssh = publicSshConfig()
    const ops = getOps()
    const profile = profileById(str(req.query.profile, 40) || undefined)
    const phonePub = str(req.query.phonePub, 1000)
    const d = data()
    const ai = publicAiSettings()
    const out: Record<string, unknown> = {
      panelKey: ssh.hasKey,
      panelPublicKey: ssh.publicKey,
      profile: { id: profile.id, name: profile.name, host: profile.host, user: profile.user, port: profile.port },
      domain: ops.domain,
      hostinger: publicHostinger().hasToken,
      hostingerVm: !!publicHostinger().vmId,
      github: publicGithub().hasToken,
      githubRepo: publicGithub().full,
      claudeToken: ai.hasSubscriptionToken || ai.hasApiKey,
      termuxKey: d.termuxKey ? { enrolledAt: d.termuxKey.at, installed: d.termuxKey.installed, fingerprint: d.termuxKey.pub.split(' ')[1]?.slice(-12) } : null,
      completedAt: d.completedAt,
      vps: null as unknown,
      vpsError: null as string | null,
    }
    if (ssh.hasKey) {
      try {
        const r = await sshBatch(
          profile.id,
          {
            ok: 'echo ok; whoami; hostname',
            mosh: 'command -v mosh-server || echo -',
            claude: 'command -v claude || echo -',
            node: 'node --version 2>/dev/null || echo -',
            docker: 'docker ps -q 2>/dev/null | wc -l; command -v docker || echo -',
            ufw: 'ufw status 2>/dev/null | head -1 || echo none',
            udp: `ufw status 2>/dev/null | grep -c '${profile.udpFrom}:${profile.udpTo}/udp' || echo 0`,
            keys: 'cat ~/.ssh/authorized_keys 2>/dev/null | grep -v "^#" | grep -c . || echo 0',
            phone: phonePub ? `grep -qF ${q(lineFor(phonePub).split(' ').slice(0, 2).join(' '))} ~/.ssh/authorized_keys 2>/dev/null && echo yes || echo no` : 'echo n/a',
            termux: d.termuxKey ? `grep -qF ${q(lineFor(d.termuxKey.pub).split(' ').slice(0, 2).join(' '))} ~/.ssh/authorized_keys 2>/dev/null && echo yes || echo no` : 'echo n/a',
            sudo: 'test "$(id -u)" = 0 && echo root || (sudo -n true 2>/dev/null && echo sudo || echo no)',
          },
          { timeoutMs: 12_000 },
        )
        const g = (k: string) => (r[k]?.stdout ?? '').trim()
        out.vps = {
          reachable: g('ok').startsWith('ok'),
          user: g('ok').split('\n')[1] ?? '',
          host: g('ok').split('\n')[2] ?? '',
          mosh: g('mosh') !== '-' && g('mosh') !== '',
          claude: g('claude') !== '-' && g('claude') !== '',
          node: g('node') !== '-' ? g('node') : null,
          docker: g('docker').split('\n')[1] !== '-',
          containers: Number(g('docker').split('\n')[0]) || 0,
          ufw: g('ufw'),
          udpOpen: Number(g('udp')) > 0,
          authorizedKeys: Number(g('keys')) || 0,
          phoneKeyInstalled: g('phone') === 'yes' ? true : g('phone') === 'no' ? false : null,
          termuxKeyInstalled: g('termux') === 'yes' ? true : g('termux') === 'no' ? false : null,
          privilege: g('sudo'),
        }
        if (d.termuxKey && g('termux') === 'yes' && !d.termuxKey.installed) save({ termuxKey: { ...d.termuxKey, installed: true } })
      } catch (e) {
        out.vpsError = (e as Error).message
      }
    }
    res.json(out)
  }),
)

/* ---------- steps ---------- */

const summarise = (r: ExecResult) => ({ ok: r.code === 0, code: r.code, out: `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim().slice(-4000) })

setupRouter.post(
  '/run',
  wrap(async (req, res) => {
    const step = str(req.body?.step, 40)
    const profile = profileById(str(req.body?.profile, 40) || undefined)
    const log = (summary: string, detail?: unknown) => {
      recordEvent(req.devSession!.id, `setup.${step}`, { summary, detail })
      logActivity({ userId: req.user!.id, kind: `setup.${step}`, targetLabel: summary.slice(0, 120), ip: req.ip ?? '' })
    }
    if (step === 'panel-key') {
      const cfg = getSshConfig()
      const ssh = cfg.privateKey ? publicSshConfig() : generateSshKey()
      log(cfg.privateKey ? 'Panel key already present' : 'Panel SSH key generated')
      res.json({ ok: true, publicKey: ssh.publicKey, created: !cfg.privateKey })
      return
    }
    if (step === 'install-keys') {
      // Append every public key we know about (panel, phone, Termux) to authorized_keys, once each.
      const password = typeof req.body?.password === 'string' ? req.body.password : ''
      const keys: { label: string; pub: string }[] = []
      const cfg = getSshConfig()
      if (cfg.publicKey) keys.push({ label: 'panel', pub: lineFor(cfg.publicKey) })
      const phonePub = str(req.body?.phonePub, 1000)
      if (phonePub && KEY_RE.test(lineFor(phonePub))) keys.push({ label: 'phone', pub: lineFor(phonePub) })
      const d = data()
      if (d.termuxKey && KEY_RE.test(lineFor(d.termuxKey.pub))) keys.push({ label: 'termux', pub: lineFor(d.termuxKey.pub) })
      if (!keys.length) throw new HttpError(400, 'No public key to install yet')
      let client
      try {
        client = await connect(profile, password || undefined)
      } catch (e) {
        if (!password && cfg.privateKey) throw new HttpError(401, `The panel key is not accepted by ${profile.host} yet: type the root password once so it can be installed (${(e as Error).message})`)
        throw e
      }
      try {
        const script = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys\n${keys.map((k) => `grep -qF ${q(k.pub.split(' ').slice(0, 2).join(' '))} ~/.ssh/authorized_keys && echo "${k.label}: already" || { echo ${q(k.pub)} >> ~/.ssh/authorized_keys; echo "${k.label}: installed"; }`).join('\n')}\nwc -l < ~/.ssh/authorized_keys`
        const r = await execOn(client, script, { timeoutMs: 20_000 })
        const installed = keys.filter((k) => r.stdout.includes(`${k.label}: installed`)).map((k) => k.label)
        if (d.termuxKey && r.stdout.includes('termux:')) save({ termuxKey: { ...d.termuxKey, installed: true } })
        log(`Keys installed on ${profile.user}@${profile.host}: ${installed.join(', ') || 'none new'} (${password ? 'password' : 'key'} session)`, { installed, keys: keys.map((k) => k.label) })
        res.json({ ...summarise(r), installed, keys: keys.map((k) => k.label) })
      } finally {
        client.end()
      }
      return
    }
    const sudo = `$(test "$(id -u)" = 0 || echo sudo)`
    const scripts: Record<string, string> = {
      mosh: `command -v mosh-server >/dev/null && echo "mosh: already installed" || { export DEBIAN_FRONTEND=noninteractive; ${sudo} apt-get update -qq && ${sudo} apt-get install -y -qq mosh && echo "mosh: installed"; }
if ${sudo} ufw status 2>/dev/null | grep -q "Status: active"; then ${sudo} ufw allow ${profile.udpFrom}:${profile.udpTo}/udp >/dev/null && echo "ufw: udp ${profile.udpFrom}:${profile.udpTo} allowed"; else echo "ufw: not active (nothing to open)"; fi
command -v mosh-server && mosh-server --version 2>&1 | head -1`,
      claude: `command -v claude >/dev/null && { echo "claude: already installed"; claude --version; exit 0; }
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 18 ]; then curl -fsSL https://deb.nodesource.com/setup_22.x | ${sudo} bash - && ${sudo} apt-get install -y -qq nodejs; fi
${sudo} npm install -g @anthropic-ai/claude-code && echo "claude: installed" && claude --version`,
      tmux: `command -v tmux >/dev/null && echo "tmux: already installed" || { export DEBIAN_FRONTEND=noninteractive; ${sudo} apt-get install -y -qq tmux && echo "tmux: installed"; }`,
      check: `echo "host: $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}'))"; echo "user: $(whoami)"; echo "docker: $(docker ps -q 2>/dev/null | wc -l) containers"; echo "mosh: $(command -v mosh-server || echo missing)"; echo "claude: $(command -v claude || echo missing)"; echo "keys: $(grep -c . ~/.ssh/authorized_keys 2>/dev/null || echo 0)"`,
    }
    if (!scripts[step]) throw new HttpError(400, 'Unknown step')
    const client = await connect(profile)
    try {
      const r = await execOn(client, scripts[step], { timeoutMs: Math.min(900_000, num(req.body?.timeout, 600) * 1000) })
      log(`${step} on ${profile.host}: ${r.code === 0 ? 'ok' : 'FAILED'} — ${r.stdout.trim().split('\n').slice(-1)[0] ?? ''}`)
      res.json(summarise(r))
    } finally {
      client.end()
    }
  }),
)

/* ---------- Termux enrolment ---------- */

/** A single-use token and the script Termux runs: it makes a key and uploads the public half here. */
setupRouter.post(
  '/enrol',
  wrap((req, res) => {
    const token = randomBytes(18).toString('base64url')
    save({ enrol: { token, exp: Date.now() + 15 * 60_000 } })
    const ops = getOps()
    const origin = str(req.body?.origin, 200) || `https://${ops.domain}`
    const profile = profileById(str(req.body?.profile, 40) || undefined)
    const script = [
      'pkg update -y >/dev/null 2>&1; pkg install -y openssh mosh curl >/dev/null 2>&1',
      'mkdir -p ~/.ssh && chmod 700 ~/.ssh',
      '[ -f ~/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N "" -C termux-xgallery -f ~/.ssh/id_ed25519 >/dev/null',
      `KEY="$(cat ~/.ssh/id_ed25519.pub)"`,
      `curl -sS -X POST -H 'Content-Type: application/json' --data "{\\"token\\":\\"${token}\\",\\"key\\":\\"$KEY\\"}" ${origin}/api/setup/termux-key && echo && echo "ENROLLED: the panel will install this key on the server"`,
      `printf 'Host vps\\n  HostName ${profile.host}\\n  User ${profile.user}\\n  Port ${profile.port}\\n  IdentityFile ~/.ssh/id_ed25519\\n  ServerAliveInterval 30\\n' > ~/.ssh/config`,
      `echo "Then connect with:  mosh --ssh='ssh -p ${profile.port}' -p ${profile.udpFrom}:${profile.udpTo} ${profile.user}@${profile.host}"`,
    ].join('\n')
    recordEvent(req.devSession!.id, 'setup.enrol', { summary: 'Termux enrolment token issued (15 min)' })
    res.json({ token, script, expiresAt: Date.now() + 15 * 60_000 })
  }),
)

/** Public endpoint Termux posts the key to; the token is single use and short lived. */
export const setupPublicRouter = Router()
setupPublicRouter.post(
  '/termux-key',
  wrap((req, res) => {
    const d = data()
    const token = str(req.body?.token, 60)
    const key = str(req.body?.key, 1000)
    if (!d.enrol || d.enrol.token !== token || d.enrol.exp < Date.now()) throw new HttpError(401, 'Enrolment token is missing, wrong or expired: start again from the panel')
    if (!KEY_RE.test(lineFor(key))) throw new HttpError(400, 'That does not look like an OpenSSH public key')
    save({ termuxKey: { pub: lineFor(key), at: Date.now(), installed: false }, enrol: null })
    logActivity({ userId: null, kind: 'setup.termux_key', targetLabel: lineFor(key).split(' ')[1]?.slice(-12) ?? '', ip: req.ip ?? '' })
    res.json({ ok: true, message: 'Key received. Continue in the panel: it installs the key on the server.' })
  }),
)

setupRouter.post('/complete', (req, res) => {
  save({ completedAt: Date.now() })
  recordEvent(req.devSession!.id, 'setup.complete', { summary: 'Auto setup finished' })
  res.json({ ok: true })
})
setupRouter.delete('/termux-key', (req, res) => {
  save({ termuxKey: null })
  recordEvent(req.devSession!.id, 'setup.termux', { summary: 'Termux key forgotten' })
  res.json({ ok: true })
})
