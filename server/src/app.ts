import express, { type Request, type Response, type NextFunction } from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { attachUser, pruneSessions } from './auth.js'
import { applyOwnerPasswordReset, ensureSeeded } from './seed.js'
import { removeDemoCommunity, seedDemoCommunity } from './demo.js'
import { HttpError } from './util.js'
import { getPolicy } from './policy.js'
import { authRouter } from './routes/auth.js'
import { usersRouter } from './routes/users.js'
import { albumsRouter, shareRouter } from './routes/albums.js'
import { mediaRouter } from './routes/media.js'
import { themesRouter } from './routes/themes.js'
import { settingsRouter } from './routes/settings.js'
import { galleriesRouter, publicRouter } from './routes/galleries.js'
import { socialRouter } from './routes/social.js'
import { aiRouter } from './routes/ai.js'
import { inboxRouter } from './routes/inbox.js'
import { activityRouter } from './routes/activity.js'
import { policyRouter } from './routes/policy.js'
import { notificationsRouter } from './routes/notifications.js'
import { devRouter } from './routes/dev.js'
import { tasksRouter } from './routes/tasks.js'
import { vpsRouter } from './routes/vps.js'
import { githubRouter, githubWebhookRouter } from './routes/github.js'
import { startGithubPolling } from './github/snapshot.js'
import { setupPublicRouter, setupRouter } from './routes/setup.js'
import { newProjectRouter } from './routes/newproject.js'
import { attachDev, sweepDevSessions } from './dev.js'
import { adminRouter } from './routes/admin.js'

/** This process serves the developer panel on its own host (docker-compose.panel.yml) rather than the site. */
export const PANEL_MODE = process.env.XG_PANEL === '1'
ensureSeeded()
applyOwnerPasswordReset()
// The demo community is opt-in for development (XG_DEMO=1); production data stays real.
if (process.env.XG_DEMO === '1') seedDemoCommunity()
else removeDemoCommunity()
pruneSessions()
setInterval(pruneSessions, 6 * 3600 * 1000).unref()
setInterval(sweepDevSessions, 5 * 60 * 1000).unref()
startGithubPolling()

export const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)
app.disable('x-powered-by')
// Security headers for every response.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  next()
})
// State-changing API calls must come from our own pages: a JSON body or an upload with our metadata header.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const ct = String(req.headers['content-type'] ?? '')
  const ok = ct.startsWith('application/json') || req.headers['x-meta'] != null || ct.startsWith('image/') || ct.startsWith('video/') || req.headers['x-requested-with'] === 'xgallery'
  if (!ok) return res.status(415).json({ error: 'Unsupported request format' })
  next()
})

app.get('/healthz', (_req, res) => res.type('text').send('ok'))

app.use('/api', attachUser)
app.use('/api', attachDev)
// Site switch: when visitors may not browse, anonymous reads of galleries, albums and media are refused.
// Sign-in, the shell's settings, account/contact requests, themes and private share links stay open.
app.use('/api', (req, res, next) => {
  if (req.user || getPolicy().publicBrowsing) return next()
  const open = req.path.startsWith('/auth') || req.path.startsWith('/settings') || req.path.startsWith('/inbox') || req.path.startsWith('/share') || req.path.startsWith('/themes') || req.path.startsWith('/github/webhook') || req.path.startsWith('/setup/termux-key') || (req.path.startsWith('/media/') && req.query.s != null)
  if (open) return next()
  res.status(401).json({ error: 'Sign in to browse this site', code: 'login_required' })
})
// GitHub webhook deliveries are verified against their raw body before any JSON parsing.
app.use('/api/github/webhook', express.raw({ type: '*/*', limit: '5mb' }), githubWebhookRouter)
app.use('/api', express.json({ limit: '1mb' }))
app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)
app.use('/api/albums', albumsRouter)
app.use('/api/share', shareRouter)
app.use('/api/galleries', galleriesRouter)
app.use('/api/public', publicRouter)
app.use('/api/social', socialRouter)
app.use('/api/ai', aiRouter)
app.use('/api/inbox', inboxRouter)
app.use('/api/activity', activityRouter)
app.use('/api/policy', policyRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/admin', adminRouter)
// A temporary owner's sandbox never reaches the developer tooling: it acts on the real server, code and services.
app.use('/api/dev', (req, res, next) => {
  if (req.sandbox) return res.status(403).json({ error: 'The developer panel is not available to a temporary owner: it changes the real server, source code and services', code: 'sandbox' })
  next()
})
app.use('/api/dev/tasks', tasksRouter)
app.use('/api/dev/vps', vpsRouter)
app.use('/api/dev/github', githubRouter)
app.use('/api/dev/setup', setupRouter)
app.use('/api/dev/new-project', newProjectRouter)
app.use('/api/setup', setupPublicRouter)
app.use('/api/dev', devRouter)
app.use('/api/themes', themesRouter)
app.use('/api/settings', settingsRouter)
app.use('/api', mediaRouter)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))

// Static client
const clientDir = process.env.CLIENT_DIR ?? path.resolve(process.cwd(), 'dist')
if (existsSync(clientDir)) {
  app.use('/assets', express.static(path.join(clientDir, 'assets'), { immutable: true, maxAge: '1y' }))
  app.use(express.static(clientDir, { index: false, maxAge: '1h' }))
  app.get(/.*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(clientDir, 'index.html'))
  })
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  const e = err as { type?: string; status?: number; message?: string }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON' })
    return
  }
  console.error(err)
  res.status(e?.status ?? 500).json({ error: e?.message && e.status ? e.message : 'Internal server error' })
})
