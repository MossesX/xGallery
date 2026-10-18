#!/usr/bin/env node
/**
 * Create a new project from xGallery.
 *
 *   node kit/new-project.mjs --name "Acme Notes" --domain notes.amberxai.com \
 *     --repo MossesX/acme-notes --out ../acme-notes [--slug acme-notes] \
 *     [--purpose "One sentence on what it is for"] [--no-git] [--dry-run]
 *
 * Copies every tracked file of this repository into --out, renames every xGallery identifier
 * (display name, slug used for containers / volumes / Traefik routers / /opt paths / the CSRF
 * header, domain, panel domain, GitHub repo, GHCR image, Android package), writes the new
 * project's CLAUDE.md, docs/ORIGIN.md and docs/FIRST_SESSION.md from the kit templates, makes the
 * deploy workflows pass ADMIN_PASSWORD, then reports anything still mentioning xgallery.
 * Needs Node 18+ and git; no npm packages.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8' }).trim()

function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    if (key === 'no-git' || key === 'dry-run' || key === 'help') out[key] = true
    else out[key] = argv[++i]
  }
  return out
}
const args = parseArgs(process.argv)
const fail = (msg) => {
  console.error(`\n  ✖ ${msg}\n`)
  process.exit(1)
}
if (args.help || !args.name) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 15).map((l) => l.replace(/^ \* ?/, '')).join('\n'))
  process.exit(args.help ? 0 : 1)
}

const name = String(args.name).trim()
const slug = String(args.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).trim()
const domain = String(args.domain ?? '').trim().toLowerCase()
const repo = String(args.repo ?? '').trim()
const purpose = String(args.purpose ?? `${name}: describe in one sentence what this project is for.`).trim()
const outDir = path.resolve(String(args.out ?? path.join(root, '..', slug)))
const pkg = slug.replace(/[^a-z0-9]/g, '')
const pascal = name.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase())

if (!/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) fail(`slug "${slug}" must be 3-32 characters of a-z, 0-9 and hyphens, starting with a letter (pass --slug)`)
if (/xgallery/.test(slug)) fail('pick a slug that does not contain "xgallery": it must not collide with the running xGallery containers')
if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) fail('--domain must be a host name such as notes.amberxai.com')
if (domain === 'xgallery.amberxai.com') fail('--domain must differ from xGallery\'s')
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('--repo must look like Owner/name')
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) fail(`${outDir} exists and is not empty`)

const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const date = new Date().toISOString().slice(0, 10)

// Most specific first: the generic slug replacement runs last.
const REPLACEMENTS = [
  ['https://github.com/MossesX/xGallery.git', `https://github.com/${repo}.git`],
  ['MossesX/xGallery', repo],
  ['MossesX/xgallery', repo],
  ['ghcr.io/mossesx/xgallery', `ghcr.io/${repo.toLowerCase()}`],
  ['dev.xgallery.amberxai.com', `dev.${domain}`],
  ['xgallery.amberxai.com', domain],
  ['com.amberx.xgallery.devpanel', `com.amberx.${pkg}.devpanel`],
  ['com/amberx/xgallery/devpanel', `com/amberx/${pkg}/devpanel`],
  ['xGalleryDevApp', `${pascal}DevApp`],
  ['Lumen Gallery', name],
  ['xGallery', name],
  ['XGallery', pascal],
  ['XGALLERY', slug.toUpperCase().replace(/-/g, '_')],
  ['xgallery', slug],
]
const rename = (text) => REPLACEMENTS.reduce((t, [from, to]) => t.split(from).join(to), text)
const fill = (text, extra = {}) =>
  Object.entries({ NAME: name, SLUG: slug, DOMAIN: domain, REPO: repo, PKG: pkg, PURPOSE: purpose, SOURCE_SHA: sha, DATE: date, ...extra }).reduce((t, [k, v]) => t.split(`{{${k}}}`).join(v), text)

// Tracked files only: no node_modules, dist, data or local junk. The kit itself stays behind.
const SKIP = (f) => f.startsWith('kit/') || f === '.claude/commands/new-project.md' || f === 'CLAUDE.md'
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).filter((f) => !SKIP(f))

const isBinary = (buf) => buf.subarray(0, 8000).includes(0)
let changed = 0
const written = []
for (const rel of files) {
  const src = path.join(root, rel)
  if (!fs.existsSync(src) || fs.statSync(src).isDirectory()) continue
  const dstRel = rename(rel)
  const dst = path.join(outDir, dstRel)
  const buf = fs.readFileSync(src)
  let body = buf
  if (!isBinary(buf)) {
    const text = buf.toString('utf8')
    const next = rename(text)
    if (next !== text) changed++
    body = Buffer.from(next, 'utf8')
  }
  written.push(dstRel)
  if (args['dry-run']) continue
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.writeFileSync(dst, body)
  fs.chmodSync(dst, fs.statSync(src).mode)
}

// The new project's own instructions and context.
const rootClaude = fs.existsSync(path.join(root, 'CLAUDE.md')) ? fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8') : ''
const brett = rootClaude.includes('## Working with Brett') ? rootClaude.slice(rootClaude.indexOf('## Working with Brett')).trimEnd() + '\n' : ''
const generated = {
  'CLAUDE.md': fill(fs.readFileSync(path.join(here, 'CLAUDE.template.md'), 'utf8'), { WORKING_WITH_BRETT: brett }),
  'docs/ORIGIN.md': fill(fs.readFileSync(path.join(here, 'CONTEXT.md'), 'utf8')),
  'docs/FIRST_SESSION.md': fill(fs.readFileSync(path.join(here, 'FIRST_SESSION.template.md'), 'utf8')),
}
if (!args['dry-run']) {
  for (const [rel, text] of Object.entries(generated)) {
    fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true })
    fs.writeFileSync(path.join(outDir, rel), text)
  }
  // A fresh database seeds the owner from ADMIN_PASSWORD: make both deploys pass the secret,
  // so a new site never goes live with the fallback password.
  for (const wf of ['.github/workflows/deploy.yml', '.github/workflows/panel.yml']) {
    const p = path.join(outDir, wf)
    if (!fs.existsSync(p)) continue
    const t = fs.readFileSync(p, 'utf8')
    if (t.includes('export ADMIN_PASSWORD=')) continue
    const n = t.replace(/^(\s*)export SOURCE_VERSION="\$\{\{ github\.sha \}\}"\n/m, (m, ind) => `${m}${ind}export ADMIN_PASSWORD="\${{ secrets.ADMIN_PASSWORD }}"\n`)
    if (n === t) console.warn(`  ! could not add ADMIN_PASSWORD to ${wf}; add it by hand`)
    fs.writeFileSync(p, n)
  }
}

// Anything still named after xGallery (outside the files that describe the origin on purpose).
const leftovers = []
if (!args['dry-run']) {
  for (const rel of written) {
    const p = path.join(outDir, rel)
    const buf = fs.readFileSync(p)
    if (isBinary(buf)) continue
    buf.toString('utf8').split('\n').forEach((line, i) => {
      if (/xgallery/i.test(line)) leftovers.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`)
    })
  }
}

let committed = false
if (!args['dry-run'] && !args['no-git']) {
  const git = (...a) => execFileSync('git', a, { cwd: outDir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  try {
    git('commit', '-q', '-m', `Start ${name} from xGallery ${sha}`)
    git('branch', 'panel')
    git('remote', 'add', 'origin', `https://github.com/${repo}.git`)
    committed = true
  } catch {
    /* no git identity configured: leave it staged */
  }
}

console.log(`
  ${args['dry-run'] ? 'Would create' : 'Created'} ${name} in ${outDir}
  slug ${slug} · domain ${domain} · panel dev.${domain} · repo ${repo} · Android com.amberx.${pkg}.devpanel
  ${written.length} files copied, ${changed} renamed inside, plus CLAUDE.md, docs/ORIGIN.md, docs/FIRST_SESSION.md
  ${leftovers.length ? `${leftovers.length} line(s) still mention xgallery:\n    ${leftovers.slice(0, 15).join('\n    ')}` : 'No xgallery leftovers.'}
  ${args['dry-run'] ? '' : committed ? 'Git: main + panel branches, first commit made, origin set.' : args['no-git'] ? 'Git: skipped.' : 'Git: initialised and staged; commit by hand (no git identity here).'}

  Next:
    1. Create the empty repository ${repo} on GitHub (no README).
    2. Add its Actions secrets: VPS_SSH_KEY (or VPS_PASSWORD) and ADMIN_PASSWORD; optionally HOSTINGER_API_TOKEN.
    3. DNS: A records for ${domain} and dev.${domain} -> the VPS.
    4. cd ${outDir} && npm install && npm run typecheck && npm run build && npm run build:server
    5. git push -u origin main panel   (deploys the site and the panel)
    6. Open a Claude Code session on ${repo} and paste docs/FIRST_SESSION.md.
`)
