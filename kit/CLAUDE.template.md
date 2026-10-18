# {{NAME}}

{{PURPOSE}}

Lives at https://{{DOMAIN}} (developer panel at https://dev.{{DOMAIN}}). Repository `{{REPO}}`.
Started on {{DATE}} as a copy of xGallery (`MossesX/xGallery` at `{{SOURCE_SHA}}`), so it carries
xGallery's platform: accounts and roles, owner recovery, temporary-owner sandbox, notifications,
no-code site builder, themes, developer panel (VPS, GitHub, terminal, command library, tasks),
AI assistant and an Android panel app. Read `docs/ORIGIN.md` before changing structure.

## Status (as of {{DATE}})

- **Built:** the inherited xGallery platform and gallery, renamed to {{NAME}}. Nothing product
  specific yet.
- **Next:** the first session follows `docs/FIRST_SESSION.md`: verify the build, agree with Brett
  what to keep, remove or add, then build the first slice.
- Update this section whenever something meaningful changes.

## Stack & layout

```
src/                React 19 client (Vite, react-router, react-query, zustand, xterm)
  pages/            public pages; admin/ (owner console); dev/ (developer panel); me/ (member area)
  components/ api/ lib/ theme/ layouts/ store/ terminal/ ui/
server/src/         Express 5 API: app.ts (pipeline + routers), db.ts (node:sqlite), auth.ts
  routes/           one file per area
  ai/ github/ vps/  assistant, GitHub manager, Hostinger + SSH
android/            Kotlin WebView app for the panel (com.amberx.{{PKG}}.devpanel)
docs/ORIGIN.md      what was inherited, platform vs product, traps already found
docker-compose.traefik.yml   production site behind Coolify's Traefik
docker-compose.panel.yml     the developer panel's own container
Dockerfile          node:24-alpine, builds client + server, serves both on :3000
```

## Build, run, verify

```
npm install
npm run dev            # client on :5173, proxies /api to :3000
npm run server         # compile the server and run the API on :3000
npm run typecheck      # client + server, no emit
npm run build          # client -> dist/
npm run build:server   # server -> server/dist
```

- No automated tests in the repo yet. Verify end to end with Playwright against a server on a
  throwaway data dir (`DATA_DIR=/tmp/x PORT=4500 node server/dist/index.js`); see `docs/ORIGIN.md` §7.
- Seeded owner on a fresh database: `brett`, password from the `ADMIN_PASSWORD` secret (falls back
  to `admin123`: set the secret before the first deploy).

## Deploy

- Push to `main` → `deploy.yml` → container `{{SLUG}}-app` at https://{{DOMAIN}} (`/opt/{{SLUG}}`).
- Push to `panel` → `panel.yml` → container `{{SLUG}}-panel` at https://dev.{{DOMAIN}}
  (`/opt/{{SLUG}}-panel`), same data volume. Keep it current: `git checkout panel && git merge main && git push`.
- Secrets: `VPS_SSH_KEY` or `VPS_PASSWORD`, `ADMIN_PASSWORD`; optional `VPS_USER`,
  `HOSTINGER_API_TOKEN`, `RESET_OWNER_PASSWORD`.
- DNS: A records for `{{DOMAIN}}` and `dev.{{DOMAIN}}` → the VPS.
- Owner locked out: sign in with username `password` + password `reset` and a recovery code, or
  Actions → "Build and deploy" → Run workflow with `reset_owner_password`.

## Conventions & decisions

- Same conventions as xGallery: tokens server-side only; every client call through
  `src/api/client.ts`; theming via CSS custom properties; no image libraries on the server;
  production behind Coolify's Traefik on the `coolify` network (no host ports).
- Container, volume, router and path names all use `{{SLUG}}` so this project can share the VPS
  with xGallery. Keep it that way for anything new.
- Owner recovery exists — never weaken it or log keys.
- Commit messages: one plain-English sentence describing the user-visible change.

{{WORKING_WITH_BRETT}}
