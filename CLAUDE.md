# xGallery

A self-hosted, fully themeable photo and video gallery at https://xgallery.amberxai.com
(README title: "Lumen Gallery"). React 19 + Vite client with its own Node 24 / Express /
SQLite (`node:sqlite`) server; owners/admins manage members, albums, themes and layouts,
members browse, like and comment. It also carries a big owner-only **developer panel**
(VPS manager, GitHub manager, SSH/mosh terminal, command library, task manager, AI assistant)
and a small Android wrapper app for that panel.

## Status (as of Oct 17 2026)

- **Built:** gallery (6 layouts, themes with light/dark, PIN-shared private albums, comments,
  likes), roles incl. sandboxed "Temporary owner", owner password recovery, developer panel
  (Hostinger VPS + Docker + DNS + firewall, GitHub PRs/issues/Actions/secrets, SFTP, terminal,
  260+ command library, one-click setup wizard), tasks & notes, AI assistant, Android panel app.
- **Recent (Oct 15–16):** developer panel split onto its own server/branch
  (`dev.xgallery.amberxai.com`), settings gear + menus, fly-out context menus, task-manager
  Panes sub-menu, assistant rejects mis-pasted subscription tokens.
- **Next:** not recorded in the repo. Ask Brett, then write it here.
- Note: `deploy/README.md` ends with an outdated line saying data lives in each browser's
  IndexedDB; the README "Storage model" (server + SQLite) is current. README's
  "Architecture" tree (mentions `src/db/` Dexie) is also outdated — trust the tree below.

## Stack & layout

```
src/                React client (Vite, react-router, react-query, zustand, xterm)
  pages/            public pages; admin/ (owner console); dev/ (developer panel:
                    vps/, github/, commander/, ops/, tasks/, setup/); me/ (member area)
  components/ api/ theme/ layouts/ store/ terminal/
server/src/         Express API: app.ts (routes, /healthz), db.ts (SQLite), auth.ts,
  routes/           one file per area (albums, media, users, vps, github, tasks, ai...)
  ai/ github/ vps/  assistant (API + Claude Code CLI), GitHub poller, Hostinger + SSH
android/            Kotlin WebView app for the panel (com.amberx.xgallery.devpanel)
deploy/             deploy docs, Caddyfile, nginx.conf, hPanel compose, hostinger-setup.sh
docker-compose.traefik.yml   production (Coolify Traefik); .panel.yml = panel container
docker-compose.yml + .build.yml  standalone Caddy stack (fallback)
Dockerfile          node:24-alpine, builds client + server, runs on :3000
```

## Build, run, test

From package.json / README:

```
npm install
npm run dev            # client on :5173, proxies /api to :3000
npm run server         # compile server (tsconfig.server.json) and run API on :3000
npm run typecheck      # client + server tsc, no emit
npm run build          # tsc -b && vite build -> dist/
npm run build:server   # server only -> server/dist
```

- No automated tests. Seeded login on a fresh data dir: `admin` / `admin123`
  (`ADMIN_PASSWORD` overrides).
- Android: `gradle -p android assembleDebug` (CI uses Gradle 8.9, JDK 17, no wrapper in repo).
- CI / deploy:
  - `deploy.yml` — push to `main`: publishes `ghcr.io/mossesx/xgallery`, copies source to
    `/opt/xgallery` on the VPS, runs `docker compose -p xgallery -f docker-compose.traefik.yml
    up -d --build`, checks `/healthz`. Secrets: `VPS_SSH_KEY` or `VPS_PASSWORD`, optional
    `HOSTINGER_API_TOKEN`, `RESET_OWNER_PASSWORD`.
  - `panel.yml` — push to `panel`: rebuilds only the panel container at
    `dev.xgallery.amberxai.com` (`/opt/xgallery-panel`), sharing the site's data volume.
  - `android.yml` — changes under `android/`: builds the APK and publishes it to the
    `android-latest` release as `xgallery-dev-panel.apk`.

## Conventions & decisions

- Two branches deploy: `main` = site, `panel` = developer panel. Keep the panel current with
  `git checkout panel && git merge main && git push` (currently identical to `main`).
- Server env: `PORT`, `DATA_DIR` (`/data`), `CLIENT_DIR`, `MAX_UPLOAD_BYTES`, `XG_PANEL`,
  `PANEL_DOMAIN`, `SITE_DOMAIN`, `GITHUB_TOKEN`, `HOSTINGER_API_TOKEN`, `ANTHROPIC_API_KEY` /
  `CLAUDE_CODE_OAUTH_TOKEN` (assistant). Tokens live server-side only, never in the client.
- Theming is pure CSS custom properties on `<html>` (`--c-*`, `--font-*`, `--radius`, `--scale`).
- Thumbnails/dimensions are computed in the browser at upload; the server has no image libs.
- Production sits behind Coolify's Traefik on the `coolify` network (no host ports).
- Owner recovery exists (README "Owner password recovery") — never weaken it or log keys.
- Commit messages: one plain-English sentence describing the user-visible change.

## Related repos

- Not built on the AmberX framework (MossesX/AmberX-AXF); standalone React/Express.
- **MossesX/axHub** — Brett's connector hub; the panel's VPS/GitHub features overlap with it.

## Working with Brett (same in every MossesX repo)

- **Where he works:** mostly from his Android phone (Samsung Galaxy S26 Ultra), often through **Moshi** (mosh) into his Hostinger VPS, where Claude Code runs. Keep replies phone-readable: lead with the result, short paragraphs, no walls of text.
- **Model choice:** before any build task, recommend which model to use and why, then let him pick from the top three (Fable, Opus, Sonnet). Use Fable where it's warranted, Opus for most work, and Sonnet only when you're sure Opus isn't needed.
- **The repo is the shared memory.** Sessions on the phone (Moshi), desktop, web and claude.ai don't share chat history, so anything a future session needs must live in this repo. Commit and push often with clear messages, and update the **Status** section of this file whenever something meaningful changes.
- **No secrets in the repo:** no tokens, passwords, keys or IPs with credentials. Use environment variables or GitHub Actions secrets.
- **GitHub:** account `MossesX`. A new repo must exist on GitHub before a session can push to it.
- **Server:** a Hostinger VPS running **Coolify**. Coolify's Traefik proxy owns ports 80/443, so new web apps go behind it as Coolify apps (no separate nginx). His domain is `amberxai.com`.
- **axHub:** his connector hub on the VPS (repo `MossesX/axHub`). If the axHub MCP server is configured in this Claude Code install, use its `list_services`, `describe_service` and `call` tools to reach his other services instead of asking him for credentials.
