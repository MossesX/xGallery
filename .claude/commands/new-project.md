---
description: Create a new project from xGallery with the starter kit (renamed copy, context files, first-session prompt)
argument-hint: name="Project Name" domain=sub.amberxai.com repo=MossesX/repo purpose="one sentence"
---

Create a new project from xGallery with the starter kit in `kit/`. Arguments: $ARGUMENTS

1. Read `kit/README.md` and `kit/CONTEXT.md`.
2. Take name, domain, repo and purpose from the arguments. If the name, domain or repo is missing,
   ask Brett for it (one short question) and stop until he answers; a missing purpose can be a
   one-line placeholder.
3. Check the prerequisites with Brett in one message unless he already confirmed them: the GitHub
   repository exists and is empty, its Actions secrets `VPS_SSH_KEY` (or `VPS_PASSWORD`) and
   `ADMIN_PASSWORD` are set, and DNS A records exist for the domain and `dev.` + the domain.
4. Run `node kit/new-project.mjs --name … --domain … --repo … --purpose … --out ../<slug>` from the
   repository root. If it reports leftover xgallery lines, fix them in the generator (the rename
   map in `kit/new-project.mjs`), regenerate, and commit that fix to xGallery.
5. In the new folder: `npm install`, `npm run typecheck`, `npm run build`, `npm run build:server`.
   Start the server on a throwaway data dir and confirm `/healthz` and the site title.
6. Get push access to the new repository (in a cloud session: the add_repo tool with push access),
   then `git push -u origin main panel`. Watch both workflows ("Build and deploy" and "Deploy the
   developer panel") until they finish; on a transient SSH timeout re-run once.
7. Report to Brett, phone-readable: the site and panel URLs, what deployed, anything still to do,
   and that the next step is a Claude Code session on the new repo with `docs/FIRST_SESSION.md`.
