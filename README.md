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
