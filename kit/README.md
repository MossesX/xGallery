# Starter kit: a new project from xGallery

Turns a copy of xGallery into a new, independently deployed project on the same VPS, with
everything renamed so the two never collide, and gives the new project's Claude Code sessions the
context they need from the first prompt.

| File | What it is |
| --- | --- |
| `new-project.mjs` | The generator. Copies the tracked files, renames every identifier, writes the new project's context files, initialises git. |
| `CONTEXT.md` | Architecture and inventory: platform vs gallery, request pipeline, deploy topology, traps already found. Becomes `docs/ORIGIN.md` in the new project. |
| `CLAUDE.template.md` | Instructions for the new project. Becomes its `CLAUDE.md` (the "Working with Brett" section is copied live from this repo's `CLAUDE.md`). |
| `FIRST_SESSION.template.md` | The first prompt for the new repo's first session. Becomes `docs/FIRST_SESSION.md`. |
| `../.claude/commands/new-project.md` | `/new-project` for a Claude Code session opened on xGallery. |

## Way 0: the wizard (easiest, from the phone)

xGallery's developer panel → Operations → **New project** (`/dev/new-project`). Type a name; the
slug, domain and repository fill themselves in. Press **Build it** and it does everything below by
itself: generates the copy, creates the repository, installs a deploy key of its own on the VPS and
sets the secrets, adds the DNS records, gives the Claude GitHub app access so the repository shows
up in Claude.ai, pushes `main`, waits for the site, pushes `panel`, waits for the panel, and shows
the first-session prompt with an **Open Claude Code** button. It stops only when it needs you (the
VPS password if the panel has no key, a click in GitHub if the token cannot add the repository to
the Claude app, a DNS record to replace, a failed deploy to re-run). A stopped run resumes from the
Projects list. The panel's GitHub token must be a classic token with `repo` and `workflow`.

The two ways below do the same by hand.

## Before you start (only you can do these)

1. Pick a **name**, a **domain** (for example `notes.amberxai.com`) and a **GitHub repo** name.
2. Create the repository on GitHub, empty (no README), under `MossesX`.
3. In that repository: Settings → Secrets and variables → Actions → add `VPS_SSH_KEY` (or
   `VPS_PASSWORD`) and `ADMIN_PASSWORD` (the first owner password). Optional: `HOSTINGER_API_TOKEN`.
4. DNS: A records for the domain and for `dev.` + the domain, pointing at the VPS. The VPS manager
   (Sites & DNS) in xGallery's developer panel can add them.

## Way 1: ask Claude Code (recommended)

Open a Claude Code session on **MossesX/xGallery** and send:

```
/new-project name="Acme Notes" domain=notes.amberxai.com repo=MossesX/acme-notes purpose="A shared notebook for the family"
```

Or paste this kickoff prompt (fill in the four values):

```
Create a new project from xGallery using kit/README.md.
Name: Acme Notes
Domain: notes.amberxai.com
GitHub repo: MossesX/acme-notes (already created, empty, secrets and DNS done)
Purpose: A shared notebook for the family.
Run kit/new-project.mjs into ../<slug>, verify typecheck and both builds in the new folder,
push main and panel to the new repo, watch both deploys, then tell me the URLs and what is left.
```

## Way 2: run it yourself (on the VPS through Moshi, or any machine with Node 18+ and git)

```
cd ~/xgallery            # a clone of MossesX/xGallery
node kit/new-project.mjs --name "Acme Notes" --domain notes.amberxai.com \
  --repo MossesX/acme-notes --purpose "A shared notebook for the family" --out ../acme-notes
cd ../acme-notes && npm install && npm run typecheck && npm run build && npm run build:server
git push -u origin main panel
```

`--dry-run` lists what would happen, `--slug` overrides the derived slug, `--no-git` skips git.

## Then

Open a Claude Code session on the new repository and paste `docs/FIRST_SESSION.md`. That session
verifies the copy, agrees the product plan with you, brands it, removes what the plan drops and
builds the first slice.

## What the generator renames

| xGallery | New project (example: Acme Notes) |
| --- | --- |
| `xGallery`, `Lumen Gallery` (text) | `Acme Notes` |
| `xgallery` (containers, volume, Traefik routers, `/opt` paths, CSRF header, storage keys) | `acme-notes` |
| `XGallery`, `XGALLERY` (Android theme, heredoc markers) | `AcmeNotes`, `ACME_NOTES` |
| `xgallery.amberxai.com`, `dev.xgallery.amberxai.com` | `notes.amberxai.com`, `dev.notes.amberxai.com` |
| `MossesX/xGallery`, `ghcr.io/mossesx/xgallery` | `MossesX/acme-notes`, `ghcr.io/mossesx/acme-notes` |
| `com.amberx.xgallery.devpanel` (package and folders) | `com.amberx.acmenotes.devpanel` |

It also makes both deploy workflows pass `ADMIN_PASSWORD`, so a new site never goes live with
the fallback owner password, and it reports any line that still mentions xgallery.
Verified on Oct 18 2026: the generated project type-checks, builds both halves, starts, answers
`/healthz`, shows its own name and lets the seeded owner sign in.
