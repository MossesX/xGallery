/* xGallery service worker: keeps the app shell and the developer panel's data available offline.
 *
 * - Hashed build assets: cache first (immutable).
 * - Page navigations: network first, falling back to the cached shell.
 * - Read-only panel API calls (settings, who am I, developer data): network first with a short
 *   timeout, falling back to the last good copy, marked with an X-Offline-Cache header so the UI
 *   can say "showing cached data from …". Everything else goes straight to the network.
 */
const VERSION = 'v1'
const SHELL = `xg-shell-${VERSION}`
const DATA = `xg-data-${VERSION}`
const API_PREFIXES = ['/api/auth/me', '/api/settings', '/api/ai/status', '/api/themes', '/api/dev/']
const API_SKIP = ['/api/dev/terminal', '/api/dev/patch', '/api/dev/diff', '/api/dev/tasks/lists/']
const isExport = (p) => /\/export\.(md|csv|json)$/.test(p)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.add('/').catch(() => {})).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('xg-') && k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'clear') event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))))
})

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

async function markCached(response) {
  const headers = new Headers(response.headers)
  headers.set('X-Offline-Cache', headers.get('date') || new Date().toUTCString())
  return new Response(await response.clone().arrayBuffer(), { status: response.status, statusText: response.statusText, headers })
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.open(SHELL).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r })))
    return
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(SHELL).then(async (c) => {
        try {
          const r = await withTimeout(fetch(req), 10_000)
          if (r.ok) c.put('/', r.clone())
          return r
        } catch {
          return (await c.match('/')) || new Response('<h1>Offline</h1><p>The developer panel shell is not cached yet. Open it once while online.</p>', { status: 503, headers: { 'Content-Type': 'text/html' } })
        }
      }),
    )
    return
  }

  const p = url.pathname
  if (API_PREFIXES.some((x) => p.startsWith(x)) && !API_SKIP.some((x) => p.startsWith(x) && !/\/entries$/.test(p)) && !isExport(p)) {
    event.respondWith(
      caches.open(DATA).then(async (c) => {
        try {
          const r = await withTimeout(fetch(req), 8_000)
          if (r.ok) c.put(req, r.clone())
          return r
        } catch {
          const hit = await c.match(req)
          if (hit) return markCached(hit)
          return new Response(JSON.stringify({ error: 'You are offline and this data has not been cached yet' }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-Offline-Cache': 'none' } })
        }
      }),
    )
  }
})
