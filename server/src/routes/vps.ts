import { Router, type Request } from 'express'
import express from 'express'
import { recordEvent, requireDev } from '../dev.js'
import { HttpError, num, str, wrap } from '../util.js'
import { getOps } from '../ops.js'
import { logActivity } from '../activity.js'
import { connect, execOn, jsonLines, profileById, q, sshBatch, sshExec, withSftp, type ExecResult } from '../vps/ssh.js'
import { getHostinger, hapi, publicHostinger, saveHostinger, vmPath } from '../vps/hostinger.js'

/**
 * The VPS manager: everything the owner can do to the server from the developer panel.
 * Hostinger-level actions go through the Hostinger API (token stored server-side); everything on
 * the machine itself (docker, files, firewall, services, sites) runs over SSH with the panel key.
 */
export const vpsRouter = Router()
vpsRouter.use(requireDev)

const SITES_DIR = process.env.XG_SITES_DIR || '/opt/sites'
const EXPORT_DIR = process.env.XG_EXPORT_DIR || '/root/docker-exports'
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,120}$/
const SUB_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

function log(req: Request, kind: string, summary: string, detail?: unknown) {
  recordEvent(req.devSession!.id, `vps.${kind}`, { summary, detail })
  logActivity({ userId: req.user!.id, kind: `vps.${kind}`, targetLabel: summary.slice(0, 120), ip: req.ip ?? '' })
}
const pid = (req: Request) => str(req.query.profile, 40) || getHostinger().profileId || undefined
const id = (v: unknown) => {
  const s = str(v, 120)
  if (!ID_RE.test(s)) throw new HttpError(400, 'Bad identifier')
  return s
}
const out = (r: ExecResult) => ({ ok: r.code === 0, code: r.code, stdout: r.stdout, stderr: r.stderr, ms: r.ms })

/* ---------- settings ---------- */

vpsRouter.get('/settings', (_req, res) => {
  const ops = getOps()
  res.json({ hostinger: publicHostinger(), profiles: ops.shell.profiles.map((p) => ({ id: p.id, name: p.name, host: p.host, user: p.user, port: p.port })), defaultProfile: ops.shell.defaultProfile, sitesDir: SITES_DIR, exportDir: EXPORT_DIR })
})

vpsRouter.put(
  '/settings',
  wrap((req, res) => {
    const h = saveHostinger(req.body ?? {})
    log(req, 'settings', `VPS manager settings saved (Hostinger token ${h.hasToken ? 'set' : 'not set'}, VM ${h.vmId ?? 'none'}, domain ${h.domain})`)
    res.json({ hostinger: h })
  }),
)

/* ---------- Hostinger API ---------- */

vpsRouter.get('/h/vms', wrap(async (_req, res) => res.json({ vms: await hapi('GET', '/vps/v1/virtual-machines') })))
vpsRouter.get('/h/vm', wrap(async (_req, res) => res.json({ vm: await hapi('GET', vmPath()) })))
vpsRouter.get('/h/vm/actions', wrap(async (_req, res) => res.json({ actions: await hapi('GET', vmPath('/actions')) })))
vpsRouter.get(
  '/h/vm/metrics',
  wrap(async (req, res) => {
    const to = new Date()
    const from = new Date(to.getTime() - num(req.query.hours, 24) * 3600_000)
    res.json({ metrics: await hapi('GET', vmPath(`/metrics?date_from=${encodeURIComponent(from.toISOString())}&date_to=${encodeURIComponent(to.toISOString())}`)) })
  }),
)
vpsRouter.post(
  '/h/vm/:action',
  wrap(async (req, res) => {
    const action = String(req.params.action)
    if (!['start', 'stop', 'restart'].includes(action)) throw new HttpError(400, 'Unknown action')
    const r = await hapi('POST', vmPath(`/${action}`))
    log(req, 'hostinger', `VPS ${action} requested through Hostinger`)
    res.json({ result: r })
  }),
)
vpsRouter.put(
  '/h/vm/root-password',
  wrap(async (req, res) => {
    const password = str(req.body?.password, 200)
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters')
    const r = await hapi('PUT', vmPath('/root-password'), { password })
    log(req, 'hostinger', 'VPS root password changed through Hostinger (remember to update the VPS_PASSWORD secret)')
    res.json({ result: r })
  }),
)
vpsRouter.put(
  '/h/vm/hostname',
  wrap(async (req, res) => {
    const hostname = str(req.body?.hostname, 253)
    if (!/^[a-z0-9.-]+$/i.test(hostname)) throw new HttpError(400, 'Bad hostname')
    res.json({ result: await hapi('PUT', vmPath('/hostname'), { hostname }) })
    log(req, 'hostinger', `VPS hostname set to ${hostname}`)
  }),
)
vpsRouter.get('/h/snapshot', wrap(async (_req, res) => res.json({ snapshot: await hapi('GET', vmPath('/snapshot')).catch(() => null) })))
vpsRouter.post('/h/snapshot', wrap(async (req, res) => { const r = await hapi('POST', vmPath('/snapshot')); log(req, 'hostinger', 'VPS snapshot requested'); res.json({ result: r }) }))
vpsRouter.delete('/h/snapshot', wrap(async (req, res) => { const r = await hapi('DELETE', vmPath('/snapshot')); log(req, 'hostinger', 'VPS snapshot deleted'); res.json({ result: r }) }))
vpsRouter.post('/h/snapshot/restore', wrap(async (req, res) => { const r = await hapi('POST', vmPath('/snapshot/restore')); log(req, 'hostinger', 'VPS snapshot RESTORE requested'); res.json({ result: r }) }))
vpsRouter.get('/h/backups', wrap(async (_req, res) => res.json({ backups: await hapi('GET', vmPath('/backups')) })))
vpsRouter.post('/h/backups/:bid/restore', wrap(async (req, res) => { const r = await hapi('POST', vmPath(`/backups/${num(req.params.bid)}/restore`)); log(req, 'hostinger', `VPS backup ${req.params.bid} RESTORE requested`); res.json({ result: r }) }))
vpsRouter.get('/h/firewalls', wrap(async (_req, res) => res.json({ firewalls: await hapi('GET', '/vps/v1/firewall') })))
vpsRouter.post('/h/firewalls', wrap(async (req, res) => { const r = await hapi('POST', '/vps/v1/firewall', { name: str(req.body?.name, 60) || 'xgallery' }); log(req, 'hostinger', 'Hostinger firewall created'); res.json({ firewall: r }) }))
vpsRouter.get('/h/firewalls/:fid', wrap(async (req, res) => res.json({ firewall: await hapi('GET', `/vps/v1/firewall/${num(req.params.fid)}`) })))
vpsRouter.post(
  '/h/firewalls/:fid/rules',
  wrap(async (req, res) => {
    const b = req.body ?? {}
    const rule = { protocol: str(b.protocol, 10) || 'TCP', port: str(b.port, 20) || '22', source: str(b.source, 20) || 'any', source_detail: str(b.source_detail, 60) || 'any' }
    const r = await hapi('POST', `/vps/v1/firewall/${num(req.params.fid)}/rules`, rule)
    log(req, 'hostinger', `Hostinger firewall rule added: ${rule.protocol} ${rule.port} from ${rule.source_detail}`)
    res.json({ rule: r })
  }),
)
vpsRouter.delete('/h/firewalls/:fid/rules/:rid', wrap(async (req, res) => { const r = await hapi('DELETE', `/vps/v1/firewall/${num(req.params.fid)}/rules/${num(req.params.rid)}`); log(req, 'hostinger', `Hostinger firewall rule ${req.params.rid} removed`); res.json({ result: r }) }))
vpsRouter.post(
  '/h/firewalls/:fid/:action',
  wrap(async (req, res) => {
    const action = String(req.params.action)
    if (!['activate', 'deactivate', 'sync'].includes(action)) throw new HttpError(400, 'Unknown action')
    const s = getHostinger()
    if (!s.vmId) throw new HttpError(400, 'Pick your VPS first')
    const r = await hapi('POST', `/vps/v1/firewall/${num(req.params.fid)}/${action}/${s.vmId}`)
    log(req, 'hostinger', `Hostinger firewall ${req.params.fid} ${action}d on VPS ${s.vmId}`)
    res.json({ result: r })
  }),
)
vpsRouter.get('/h/domains', wrap(async (_req, res) => res.json({ domains: await hapi('GET', '/domains/v1/portfolio') })))
vpsRouter.get('/h/dns', wrap(async (req, res) => res.json({ zone: await hapi('GET', `/dns/v1/zones/${str(req.query.domain, 253) || getHostinger().domain}`) })))
vpsRouter.put(
  '/h/dns',
  wrap(async (req, res) => {
    const domain = str(req.body?.domain, 253) || getHostinger().domain
    const records = Array.isArray(req.body?.records) ? (req.body.records as { name: string; type: string; ttl?: number; content: string }[]) : []
    if (!records.length) throw new HttpError(400, 'records is required')
    const groups = new Map<string, { name: string; type: string; ttl: number; records: { content: string }[] }>()
    for (const r of records) {
      const name = str(r.name, 253).toLowerCase() || '@'
      const type = str(r.type, 10).toUpperCase() || 'A'
      const key = `${name}|${type}`
      const g = groups.get(key) ?? { name, type, ttl: num(r.ttl, 300) || 300, records: [] }
      g.records.push({ content: str(r.content, 500) })
      groups.set(key, g)
    }
    const r = await hapi('PUT', `/dns/v1/zones/${domain}`, { overwrite: req.body?.overwrite !== false, zone: [...groups.values()] })
    log(req, 'dns', `DNS updated on ${domain}: ${[...groups.values()].map((g) => `${g.name} ${g.type} → ${g.records.map((x) => x.content).join(', ')}`).join('; ')}`)
    res.json({ result: r })
  }),
)
vpsRouter.delete(
  '/h/dns',
  wrap(async (req, res) => {
    const domain = str(req.body?.domain, 253) || getHostinger().domain
    const filters = Array.isArray(req.body?.filters) ? (req.body.filters as { name: string; type?: string }[]).map((f) => ({ name: str(f.name, 253), ...(f.type ? { type: str(f.type, 10).toUpperCase() } : {}) })) : []
    if (!filters.length) throw new HttpError(400, 'filters is required')
    const r = await hapi('DELETE', `/dns/v1/zones/${domain}`, { filters })
    log(req, 'dns', `DNS records removed on ${domain}: ${filters.map((f) => `${f.name} ${f.type ?? ''}`).join(', ')}`)
    res.json({ result: r })
  }),
)
vpsRouter.get('/h/docker', wrap(async (_req, res) => res.json({ projects: await hapi('GET', vmPath('/docker')) })))
vpsRouter.post(
  '/h/docker/:project/:action',
  wrap(async (req, res) => {
    const action = String(req.params.action)
    const project = id(req.params.project)
    if (!['start', 'stop', 'restart', 'update', 'delete'].includes(action)) throw new HttpError(400, 'Unknown action')
    const r = action === 'delete' ? await hapi('DELETE', vmPath(`/docker/${project}`)) : await hapi('POST', vmPath(`/docker/${project}/${action}`))
    log(req, 'hostinger', `Docker Manager project ${project}: ${action}`)
    res.json({ result: r })
  }),
)
/** Explorer: any Hostinger endpoint, for whatever the typed routes do not cover yet. */
vpsRouter.post(
  '/h/raw',
  wrap(async (req, res) => {
    const method = str(req.body?.method, 10).toUpperCase() || 'GET'
    const path = str(req.body?.path, 300)
    if (!path.startsWith('/')) throw new HttpError(400, 'path must start with /')
    const r = await hapi(method, path, req.body?.body)
    log(req, 'hostinger', `Hostinger API ${method} ${path}`)
    res.json({ result: r })
  }),
)

/* ---------- console & system (SSH) ---------- */

vpsRouter.post(
  '/exec',
  wrap(async (req, res) => {
    const command = str(req.body?.command, 4000)
    if (!command.trim()) throw new HttpError(400, 'command is required')
    const r = await sshExec(pid(req), command, { timeoutMs: Math.min(600_000, num(req.body?.timeout, 60) * 1000) })
    log(req, 'exec', `Ran: ${command.slice(0, 160)} (exit ${r.code})`, { command: command.slice(0, 1000), code: r.code, ms: r.ms })
    res.json(out(r))
  }),
)

vpsRouter.get(
  '/system',
  wrap(async (req, res) => {
    const r = await sshBatch(pid(req), {
      host: 'hostname; . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"; uname -r',
      uptime: 'uptime -p 2>/dev/null || uptime',
      load: 'cat /proc/loadavg',
      cpu: "nproc; grep -m1 'model name' /proc/cpuinfo | cut -d: -f2",
      mem: 'free -m | awk \'NR==2{print $2, $3, $7} NR==3{print $2, $3}\'',
      disk: 'df -P -x tmpfs -x devtmpfs -x overlay | awk \'NR>1{print $6"|"$2"|"$3"|"$4"|"$5}\'',
      docker: "docker version --format '{{.Server.Version}}' 2>/dev/null; docker ps -q | wc -l; docker ps -aq | wc -l",
      ufw: "ufw status 2>/dev/null | head -1 || echo 'ufw not installed'",
      fail2ban: "fail2ban-client status sshd 2>/dev/null | grep -E 'Currently banned|Total banned' | tr -s ' ' || echo 'fail2ban not running'",
      updates: "apt list --upgradable 2>/dev/null | grep -c upgradable || echo 0",
      reboot: 'test -f /var/run/reboot-required && echo yes || echo no',
      ports: "ss -tulpnH 2>/dev/null | awk '{print $1\"|\"$5\"|\"$7}' | sort -u | head -80",
      top: 'ps -eo pid,user,%cpu,%mem,etime,comm --sort=-%cpu | head -15',
      tools: 'for t in mosh-server claude node git tmux; do printf "%s=%s\\n" $t "$(command -v $t || echo -)"; done',
      tz: "timedatectl show -p Timezone --value 2>/dev/null; date -u +%FT%TZ",
      ip: "hostname -I 2>/dev/null | awk '{print $1}'",
    }, { timeoutMs: 20_000 })
    const g = (k: string) => (r[k]?.stdout ?? '').trim()
    const mem = g('mem').split('\n').map((l) => l.split(' ').map(Number))
    res.json({
      host: g('host').split('\n'),
      uptime: g('uptime'),
      load: g('load').split(' ').slice(0, 3).map(Number),
      cpu: { cores: Number(g('cpu').split('\n')[0]) || 0, model: (g('cpu').split('\n')[1] ?? '').trim() },
      mem: { totalMb: mem[0]?.[0] ?? 0, usedMb: mem[0]?.[1] ?? 0, availableMb: mem[0]?.[2] ?? 0, swapTotalMb: mem[1]?.[0] ?? 0, swapUsedMb: mem[1]?.[1] ?? 0 },
      disks: g('disk').split('\n').filter(Boolean).map((l) => { const [mount, size, used, avail, pct] = l.split('|'); return { mount, sizeKb: Number(size), usedKb: Number(used), availKb: Number(avail), pct: Number(String(pct).replace('%', '')) } }),
      docker: { version: g('docker').split('\n')[0] ?? '', running: Number(g('docker').split('\n')[1]) || 0, total: Number(g('docker').split('\n')[2]) || 0 },
      ufw: g('ufw'),
      fail2ban: g('fail2ban'),
      updates: Number(g('updates')) || 0,
      rebootRequired: g('reboot') === 'yes',
      ports: g('ports').split('\n').filter(Boolean).map((l) => { const [proto, addr, proc] = l.split('|'); return { proto, addr, proc: (proc ?? '').replace(/users:\(\("/, '').split('"')[0] } }),
      top: g('top').split('\n'),
      tools: Object.fromEntries(g('tools').split('\n').filter(Boolean).map((l) => l.split('='))),
      tz: g('tz').split('\n'),
      ip: g('ip'),
    })
  }),
)

/* ---------- docker ---------- */

interface PsRow {
  ID: string
  Names: string
  Image: string
  State: string
  Status: string
  Ports: string
  CreatedAt: string
  Size?: string
  Labels?: string
}

vpsRouter.get(
  '/docker/containers',
  wrap(async (req, res) => {
    const r = await sshBatch(pid(req), { ps: "docker ps -as --format '{{json .}}'", stats: "docker stats --no-stream --format '{{json .}}'" }, { timeoutMs: 30_000 })
    const stats = new Map(jsonLines<{ ID: string; CPUPerc: string; MemUsage: string; MemPerc: string; NetIO: string; BlockIO: string; PIDs: string }>(r.stats.stdout).map((s) => [s.ID.slice(0, 12), s]))
    const containers = jsonLines<PsRow>(r.ps.stdout).map((c) => {
      const s = stats.get(c.ID.slice(0, 12))
      const labels = Object.fromEntries((c.Labels ?? '').split(',').filter((x) => x.includes('=')).map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]))
      const host = Object.entries(labels).find(([k, v]) => /traefik\.http\.routers\..*\.rule/.test(k) && /Host\(/.test(v))?.[1]?.match(/Host\(`([^`]+)`\)/)?.[1] ?? ''
      return { id: c.ID, name: c.Names, image: c.Image, state: c.State, status: c.Status, ports: c.Ports, created: c.CreatedAt, size: c.Size ?? '', project: labels['com.docker.compose.project'] ?? '', service: labels['com.docker.compose.service'] ?? '', host, cpu: s?.CPUPerc ?? '', mem: s?.MemUsage ?? '', memPct: s?.MemPerc ?? '', net: s?.NetIO ?? '', block: s?.BlockIO ?? '', pids: s?.PIDs ?? '' }
    })
    res.json({ containers, error: r.ps.code !== 0 ? r.ps.stderr.trim() : null })
  }),
)

vpsRouter.get(
  '/docker/containers/:id',
  wrap(async (req, res) => {
    const cid = id(req.params.id)
    const r = await sshBatch(pid(req), { inspect: `docker inspect ${q(cid)}`, logs: `docker logs --tail 80 ${q(cid)} 2>&1`, top: `docker top ${q(cid)} 2>/dev/null | head -20` }, { timeoutMs: 20_000 })
    let inspect: unknown = null
    try {
      inspect = (JSON.parse(r.inspect.stdout) as unknown[])[0] ?? null
    } catch {
      /* ignore */
    }
    if (!inspect) throw new HttpError(404, r.inspect.stderr.trim() || 'Container not found')
    res.json({ inspect, logs: r.logs.stdout, top: r.top.stdout })
  }),
)

vpsRouter.get(
  '/docker/containers/:id/logs',
  wrap(async (req, res) => {
    const r = await sshExec(pid(req), `docker logs --tail ${Math.min(5000, num(req.query.tail, 300))} ${str(req.query.since, 40) ? `--since ${q(str(req.query.since, 40))}` : ''} ${q(id(req.params.id))} 2>&1`, { timeoutMs: 30_000, maxBytes: 4_000_000 })
    res.json({ logs: r.stdout, code: r.code })
  }),
)

vpsRouter.post(
  '/docker/containers/:id/exec',
  wrap(async (req, res) => {
    const cmd = str(req.body?.command, 2000)
    if (!cmd.trim()) throw new HttpError(400, 'command is required')
    const r = await sshExec(pid(req), `docker exec ${q(id(req.params.id))} sh -c ${q(cmd)} 2>&1`, { timeoutMs: 120_000 })
    log(req, 'docker', `Ran in container ${req.params.id}: ${cmd.slice(0, 120)} (exit ${r.code})`)
    res.json(out(r))
  }),
)

vpsRouter.post(
  '/docker/containers/:id/:action',
  wrap(async (req, res) => {
    const action = String(req.params.action)
    const cid = id(req.params.id)
    const map: Record<string, string> = { start: 'start', stop: 'stop', restart: 'restart', pause: 'pause', unpause: 'unpause', kill: 'kill', remove: 'rm -f' }
    if (!map[action]) throw new HttpError(400, 'Unknown action')
    const r = await sshExec(pid(req), `docker ${map[action]} ${q(cid)}`, { timeoutMs: 120_000 })
    log(req, 'docker', `Container ${cid}: ${action}${r.code === 0 ? '' : ' FAILED: ' + r.stderr.trim().slice(0, 200)}`)
    res.json(out(r))
  }),
)

vpsRouter.get('/docker/images', wrap(async (req, res) => { const r = await sshExec(pid(req), "docker images --format '{{json .}}'"); res.json({ images: jsonLines(r.stdout) }) }))
vpsRouter.post('/docker/images/pull', wrap(async (req, res) => { const ref = id(req.body?.ref); const r = await sshExec(pid(req), `docker pull ${q(ref)} 2>&1 | tail -5`, { timeoutMs: 600_000 }); log(req, 'docker', `Image pulled: ${ref}`); res.json(out(r)) }))
vpsRouter.delete('/docker/images/:id', wrap(async (req, res) => { const r = await sshExec(pid(req), `docker rmi ${q(id(req.params.id))} 2>&1`); log(req, 'docker', `Image removed: ${req.params.id}`); res.json(out(r)) }))
vpsRouter.get('/docker/volumes', wrap(async (req, res) => { const r = await sshExec(pid(req), "docker volume ls --format '{{json .}}'; echo ---; docker system df -v --format '{{json .}}' 2>/dev/null | head -c 200000"); const [vols, df] = r.stdout.split('---\n'); let sizes: Record<string, string> = {}; try { const d = JSON.parse(df ?? '{}') as { Volumes?: { Name: string; Size: string }[] }; sizes = Object.fromEntries((d.Volumes ?? []).map((v) => [v.Name, v.Size])) } catch { /* ignore */ } res.json({ volumes: jsonLines<{ Name: string; Driver: string; Mountpoint: string }>(vols).map((v) => ({ ...v, Size: sizes[v.Name] ?? '' })) }) }))
vpsRouter.delete('/docker/volumes/:name', wrap(async (req, res) => { const r = await sshExec(pid(req), `docker volume rm ${q(id(req.params.name))} 2>&1`); log(req, 'docker', `Volume removed: ${req.params.name}`); res.json(out(r)) }))
vpsRouter.get('/docker/networks', wrap(async (req, res) => { const r = await sshExec(pid(req), "docker network ls --format '{{json .}}'"); res.json({ networks: jsonLines(r.stdout) }) }))
vpsRouter.get('/docker/df', wrap(async (req, res) => { const r = await sshExec(pid(req), "docker system df --format '{{json .}}'"); res.json({ df: jsonLines(r.stdout) }) }))
vpsRouter.get('/docker/compose', wrap(async (req, res) => { const r = await sshExec(pid(req), 'docker compose ls --all --format json 2>/dev/null'); let projects: unknown[] = []; try { projects = JSON.parse(r.stdout || '[]') } catch { projects = [] } res.json({ projects }) }))
vpsRouter.post(
  '/docker/compose',
  wrap(async (req, res) => {
    const dir = str(req.body?.dir, 300)
    const action = str(req.body?.action, 20)
    const file = str(req.body?.file, 120)
    if (!dir.startsWith('/') || dir.includes('..')) throw new HttpError(400, 'Bad directory')
    const cmds: Record<string, string> = { up: 'up -d --remove-orphans', down: 'down', restart: 'restart', pull: 'pull', recreate: 'up -d --force-recreate --remove-orphans', build: 'up -d --build --remove-orphans', ps: 'ps', logs: 'logs --tail 200' }
    if (!cmds[action]) throw new HttpError(400, 'Unknown action')
    const r = await sshExec(pid(req), `cd ${q(dir)} && docker compose ${file ? `-f ${q(file)} ` : ''}${cmds[action]} 2>&1 | tail -80`, { timeoutMs: 900_000 })
    log(req, 'docker', `compose ${action} in ${dir}${r.code === 0 ? '' : ' FAILED'}`)
    res.json(out(r))
  }),
)
vpsRouter.post(
  '/docker/prune',
  wrap(async (req, res) => {
    const what = str(req.body?.what, 20)
    const cmds: Record<string, string> = { images: 'docker image prune -af', builder: 'docker builder prune -af', containers: 'docker container prune -f', volumes: 'docker volume prune -f', all: 'docker system prune -af' }
    if (!cmds[what]) throw new HttpError(400, 'Unknown prune target')
    const r = await sshExec(pid(req), `${cmds[what]} 2>&1 | tail -5`, { timeoutMs: 300_000 })
    log(req, 'docker', `Pruned ${what}: ${r.stdout.trim().split('\n').pop() ?? ''}`)
    res.json(out(r))
  }),
)

/* export / import */
vpsRouter.get(
  '/docker/exports',
  wrap(async (req, res) => {
    const r = await sshExec(pid(req), `mkdir -p ${EXPORT_DIR} && ls -l --time-style=+%s ${EXPORT_DIR} | awk 'NR>1{print $5"|"$6"|"$7}'`)
    res.json({ dir: EXPORT_DIR, files: r.stdout.split('\n').filter(Boolean).map((l) => { const [size, mtime, name] = l.split('|'); return { name, size: Number(size), mtime: Number(mtime) * 1000, path: `${EXPORT_DIR}/${name}` } }) })
  }),
)
vpsRouter.post(
  '/docker/export',
  wrap(async (req, res) => {
    const target = id(req.body?.id)
    const kind = str(req.body?.kind, 20) || 'container'
    const name = (str(req.body?.name, 80) || target).replace(/[^a-z0-9_.-]/gi, '_')
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const file = `${EXPORT_DIR}/${name}-${kind}-${stamp}.tar.gz`
    const cmd = kind === 'image' ? `docker save ${q(target)} | gzip > ${q(file)}` : kind === 'commit' ? `docker commit ${q(target)} ${q(`${name}:export`)} >/dev/null && docker save ${q(`${name}:export`)} | gzip > ${q(file)}` : `docker export ${q(target)} | gzip > ${q(file)}`
    const r = await sshExec(pid(req), `mkdir -p ${EXPORT_DIR} && ${cmd} && ls -l ${q(file)} | awk '{print $5}'`, { timeoutMs: 900_000 })
    log(req, 'docker', `${kind} exported: ${target} → ${file}${r.code === 0 ? ` (${r.stdout.trim()} bytes)` : ' FAILED'}`)
    res.json({ ...out(r), file, bytes: Number(r.stdout.trim()) || 0 })
  }),
)
vpsRouter.post(
  '/docker/import',
  wrap(async (req, res) => {
    const path = str(req.body?.path, 300)
    const kind = str(req.body?.kind, 20) || 'image'
    const name = str(req.body?.name, 120)
    if (!path.startsWith('/') || path.includes('..')) throw new HttpError(400, 'Bad path')
    const cmd = kind === 'image' ? `docker load -i ${q(path)} 2>&1` : `docker import ${q(path)} ${q(id(name || 'imported:latest'))} 2>&1`
    const r = await sshExec(pid(req), cmd, { timeoutMs: 900_000 })
    log(req, 'docker', `${kind} imported from ${path}${r.code === 0 ? '' : ' FAILED'}: ${r.stdout.trim().slice(0, 160)}`)
    res.json(out(r))
  }),
)
vpsRouter.delete('/docker/exports/:name', wrap(async (req, res) => { const name = str(req.params.name, 200).replace(/[^a-z0-9_.-]/gi, ''); const r = await sshExec(pid(req), `rm -f ${q(`${EXPORT_DIR}/${name}`)}`); res.json(out(r)) }))

/** Health tests for every container: state, health check, restarts, liveness, port probes, HTTP on its host rule. */
vpsRouter.post(
  '/docker/test',
  wrap(async (req, res) => {
    const p = profileById(pid(req))
    const c = await connect(p)
    const results: Record<string, unknown>[] = []
    try {
      const ps = jsonLines<PsRow>((await execOn(c, "docker ps -a --format '{{json .}}'")).stdout)
      for (const row of ps) {
        const checks: { name: string; ok: boolean; detail: string }[] = []
        let inspect: { State?: { Status?: string; Health?: { Status?: string; Log?: { ExitCode: number; Output: string }[] }; StartedAt?: string; OOMKilled?: boolean; ExitCode?: number }; RestartCount?: number; HostConfig?: { RestartPolicy?: { Name?: string } }; Config?: { Labels?: Record<string, string> }; NetworkSettings?: { Ports?: Record<string, { HostPort: string }[] | null> } } = {}
        try {
          inspect = (JSON.parse((await execOn(c, `docker inspect ${q(row.ID)}`)).stdout) as typeof inspect[])[0] ?? {}
        } catch {
          /* ignore */
        }
        const st = inspect.State ?? {}
        checks.push({ name: 'running', ok: st.Status === 'running', detail: `${st.Status ?? row.State}${st.ExitCode ? ` (exit ${st.ExitCode})` : ''}${st.OOMKilled ? ' OOM killed' : ''}` })
        if (st.Health) checks.push({ name: 'health check', ok: st.Health.Status === 'healthy', detail: `${st.Health.Status}${st.Health.Log?.length ? ': ' + String(st.Health.Log[st.Health.Log.length - 1].Output ?? '').trim().slice(0, 120) : ''}` })
        checks.push({ name: 'restarts', ok: (inspect.RestartCount ?? 0) < 3, detail: `${inspect.RestartCount ?? 0} restart(s), policy ${inspect.HostConfig?.RestartPolicy?.Name || 'none'}` })
        if (st.Status === 'running') {
          const live = await execOn(c, `docker exec ${q(row.ID)} sh -c 'echo ok' 2>&1 || docker exec ${q(row.ID)} /bin/true 2>&1 || echo NOSHELL`, { timeoutMs: 15_000 })
          checks.push({ name: 'exec', ok: /ok|^$/.test(live.stdout.trim()) && !/NOSHELL/.test(live.stdout), detail: /NOSHELL/.test(live.stdout) ? 'no shell in image (fine for scratch images)' : live.stdout.trim() || 'ok' })
          const ports = Object.entries(inspect.NetworkSettings?.Ports ?? {}).flatMap(([cp, hs]) => (hs ?? []).map((h) => ({ cp, hp: h.HostPort })))
          for (const { cp, hp } of ports.slice(0, 6)) {
            const probe = await execOn(c, `timeout 3 bash -c '</dev/tcp/127.0.0.1/${Number(hp)}' 2>/dev/null && echo open || echo closed`, { timeoutMs: 8_000 })
            checks.push({ name: `port ${hp}→${cp}`, ok: probe.stdout.includes('open'), detail: probe.stdout.trim() })
          }
          const host = Object.entries(inspect.Config?.Labels ?? {}).find(([k, v]) => /traefik\.http\.routers\..*\.rule/.test(k) && /Host\(/.test(v))?.[1]?.match(/Host\(`([^`]+)`\)/)?.[1]
          if (host) {
            const http = await execOn(c, `curl -sk -o /dev/null -w '%{http_code} %{time_total}' --max-time 8 ${q(`https://${host}/`)}`, { timeoutMs: 15_000 })
            const code = Number(http.stdout.split(' ')[0])
            checks.push({ name: `https://${host}`, ok: code >= 200 && code < 400, detail: http.stdout.trim() ? `HTTP ${http.stdout.trim().replace(' ', ' in ')}s` : 'no answer' })
          }
          const errs = await execOn(c, `docker logs --since 1h ${q(row.ID)} 2>&1 | grep -ciE 'error|fatal|panic|exception' || true`, { timeoutMs: 15_000 })
          const n = Number(errs.stdout.trim()) || 0
          checks.push({ name: 'log errors (1h)', ok: n < 20, detail: `${n} line(s) mentioning errors in the last hour` })
        }
        results.push({ id: row.ID, name: row.Names, image: row.Image, state: st.Status ?? row.State, startedAt: st.StartedAt ?? '', ok: checks.every((x) => x.ok), checks })
      }
    } finally {
      c.end()
    }
    const failing = results.filter((r) => !r.ok).length
    log(req, 'test', `Container tests: ${results.length} tested, ${failing} failing`, { failing: results.filter((r) => !r.ok).map((r) => r.name) })
    res.json({ results, tested: results.length, failing, at: Date.now() })
  }),
)

/* ---------- sites (subdomains) ---------- */

function siteCompose(sub: string, domain: string, kind: string, opts: { image?: string; port?: number; target?: number; env?: string }): string {
  const host = `${sub}.${domain}`
  const r = `site-${sub}`
  const labels = `    labels:
      traefik.enable: "true"
      traefik.docker.network: coolify
      traefik.http.routers.${r}-http.rule: Host(\`${host}\`)
      traefik.http.routers.${r}-http.entrypoints: http
      traefik.http.routers.${r}-http.middlewares: ${r}-redirect
      traefik.http.routers.${r}-http.service: ${r}
      traefik.http.routers.${r}-https.rule: Host(\`${host}\`)
      traefik.http.routers.${r}-https.entrypoints: https
      traefik.http.routers.${r}-https.tls: "true"
      traefik.http.routers.${r}-https.tls.certresolver: letsencrypt
      traefik.http.routers.${r}-https.service: ${r}
      traefik.http.services.${r}.loadbalancer.server.port: "${kind === 'image' ? opts.port ?? 80 : 80}"
      traefik.http.middlewares.${r}-redirect.redirectscheme.scheme: https
      traefik.http.middlewares.${r}-redirect.redirectscheme.permanent: "true"`
  const net = `    networks:
      - coolify
networks:
  coolify:
    external: true
`
  if (kind === 'static')
    return `# ${host}: static files served from ./public (edit them in VPS manager → Files)
services:
  web:
    image: nginx:alpine
    container_name: ${r}
    restart: unless-stopped
    volumes:
      - ./public:/usr/share/nginx/html:ro
${labels}
${net}`
  if (kind === 'proxy')
    return `# ${host}: reverse proxy to port ${opts.target} on the VPS itself
services:
  web:
    image: nginx:alpine
    container_name: ${r}
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
${labels}
${net}`
  return `# ${host}: container from image ${opts.image}
services:
  app:
    image: ${opts.image}
    container_name: ${r}
    restart: unless-stopped
${opts.env ? `    environment:\n${opts.env.split('\n').filter((l) => l.includes('=')).map((l) => `      ${l.split('=')[0].trim()}: ${JSON.stringify(l.slice(l.indexOf('=') + 1).trim())}`).join('\n')}\n` : ''}${labels}
${net}`
}

async function readSites(profileId: string | undefined) {
  const r = await sshBatch(profileId, { list: `mkdir -p ${SITES_DIR}; for d in ${SITES_DIR}/*/; do [ -f "$d/.xg-site.json" ] && cat "$d/.xg-site.json" && echo; done`, ps: "docker ps -a --filter name=site- --format '{{json .}}'" }, { timeoutMs: 20_000 })
  const running = new Map(jsonLines<PsRow>(r.ps.stdout).map((c) => [c.Names, c]))
  return jsonLines<{ sub: string; domain: string; kind: string; image?: string; port?: number; target?: number; createdAt: number }>(r.list.stdout).map((s) => ({ ...s, dir: `${SITES_DIR}/${s.sub}`, host: `${s.sub}.${s.domain}`, container: running.get(`site-${s.sub}`) ? { state: running.get(`site-${s.sub}`)!.State, status: running.get(`site-${s.sub}`)!.Status } : null }))
}

vpsRouter.get('/sites', wrap(async (req, res) => res.json({ sites: await readSites(pid(req)), domain: getHostinger().domain })))

vpsRouter.post(
  '/sites',
  wrap(async (req, res) => {
    const b = req.body ?? {}
    const sub = str(b.sub, 63).toLowerCase()
    if (!SUB_RE.test(sub)) throw new HttpError(400, 'Subdomain must be letters, digits and dashes')
    const domain = str(b.domain, 253) || getHostinger().domain
    const kind = ['static', 'proxy', 'image'].includes(b.kind) ? (b.kind as string) : 'static'
    const image = str(b.image, 200)
    const port = num(b.port, 80)
    const target = num(b.target, 3000)
    if (kind === 'image' && !ID_RE.test(image)) throw new HttpError(400, 'An image is required')
    const dir = `${SITES_DIR}/${sub}`
    const compose = siteCompose(sub, domain, kind, { image, port, target, env: str(b.env, 4000) })
    const meta = JSON.stringify({ sub, domain, kind, image: image || undefined, port: kind === 'image' ? port : undefined, target: kind === 'proxy' ? target : undefined, createdAt: Date.now() })
    const nginx = `server {\n  listen 80;\n  location / {\n    proxy_pass http://host.docker.internal:${target};\n    proxy_set_header Host $host;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto https;\n    proxy_http_version 1.1;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n  }\n}\n`
    const index = `<!doctype html><html><head><meta charset="utf-8"><title>${sub}.${domain}</title><style>body{font:16px system-ui;background:#14100b;color:#f3ede4;display:grid;place-items:center;min-height:100vh;margin:0}h1{color:#ff7a1a}</style></head><body><div><h1>${sub}.${domain}</h1><p>Created from the xGallery developer panel. Replace this file under ${dir}/public.</p></div></body></html>\n`
    const result = await withSftp(pid(req), async (sftp, client) => {
      const exists = await execOn(client, `test -d ${q(dir)} && echo yes || echo no`)
      if (exists.stdout.trim() === 'yes') throw new HttpError(409, `${dir} already exists`)
      await execOn(client, `mkdir -p ${q(`${dir}/public`)}`)
      const write = (file: string, content: string) => new Promise<void>((resolve, reject) => sftp.writeFile(file, content, (e) => (e ? reject(new HttpError(502, e.message)) : resolve())))
      await write(`${dir}/docker-compose.yml`, compose)
      await write(`${dir}/.xg-site.json`, meta)
      if (kind === 'static') await write(`${dir}/public/index.html`, index)
      if (kind === 'proxy') await write(`${dir}/nginx.conf`, nginx)
      const net = await execOn(client, 'docker network inspect coolify >/dev/null 2>&1 && echo yes || echo no')
      const up = net.stdout.trim() === 'yes' ? await execOn(client, `cd ${q(dir)} && docker compose -p ${q(`site-${sub}`)} up -d 2>&1 | tail -20`, { timeoutMs: 600_000 }) : { stdout: '', stderr: 'The coolify/Traefik network is not on this VPS: the site files were written but nothing was started.', code: 1, ms: 0 }
      return { up }
    })
    let dns: unknown = null
    let dnsError: string | null = null
    if (b.dns !== false && getHostinger().token) {
      try {
        const ip = str(b.ip, 60) || (await sshExec(pid(req), "hostname -I 2>/dev/null | awk '{print $1}'")).stdout.trim() || profileById(pid(req)).host
        dns = await hapi('PUT', `/dns/v1/zones/${domain}`, { overwrite: true, zone: [{ name: sub, type: 'A', ttl: 300, records: [{ content: ip }] }] })
      } catch (e) {
        dnsError = (e as Error).message
      }
    }
    log(req, 'site', `Site ${sub}.${domain} created (${kind}${kind === 'image' ? ` ${image}:${port}` : kind === 'proxy' ? ` → :${target}` : ''})${dnsError ? `; DNS failed: ${dnsError}` : dns ? '; DNS record set' : ''}`)
    res.status(201).json({ site: { sub, domain, kind, dir }, up: out(result.up), dns, dnsError })
  }),
)

vpsRouter.get(
  '/sites/check',
  wrap(async (req, res) => {
    const sites = await readSites(pid(req))
    const hosts = [getOps().domain, ...sites.map((s) => s.host)]
    const cmds = Object.fromEntries(hosts.map((h) => [h, `curl -sk -o /dev/null -w '%{http_code} %{time_total}' --max-time 8 ${q(`https://${h}/`)}; echo; echo | timeout 8 openssl s_client -servername ${q(h)} -connect ${q(`${h}:443`)} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null; getent hosts ${q(h)} | awk '{print $1}' | head -1`]))
    const r = await sshBatch(pid(req), cmds, { timeoutMs: 20_000 })
    res.json({ checks: hosts.map((h) => { const lines = (r[h]?.stdout ?? '').split('\n'); const [code, t] = (lines[0] ?? '').split(' '); return { host: h, http: Number(code) || 0, seconds: Number(t) || 0, certEnd: (lines.find((l) => l.startsWith('notAfter=')) ?? '').replace('notAfter=', ''), ip: lines.find((l) => /^\d+\.\d+\.\d+\.\d+$/.test(l.trim()))?.trim() ?? '' } }) })
  }),
)

vpsRouter.get(
  '/sites/:sub',
  wrap(async (req, res) => {
    const sub = str(req.params.sub, 63)
    if (!SUB_RE.test(sub)) throw new HttpError(400, 'Bad subdomain')
    const dir = `${SITES_DIR}/${sub}`
    const r = await sshBatch(pid(req), { compose: `cat ${q(`${dir}/docker-compose.yml`)}`, meta: `cat ${q(`${dir}/.xg-site.json`)}`, files: `ls -la ${q(`${dir}/public`)} 2>/dev/null | tail -n +2`, logs: `cd ${q(dir)} && docker compose logs --tail 60 2>&1` })
    if (r.meta.code !== 0) throw new HttpError(404, 'Site not found')
    res.json({ compose: r.compose.stdout, meta: JSON.parse(r.meta.stdout || '{}'), files: r.files.stdout, logs: r.logs.stdout, dir })
  }),
)

vpsRouter.put(
  '/sites/:sub',
  wrap(async (req, res) => {
    const sub = str(req.params.sub, 63)
    if (!SUB_RE.test(sub)) throw new HttpError(400, 'Bad subdomain')
    const compose = str(req.body?.compose, 60_000)
    const dir = `${SITES_DIR}/${sub}`
    const r = await withSftp(pid(req), async (sftp, client) => {
      await new Promise<void>((resolve, reject) => sftp.writeFile(`${dir}/docker-compose.yml`, compose, (e) => (e ? reject(new HttpError(502, e.message)) : resolve())))
      return execOn(client, `cd ${q(dir)} && docker compose -p ${q(`site-${sub}`)} up -d --remove-orphans 2>&1 | tail -20`, { timeoutMs: 600_000 })
    })
    log(req, 'site', `Site ${sub}: compose edited and re-applied${r.code === 0 ? '' : ' (FAILED)'}`)
    res.json(out(r))
  }),
)

vpsRouter.post(
  '/sites/:sub/:action',
  wrap(async (req, res) => {
    const sub = str(req.params.sub, 63)
    const action = String(req.params.action)
    if (!SUB_RE.test(sub)) throw new HttpError(400, 'Bad subdomain')
    const dir = `${SITES_DIR}/${sub}`
    const cmds: Record<string, string> = { up: 'up -d --remove-orphans', down: 'down', restart: 'restart', pull: 'pull && docker compose up -d', recreate: 'up -d --force-recreate' }
    let r: ExecResult
    if (action === 'remove') {
      r = await sshExec(pid(req), `cd ${q(dir)} && docker compose -p ${q(`site-${sub}`)} down -v 2>&1 | tail -5; cd / && rm -rf ${q(dir)} && echo removed`, { timeoutMs: 300_000 })
      if (req.query.dns === '1' && getHostinger().token) await hapi('DELETE', `/dns/v1/zones/${str(req.query.domain, 253) || getHostinger().domain}`, { filters: [{ name: sub, type: 'A' }] }).catch(() => null)
    } else {
      if (!cmds[action]) throw new HttpError(400, 'Unknown action')
      r = await sshExec(pid(req), `cd ${q(dir)} && docker compose -p ${q(`site-${sub}`)} ${cmds[action]} 2>&1 | tail -30`, { timeoutMs: 600_000 })
    }
    log(req, 'site', `Site ${sub}: ${action}${r.code === 0 ? '' : ' FAILED'}`)
    res.json(out(r))
  }),
)

/* ---------- files (SFTP) ---------- */

const safeRemote = (p: unknown) => {
  const s = str(p, 1000)
  if (!s.startsWith('/') || s.includes('\0')) throw new HttpError(400, 'Absolute path required')
  return s.replace(/\/+/g, '/')
}

vpsRouter.get(
  '/files',
  wrap(async (req, res) => {
    const path = safeRemote(req.query.path || '/')
    const entries = await withSftp(pid(req), (sftp) => new Promise<{ name: string; type: string; size: number; mtime: number; mode: string; target?: string }[]>((resolve, reject) => sftp.readdir(path, (e, list) => (e ? reject(new HttpError(e.message.includes('No such') ? 404 : 502, e.message)) : resolve(list.map((f) => ({ name: f.filename, type: f.longname.startsWith('d') ? 'dir' : f.longname.startsWith('l') ? 'link' : 'file', size: f.attrs.size, mtime: f.attrs.mtime * 1000, mode: (f.attrs.mode & 0o777).toString(8) })))))))
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
    res.json({ path, entries })
  }),
)
vpsRouter.get(
  '/files/read',
  wrap(async (req, res) => {
    const path = safeRemote(req.query.path)
    const data = await withSftp(pid(req), (sftp) => new Promise<Buffer>((resolve, reject) => sftp.readFile(path, (e, d) => (e ? reject(new HttpError(404, e.message)) : resolve(d)))))
    if (data.length > 2_000_000) throw new HttpError(413, 'File too large to edit here; download it instead')
    const binary = data.subarray(0, 4000).includes(0)
    res.json({ path, size: data.length, binary, content: binary ? '' : data.toString('utf8') })
  }),
)
vpsRouter.put(
  '/files/write',
  wrap(async (req, res) => {
    const path = safeRemote(req.body?.path)
    const content = typeof req.body?.content === 'string' ? req.body.content : ''
    await withSftp(pid(req), (sftp) => new Promise<void>((resolve, reject) => sftp.writeFile(path, content, (e: Error | null | undefined) => (e ? reject(new HttpError(502, e.message)) : resolve()))))
    log(req, 'file', `Wrote ${path} (${Buffer.byteLength(content)} bytes)`)
    res.json({ ok: true })
  }),
)
vpsRouter.post('/files/mkdir', wrap(async (req, res) => { const path = safeRemote(req.body?.path); const r = await sshExec(pid(req), `mkdir -p ${q(path)}`); log(req, 'file', `mkdir ${path}`); res.json(out(r)) }))
vpsRouter.post('/files/rename', wrap(async (req, res) => { const from = safeRemote(req.body?.from); const to = safeRemote(req.body?.to); const r = await sshExec(pid(req), `mv ${q(from)} ${q(to)}`); log(req, 'file', `Renamed ${from} → ${to}`); res.json(out(r)) }))
vpsRouter.post('/files/chmod', wrap(async (req, res) => { const path = safeRemote(req.body?.path); const mode = str(req.body?.mode, 4); if (!/^[0-7]{3,4}$/.test(mode)) throw new HttpError(400, 'Mode must be octal, e.g. 644'); const r = await sshExec(pid(req), `chmod ${mode} ${q(path)}`); log(req, 'file', `chmod ${mode} ${path}`); res.json(out(r)) }))
vpsRouter.delete(
  '/files',
  wrap(async (req, res) => {
    const path = safeRemote(req.query.path)
    if (['/', '/root', '/etc', '/var', '/usr', '/opt', '/home', '/data'].includes(path.replace(/\/$/, ''))) throw new HttpError(400, 'Refusing to delete a system directory')
    const r = await sshExec(pid(req), req.query.force === '1' ? `rm -rf ${q(path)}` : `rm ${q(path)} 2>&1 || rmdir ${q(path)} 2>&1`)
    log(req, 'file', `Deleted ${path}${req.query.force === '1' ? ' (recursive)' : ''}`)
    res.json(out(r))
  }),
)
vpsRouter.get(
  '/files/download',
  wrap(async (req, res) => {
    const path = safeRemote(req.query.path)
    const p = profileById(pid(req))
    const c = await connect(p)
    c.sftp((err, sftp) => {
      if (err) {
        c.end()
        res.status(502).json({ error: err.message })
        return
      }
      res.setHeader('Content-Disposition', `attachment; filename="${path.split('/').pop()}"`)
      res.setHeader('Content-Type', 'application/octet-stream')
      const s = sftp.createReadStream(path)
      s.on('error', (e: Error) => {
        if (!res.headersSent) res.status(404).json({ error: e.message })
        else res.end()
        c.end()
      })
      s.on('close', () => c.end())
      s.pipe(res)
    })
    log(req, 'file', `Downloaded ${path}`)
  }),
)
vpsRouter.post(
  '/files/upload',
  express.raw({ type: '*/*', limit: '512mb' }),
  wrap(async (req, res) => {
    let meta: { path?: string } = {}
    try {
      meta = JSON.parse(Buffer.from(String(req.headers['x-meta'] ?? ''), 'base64').toString('utf8'))
    } catch {
      /* ignore */
    }
    const path = safeRemote(meta.path)
    const body = req.body as Buffer
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Empty upload')
    await withSftp(pid(req), (sftp) => new Promise<void>((resolve, reject) => sftp.writeFile(path, body, (e) => (e ? reject(new HttpError(502, e.message)) : resolve()))))
    log(req, 'file', `Uploaded ${path} (${body.length} bytes)`)
    res.json({ ok: true, path, bytes: body.length })
  }),
)

/* ---------- firewall (ufw), services, journal, packages, cron, reboot ---------- */

vpsRouter.get('/ufw', wrap(async (req, res) => { const r = await sshExec(pid(req), 'ufw status numbered 2>&1'); res.json({ ...out(r), installed: !/not found|command not found/.test(r.stderr + r.stdout) }) }))
vpsRouter.post(
  '/ufw/rule',
  wrap(async (req, res) => {
    const rule = str(req.body?.rule, 120).trim()
    if (!/^(allow|deny|reject|limit) [a-z0-9:/ .,-]+( comment [a-z0-9 _-]+)?$/i.test(rule)) throw new HttpError(400, 'Rule must look like: allow 8080/tcp  or  deny from 1.2.3.4')
    const r = await sshExec(pid(req), `ufw ${rule} 2>&1`)
    log(req, 'firewall', `ufw ${rule}`)
    res.json(out(r))
  }),
)
vpsRouter.delete('/ufw/rule/:n', wrap(async (req, res) => { const n = num(req.params.n); if (n < 1) throw new HttpError(400, 'Bad rule number'); const r = await sshExec(pid(req), `yes | ufw delete ${n} 2>&1`); log(req, 'firewall', `ufw rule ${n} deleted`); res.json(out(r)) }))
vpsRouter.post('/ufw/:action', wrap(async (req, res) => { const a = String(req.params.action); if (!['enable', 'disable', 'reload'].includes(a)) throw new HttpError(400, 'Unknown action'); const r = await sshExec(pid(req), `ufw ${a === 'enable' ? '--force enable' : a} 2>&1`); log(req, 'firewall', `ufw ${a}`); res.json(out(r)) }))

vpsRouter.get('/services', wrap(async (req, res) => { const r = await sshExec(pid(req), "systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null | awk '{print $1\"|\"$2\"|\"$3\"|\"$4}'"); res.json({ services: r.stdout.split('\n').filter(Boolean).map((l) => { const [unit, load, active, sub] = l.split('|'); return { unit, load, active, sub } }) }) }))
vpsRouter.post('/services/:name/:action', wrap(async (req, res) => { const name = str(req.params.name, 120); const a = String(req.params.action); if (!/^[\w@.-]+$/.test(name) || !['start', 'stop', 'restart', 'enable', 'disable', 'status'].includes(a)) throw new HttpError(400, 'Bad request'); const r = await sshExec(pid(req), `systemctl ${a} ${q(name)} 2>&1 | head -30`, { timeoutMs: 120_000 }); if (a !== 'status') log(req, 'service', `systemctl ${a} ${name}`); res.json(out(r)) }))
vpsRouter.get('/journal', wrap(async (req, res) => { const unit = str(req.query.unit, 120); if (unit && !/^[\w@.-]+$/.test(unit)) throw new HttpError(400, 'Bad unit'); const r = await sshExec(pid(req), `journalctl ${unit ? `-u ${q(unit)} ` : ''}-n ${Math.min(2000, num(req.query.lines, 200))} --no-pager 2>&1`, { maxBytes: 4_000_000 }); res.json({ logs: r.stdout }) }))
vpsRouter.post('/apt/:action', wrap(async (req, res) => { const a = String(req.params.action); const cmds: Record<string, string> = { update: 'apt-get update -qq 2>&1 | tail -5; apt list --upgradable 2>/dev/null | tail -n +2', upgrade: 'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq 2>&1 | tail -20; test -f /var/run/reboot-required && echo REBOOT-REQUIRED || true', autoremove: 'apt-get autoremove -y -qq 2>&1 | tail -5' }; if (!cmds[a]) throw new HttpError(400, 'Unknown action'); const r = await sshExec(pid(req), cmds[a], { timeoutMs: 900_000 }); log(req, 'system', `apt ${a}`); res.json(out(r)) }))
vpsRouter.get('/cron', wrap(async (req, res) => { const r = await sshExec(pid(req), 'crontab -l 2>/dev/null; true'); res.json({ crontab: r.stdout }) }))
vpsRouter.put('/cron', wrap(async (req, res) => { const content = str(req.body?.content, 20_000); const r = await sshExec(pid(req), `printf '%s\\n' ${q(content)} | crontab - 2>&1 && crontab -l`); log(req, 'system', 'crontab replaced'); res.json(out(r)) }))
vpsRouter.post('/reboot', wrap(async (req, res) => { const r = await sshExec(pid(req), 'shutdown -r +0 "reboot from the xGallery developer panel" 2>&1', { timeoutMs: 10_000 }); log(req, 'system', 'VPS reboot requested over SSH'); res.json(out(r)) }))
