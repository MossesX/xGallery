# Lumen Gallery

A professional, fully themeable photo and video gallery built with React 19, TypeScript and Vite.
An administrator creates user accounts, uploads media into albums, and controls the look of the
site. Members sign in to browse, like and comment.

## Features

**Administration**
- Admin login with PBKDF2-hashed passwords (Web Crypto, 100k iterations, per-user salt).
- Create, disable, delete users; assign user/admin roles; reset passwords.
- Create albums with title, slug, description, tags, cover image, draft/published state and ordering.
- Drag-and-drop upload of images and videos. Thumbnails are generated client-side (video poster frames too).
- Per-item titles and descriptions, reordering, cover selection.

**Developer panel: VPS manager**
- Hostinger integration (API token kept server-side): VM state and power, DNS zone editor, network
  firewall, snapshot/backups, root password, hostname, plus a raw API explorer.
- The machine over SSH with the panel key: live system stats, every Docker container (start / stop /
  restart / pause / kill / remove, logs, exec, export / import, "test all containers" health report),
  images, volumes, compose projects, prune; subdomains as Traefik-fronted compose sites with the DNS
  record created in one step; SFTP file browser and editor with upload/download; ufw; systemd services,
  journal, apt, crontab, reboot; a one-shot console next to the full SSH terminal and mosh tabs.

**Developer panel: GitHub manager**
- The server holds the GitHub token, polls the repository in the background and receives signed
  webhooks, so the browser and the Android app only ever talk to this server and always see the
  same current state (and the last snapshot while offline).
- Overview with live-site status (which commit is deployed, deploy in progress, one-click deploy),
  commits and diffs, branches, pull requests (review, merge, create), issues (labels, comments,
  assign, close), Actions (runs, jobs, steps, logs, re-run, cancel, dispatch), releases and tags,
  code browser that commits straight to a branch, repository secrets (sealed with libsodium) and
  variables, webhook install, GitHub inbox, collaborators, and a raw API explorer. Failed runs,
  successful deploys, new PRs/issues and releases notify the owner in the site bell.

**Shared private albums (PIN)**
- Any album can be set to "Shared private": it stays hidden from members and is reachable only
  through a private link plus a 4 to 8 digit PIN chosen when the status is set (members with the
  share-links permission can do this for their own albums).
- Opening the link shows a blurred snapshot of the album page behind a PIN prompt; the snapshot is
  rendered on the device and uploaded when the album becomes shared and again whenever it changes.
  Wrong PINs are rate limited; a correct PIN sets an album-scoped cookie for 12 hours.

**Developer panel: Filesystem commander**
- A no-code way to drive the server: a library of 260+ commands (files, search, text, permissions,
  archives, transfer, disk, processes, services, network, docker, git, packages, users, system,
  xGallery) in a grid with expandable rows and nested sub-grids, a tree with a changeable root, or
  cards, with search and instant filter chips (category, risk, tag, favourites).
- Picking a command shows its options as switches, pickers (with a server-side folder browser) and
  fields; the exact line is previewed and sent to the active SSH terminal tab, or pasted for editing.
- Nested tab groups: SSH terminals and FTP (SFTP) clients, each with their own tabs; FTP snippets
  run through the panel's SFTP connection, "terminal here" bridges a folder into a shell.
- Favourites, history and your own snippets (with {placeholder} options) are stored on the server.
- The same snippet browser is embedded in Terminal · SSH (runs in the open terminal) and in Remote
  shell · mosh, where each command is wrapped into the profile's mosh invocation to copy, download
  or hand to Termux.

**One-click setup (Auto setup switch)**
- The developer panel shows an *Auto setup* switch at the top once it has probed the server. Flip it
  and the wizard configures everything on its own: panel SSH key, the phone's key (inside the Android
  app), installing all keys on the VPS (asks for the root password once, never stores it, then uses
  keys only), mosh + the UDP range in ufw, tmux, Claude Code on the VPS, Termux on the phone (opens
  F-Droid when missing, hands Termux an enrolment script that generates a key and uploads it through a
  single-use token, then installs that key on the server), the Hostinger token (VM picked
  automatically), the GitHub token (repository set, webhook installed) and the assistant's Claude token.
- It only stops for what it genuinely needs from you; every step is logged on the developer session.
  Re-running is safe: present parts are skipped. Operations → Servers & code → One-click setup.

**Navigation**
- The developer panel's menu is three collapsible groups (Developer, Site builder, Operations) with
  sub-menus (Look & feel, Menus & pages, Servers & code, Shell & phone, …) that remember their state;
  on phones the whole panel menu becomes one "Go to…" combo. The site banner folds its navigation and
  toolbar into a sectioned menu (Go to / Tools / Account) on narrow screens.

**Temporary owner (sandbox)**
- A member can be given the *Temporary owner* role (Owner console → Members). They get the full
  owner console and every owner power, but inside a private copy of the site: the first request
  copies the database (their account becomes the owner in the copy, server secrets are stripped),
  uploads go to their own media folder, and nothing they do reaches the live site or other people.
  Deleting live content inside the sandbox never touches live files. The developer panel (real
  server, code, VPS, GitHub) is refused. Passwords are account-level and do apply for real.
- A purple bar reminds them they are in a sandbox, with "Reset to the live site"; the real owner can
  reset or demote them from the Members page, which throws the copy away.

**Owner password recovery**
- On the sign-in page, type `password` as the username and `reset` as the password: a dialog asks
  for a recovery key and a new owner password, then signs you in. A key is one of the single-use
  recovery codes generated in Owner console → Policies, or the current `RESET_OWNER_PASSWORD`
  deploy secret. Five wrong keys block the dialog for 15 minutes; every attempt is logged and
  notified.
- No key at hand? Set the `RESET_OWNER_PASSWORD` repository secret (8+ characters) and deploy: the
  owner account gets that password once, every session is ended, and a note lands in the owner
  feed. The same value is never applied twice (the deploy log says what happened), so remove the
  secret right after signing in. As a last resort, on the VPS:
  `docker exec -i xgallery-app node -e 'const {DatabaseSync}=require("node:sqlite"),{pbkdf2Sync,randomBytes}=require("node:crypto");const db=new DatabaseSync("/data/gallery.db");const s=randomBytes(16).toString("hex");db.prepare("UPDATE users SET password_hash=?,salt=?,must_change_password=0,disabled=0 WHERE role=\x27owner\x27").run(pbkdf2Sync(process.argv[1],s,120000,32,"sha256").toString("hex"),s);db.prepare("DELETE FROM sessions").run();console.log("owner password set")' 'NewPassword123'`

**Theming**
- Every theme carries a matched light *and* dark palette, display/body fonts, corner radius and density.
- "Roll a theme" generates a harmonious theme (complementary / analogous / triadic / split / monochrome)
  with WCAG-aware text colours. Hand-edit every colour, preview live, then activate site-wide.
- Members pick light, dark or system on their own device. No flash of the wrong mode on load.

**Layouts**
- Six album layouts: Masonry, Grid, Justified, Mosaic, Filmstrip, Carousel.
- Each has columns, gap, caption mode (hover / overlay / below / hidden), tile shape, rounding,
  hover zoom, like badges and an optional hero cover banner.
- A site-wide **default layout** that every album inherits, plus an optional **per-album override**.
  "Roll layout" randomises either. Overrides can be reset individually or all at once.

**Members**
- Browse published albums, open a keyboard-navigable lightbox with video playback.
- Like media, comment on individual items and on albums. Admins can moderate comments.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173 and sign in with the seeded administrator:

| Username | Password |
| -------- | -------- |
| `admin`  | `admin123` |

Change it immediately under **Account → Change password**.

Other scripts:

```bash
npm run build      # type-check and produce dist/
npm run preview    # serve the production build
npm run typecheck  # tsc only
```

## Architecture

```
src/
  db/          Dexie (IndexedDB) schema and shared types
  lib/         auth (hashing/login), media processing, settings, seeding
  store/       Zustand stores: session (persisted login) and UI (colour mode, previews, toasts)
  theme/       colour maths, theme generator ("roll"), CSS-variable applier, presets
  layouts/     layout registry, defaults and the layout generator ("roll")
  components/  shell, theme provider, layouts renderer, lightbox, comments, editors
  pages/       public pages and the admin area
  styles/      a single CSS-variable-driven stylesheet
```

Theming works purely through CSS custom properties set on `<html>` (`--c-*`, `--font-*`,
`--radius`, `--scale`). Any component that uses those variables is automatically themeable.

## Deployment

See [deploy/README.md](deploy/README.md) for the Docker image, the Compose stack with automatic HTTPS,
and the Hostinger VPS deployment workflow.

## Storage model

The app ships with its own server (`server/`): Node 24, Express and SQLite through Node's built-in
`node:sqlite`, with media files stored on disk under `DATA_DIR` (`/data` in the container, a named
volume in Compose). Accounts, albums, likes, comments, favourites and themes are shared by every
member. Thumbnails and dimensions are computed in the browser at upload time and stored next to the
originals, so the server needs no image libraries.

Environment variables: `PORT` (3000), `DATA_DIR`, `CLIENT_DIR`, `ADMIN_PASSWORD` (initial admin
password on first start, default `admin123`), `MAX_UPLOAD_BYTES` (2 GB).

Local development: `npm run dev` for the client on :5173 (proxying `/api` to :3000) and
`npm run server` for the API.
