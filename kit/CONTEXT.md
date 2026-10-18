# Origin context: what this project inherits from xGallery

This file describes the codebase this project was created from (xGallery, `MossesX/xGallery`).
Read it before changing structure: it says what each part does, which parts are the reusable
platform and which are the gallery product, and the traps already found the hard way.

In the copy, every xGallery identifier was renamed: `{{SLUG}}` stands for the project slug
(xGallery: `xgallery`), `{{DOMAIN}}` for the site domain (xGallery: `xgallery.amberxai.com`) and
`{{REPO}}` for the GitHub repository. File paths are unchanged.

## 1. Shape

- **Client:** React 19 + Vite + TypeScript, react-router 7, @tanstack/react-query, zustand
  (persisted UI store), lucide-react icons, xterm.js. Entry `src/main.tsx`, routes in `src/App.tsx`.
- **Server:** Node 24, Express 5, SQLite through `node:sqlite` (no ORM), TypeScript compiled with
  `tsconfig.server.json` to `server/dist`. Entry `server/src/index.ts`, app in `server/src/app.ts`.
- **One container** serves the API and the built client on port 3000. Data lives in `DATA_DIR`
  (`/data` in Docker): `gallery.db`, `media/`, `activity/` (monthly SQLite partitions), `sandbox/`.
- **No image libraries on the server:** thumbnails and dimensions are made in the browser at upload.
- **Theming** is CSS custom properties on `<html>` (`--c-*`, `--font-*`, `--radius`, `--scale`),
  light and dark per theme. Colour mode defaults to light.

## 2. Platform (keep for almost any product)

| Area | Server | Client | Notes |
| --- | --- | --- | --- |
| Accounts, sessions, roles | `auth.ts`, `routes/auth.ts`, `routes/users.ts` | `LoginPage`, `ChangePasswordPage`, `admin/UsersPage`, `RequireAuth` | Roles: `owner`, `admin`, `user`, `temp_owner`. Cookie `xg_session`. PBKDF2 (120k). |
| Policy, groups, per-user overrides | `policy.ts`, `access.ts`, `routes/policy.ts` | `admin/PoliciesPage` | `PERM_KEYS` mixes generic and gallery perms (canUpload, canPublish, canShareLinks…): edit together with the product. |
| Owner recovery | `seed.ts` (`applyOwnerPasswordReset`), `routes/auth.ts` (`/owner-recovery*`) | `OwnerRecoveryDialog`, Policies → Owner recovery | Sign-in with username `password` + password `reset`; keys = deploy secret or single-use codes. Never weaken. |
| Temporary owner sandbox | `sandbox.ts`, `db.ts` (`sandboxStore`, `db` proxy, `mediaRel`, `removeMedia`) | `Banner` sandbox bar | Every request of a `temp_owner` runs on a private DB copy. New media writes must go through `mediaRel()`/`removeMedia()`. |
| Notifications, activity log, inbox | `notifications.ts`, `activity.ts`, `routes/{notifications,activity,inbox}.ts` | bell, `admin/ActivityPage`, `InboxPage` | Activity is partitioned by month. |
| Site settings, branding, themes | `brand.ts`, `routes/{settings,themes}.ts` | `ThemeProvider`, `ThemeEditor`, `dev/DevDesignPages` | Defaults in `brand.ts` (`DEFAULT_SETTINGS`: siteTitle, tagline, brandName). |
| No-code site builder | `dev.ts` (`UiConfig`, `sanitizeUi`, snapshots) | `ui/config.tsx`, `Banner`, `ContextMenu`, `DesignMode` | Navigation, toolbar, footer, home sections, context menu, custom CSS, feature flags, all owner-editable. Home section types include gallery ones. |
| Developer panel | `dev.ts`, `routes/dev.ts`, `ai/workspace.ts` | `pages/dev/*`, `DevLayout` (`NAV`) | Separate developer password per sign-in session, event log, checkpoints, code editor, developer AI. |
| Ops tooling | `vps/*`, `github/*`, `routes/{vps,github,setup}.ts`, `terminal.ts` | `dev/vps`, `dev/github`, `dev/commander`, `dev/ops`, `dev/setup` | Hostinger API, Docker, DNS, firewall, SFTP, SSH/mosh terminal, 260+ command library, one-click setup. Ops profile defaults in `ops.ts`. |
| AI assistant | `ai/*`, `routes/ai.ts` | `AssistantPanel`, `admin/AssistantSettingsPage`, `TokenField` | Claude Code CLI with a subscription token first, Anthropic API key as backup. Credential formats checked by `src/lib/tokenFormat.ts` + `server/src/ai/tokens.ts`. |
| Tasks & notes | `tasks.ts`, `routes/tasks.ts` | `dev/tasks/*` | Lists, groups, typed entries, dockable workspace, Panes menu. |
| Offline / PWA | — | `public/sw.js`, `public/manifest.webmanifest` | Caches the shell and panel data; mutations blocked offline. |
| Android panel app | — | `android/` | WebView + native SSH (sshj), Termux hand-off. Opens `dev.{{DOMAIN}}/dev`, falls back to `{{DOMAIN}}/dev`. |

## 3. Product (the gallery: replace or remove for a different product)

- **Server:** `routes/{albums,media,galleries,social,admin}.ts` (admin partly generic), `pin.ts`,
  `zip.ts`, `serialize.ts`, `demo.ts` (demo community, only with `XG_DEMO=1`), parts of `seed.ts`.
- **Client:** `pages/{AlbumPage,GalleryPage,GalleriesPage,PhotosPage,FavoritesPage,Public*,SharePage,HomePage}`,
  `pages/me/*`, `pages/admin/{Album*,Gallery*,NewAlbumsPage}`, components `Album*`, `Media*`,
  `Lightbox`, `Uploader`, `Feed*`, `Like*`, `Reaction*`, `Comments`, `layouts/`.
- **Tables:** albums, media, likes, favorites, comments, galleries, gallery_access, album_access,
  album_links, album_collaborators, reactions, buddies, messages.
- **Coupling to cut when removing it:** `seed.ts` gives every account a gallery; `access.ts`
  `ensureGalleryFor`; `PERM_KEYS`; home section types `galleries`/`albums`; context-menu album
  items; the banner search; public browsing routes `/public*`; `db.ts` schema blocks.
- Removing safely: delete routes and pages together, then run `npm run typecheck` and follow every
  error; keep the schema blocks until the code using them is gone (tables can stay harmlessly).

## 4. Request pipeline (server/src/app.ts, in order)

1. Security headers.
2. **CSRF guard:** non-GET `/api` calls must be JSON or carry the upload metadata header, and the
   client always sends `X-Requested-With: {{SLUG}}`. Any new client code must use `src/api/client.ts`.
3. `attachUser` (session cookie → `req.user`; a `temp_owner` is switched into their sandbox here).
4. `attachDev` (open developer session → `req.devSession`).
5. Public-browsing gate (policy `publicBrowsing`), then JSON body parsing, then routers.
6. `/api/dev*` refuses sandboxes; `requireDev` requires an unlocked developer session.
- Helpers in `util.ts`: `wrap()` for async handlers, `HttpError`, `str()`/`num()` input clamps.
- A 401 whose message is `Sign in required` makes the client drop its session and go to sign-in.

## 5. Client conventions

- All calls through `api.get/post/put/patch/del` (`src/api/client.ts`); react-query keys in
  `src/api/hooks.ts` and per-area `src/api/*.ts`.
- Owner/admin settings entries are listed once in `settingsEntries()` (`components/Banner.tsx`) and
  reused by the gear menu, the phone menu and the context menu.
- The developer panel menu is the `NAV` array in `pages/dev/DevLayout.tsx` (groups and sub-menus;
  a "Go to…" combo on phones).
- zustand store `xgallery-ui` → renamed `{{SLUG}}-ui`; it has a persist `version` with a migration.
- Hooks must sit above every early `return` in a component (a crash here once broke the context menu).

## 6. Deploy topology

- Hostinger VPS running **Coolify**; Coolify's Traefik owns 80/443 on the external `coolify`
  network. Containers expose no host ports; Traefik labels route by hostname.
- **Site:** push to `main` → `.github/workflows/deploy.yml` copies the repo to `/opt/{{SLUG}}`, runs
  `docker compose -p {{SLUG}} -f docker-compose.traefik.yml up -d --build`, prints the owner-reset
  outcome, checks `https://{{DOMAIN}}/healthz`.
- **Panel:** push to `panel` → `.github/workflows/panel.yml` builds container `{{SLUG}}-panel`
  (`/opt/{{SLUG}}-panel`, `XG_PANEL=1`) on `dev.{{DOMAIN}}`, sharing the site's data volume.
- **Volume name trap:** compose prefixes the project, so the site's volume is
  `{{SLUG}}_{{SLUG}}_data`; `panel.yml` detects the real name before mounting it.
- **Secrets** (repository → Settings → Secrets → Actions): `VPS_SSH_KEY` or `VPS_PASSWORD`
  (required), `VPS_USER` (default root), `ADMIN_PASSWORD` (first owner password, used only when
  the database is created), `HOSTINGER_API_TOKEN` (optional), `RESET_OWNER_PASSWORD` (recovery).
- **Manual owner reset:** Actions → "Build and deploy" → Run workflow → `reset_owner_password`
  sets a temporary password that must be changed at sign-in. Every applied value is remembered,
  so a later deploy never undoes a newer reset.
- **DNS:** A records for `{{DOMAIN}}` and `dev.{{DOMAIN}}` → the VPS. Traefik issues certificates.
- Transient `dial tcp …:22: i/o timeout` in the copy step happens when several deploys connect at
  once; one re-run fixes it.

## 7. Verifying changes (no test suite in the repo)

- Always: `npm run typecheck`, `npm run build`, `npm run build:server`.
- End to end: start the server on a throwaway data dir and drive it with Playwright:
  `DATA_DIR=/tmp/x PORT=4500 node server/dist/index.js` (add `XG_DEMO=1` for demo content).
  Unset `GITHUB_TOKEN`/`GH_TOKEN` first or the GitHub manager picks them up.
- External services were tested against small fakes (SSH server, Hostinger API, GitHub API, a
  fake `claude` binary via `CLAUDE_BIN`); `HOSTINGER_API_URL` and `GITHUB_API_URL` point the
  server at them.
- In a fresh browser context, load a page before calling relative `fetch()` in `page.evaluate`.

## 8. Things already learned

- Terminal pastes of tokens arrive wrapped and indented; both sides normalise before checking.
- Browsers strip newlines from `<input>` values but keep the spaces between wrapped lines.
- `claude setup-token` prints a long sign-in link that wraps; a truncated copy gives "Invalid
  OAuth request: missing state parameter". The browser code goes back into the terminal; only the
  terminal prints the `sk-ant-oat01-` token.
- The developer password is reset from the lock screen with the account password.
- Phone menus must be positioned against the viewport (`position: fixed`), not the wrapped banner.
- Another session may push to `main` (for example `CLAUDE.md` edits): fetch and merge before pushing.
