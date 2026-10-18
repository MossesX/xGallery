# First session prompt for {{NAME}}

Paste everything below the line into the first Claude Code session opened on `{{REPO}}`.

---

This repository is **{{NAME}}**, created from xGallery by the starter kit. Goal: {{PURPOSE}}

Before doing anything else:

1. Read `CLAUDE.md` and `docs/ORIGIN.md` in full. They are the only memory this project has.
2. Following "Working with Brett" in `CLAUDE.md`, recommend which model to use for this build
   and why, and let Brett choose.

Then work through these steps, committing and pushing after each one:

1. **Verify the copy.** `npm install`, `npm run typecheck`, `npm run build`, `npm run build:server`.
   Start the server on a throwaway data dir and confirm `/healthz`, the sign-in page and the
   developer panel load. Fix anything the rename broke before going further.
2. **Plan the product.** Using `docs/ORIGIN.md` §2 and §3, write `docs/PLAN.md`: which platform
   parts to keep, which gallery parts to remove or repurpose, and the first slice of {{NAME}}'s
   own features (data model, routes, pages). Show Brett the plan and wait for his go-ahead
   before deleting any module.
3. **Brand it.** Site defaults in `server/src/brand.ts` (title, tagline), `index.html`,
   `public/manifest.webmanifest`, the Android app name in `android/app/src/main/res/values/strings.xml`,
   and rewrite `README.md` for {{NAME}}.
4. **Remove what the plan drops**, routes and pages together, following every `npm run typecheck`
   error until the build is clean. Keep database tables until no code uses them.
5. **Build the first slice** from the plan, verified end to end with Playwright.
6. **Deploy.** Check with Brett that the GitHub repo has its secrets (`VPS_SSH_KEY` or
   `VPS_PASSWORD`, and `ADMIN_PASSWORD`) and that DNS A records exist for `{{DOMAIN}}` and
   `dev.{{DOMAIN}}`. Push `main` (site) and `panel` (developer panel), watch both workflows, and
   confirm https://{{DOMAIN}}/healthz answers.
7. **Hand over.** Update the Status section of `CLAUDE.md` (built, next) and push.

Keep replies phone-readable: lead with the result, short paragraphs.
