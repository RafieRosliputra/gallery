# AGENTS.md — how to work on johorstudio-gallery

Read this file fully before touching code. It is written for AI agents (DeepSeek, Claude, qwen) and for Rafi.
Language: code, docs, commits = English. Chat with Rafi = Bahasa Melayu, short, bullets, no filler.

## 0. What this is

Google-Photos-style gallery for Johor Studio (JohorStudio.com).
- Admin (Rafi) browses every photo on the NAS fast, groups folders into albums, gives links.
- Client gets ONE portal link: `johorstudio.com/s/<client-slug>` with all their albums.
- Each album has its OWN link `johorstudio.com/s/<album-slug>` so a client can share one album with their customers.
- Own code. Architecture is Immich-style, but **no Immich code is copied** (Immich is AGPL-3). Ideas only.

Full spec: `docs/SPEC.md`. UI reference (15 screens): see link in `docs/SPEC.md` § UI.

## 1. Roles and flow (fixed)

| who | does |
|---|---|
| Rafi | decides, approves anything destructive, sets secrets |
| CLAUDE | spec, UI/UX spec, review, verifies with real runs |
| DeepSeek | implements, writes tests, runs them, reports |

Flow for every task:
1. CLAUDE writes a brief (goal, files, constraints, acceptance test).
2. DeepSeek builds + runs tests (max 3 fix rounds).
3. CLAUDE verifies by running it (not by reading). Pass = `done` with evidence. Fail = exact error back to DeepSeek.
4. Report to Rafi in 1–5 lines.

Where code runs:
- Heavy build/test → PC i9 (Windows, Tailscale) when it is ON. If OFF → say so in 1 line, continue with DeepSeek elsewhere. Never silently skip.
- Production → `tnas` (TrueNAS SCALE). Never build or experiment on `tnas` directly.

## 2. Hard rules

1. **Verify before claiming.** "Should work" is not a result. Paste the command + output.
2. **Never invent** paths, APIs, flags, versions, URLs. Check or ask.
3. **Scoped changes.** Only what the task needs. No drive-by refactors, renames or reformatting.
4. **Uncertain → label it** `ASSUME:` or `GUESS:` in one line, then continue.
5. **Ask only at a real fork**: destructive, costly, irreversible, or genuinely ambiguous.
6. **No secrets in git.** Not in code, tests, docs, commit messages, logs. This repo is PUBLIC for now (will go private later) — treat everything committed as public forever.
7. **No real client data in git.** No client photos, names, phone numbers, emails. Fixtures use fake names (`Tadika Contoh`, `Klien Demo`) and generated images.
8. **Source photos are read-only.** The app must never write, move, rename or delete anything under the source mount. Enforce with a `:ro` mount AND in code.
9. **Search before writing.** Need a capability? Check npm/GitHub first, compare 2–3 options (approach · license · maintained · fit), pick one, name it in the PR. Flag GPL/AGPL before using.
10. **Spec vs code conflict** → write a `DRIFT:` note in the PR/report, recommend one side. Never silently pick.

## 3. Stack (decided — do not swap without a DRIFT note)

- Node 22 + TypeScript (strict), Fastify
- Postgres 16 + pgvector (pgvector only from phase 4)
- Job queue: pg-boss (no Redis)
- Images: sharp (libvips) built WITH libheif for HEIC — verify HEIC decode in the Docker image before anything else
- Placeholders: thumbhash
- Web: SvelteKit (static build served by Fastify under `/s`), justified layout + virtual scroll
- Storage of derivatives: local SSD + Cloudflare R2 (S3 API)
- Deploy: Docker image built by GitHub Actions → GHCR → TrueNAS custom app on `tnas`

## 4. Repo layout (target)

```
apps/server/        Fastify API, scanner, workers (TS)
apps/web/           SvelteKit UI (admin + public)
packages/shared/    types shared by server + web
db/migrations/      SQL migrations (numbered, forward-only)
deploy/             compose file for TrueNAS, cloudflared, worker
worker/             Cloudflare Worker for johorstudio.com/s/*
docs/               SPEC.md, decisions, runbooks
.github/workflows/  CI (test) + image build/push
```

## 5. Coding conventions

- TypeScript strict, no `any` without a comment saying why.
- Small modules, one job each. Pure functions for layout/math; IO at the edges.
- Errors: never swallow. Log with context (asset id, path) and continue the batch.
- Every DB query on a hot path has an index listed in the migration. Pagination = keyset (cursor), never OFFSET.
- Never load a whole album/library into memory or into one API response. Pages ≤ 500 items.
- Paths: always resolve and check they stay inside the source root (no `..` escape).
- Config only from env vars (see `.env.example`). Document every new var there with a fake value.
- UI copy is Bahasa Melayu. Code identifiers English.
- Public pages: dark theme, icon bar (share · favourite · download · more), phone grid justified by real aspect ratio, no crop.
- Navigation in the web app: client-side routing with history (`pushState`). Back button must work. Never open a new tab/window.
- Accessibility: real `<button>`/`<a>`, `aria-label` on icon buttons, 44px touch targets, text contrast ≥ 4.5:1.

## 6. Tests and "done"

- Unit: vitest. Integration: real Postgres in Docker (testcontainers or compose).
- Each task brief has an acceptance test. It must run in CI.
- Perf checks are measured, not guessed (e.g. timeline first paint on a 100k-row seeded DB).
- `done` requires evidence: test output, commit hash, or URL. Otherwise status stays `WIP`.

## 7. Git

- Default branch `main` (protected later). Work on `feat/<short-name>` or `fix/<short-name>`.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- One logical change per commit. No generated junk, no `node_modules`, no build output, no `.env`.
- Push / open PR only when the task says so.

## 8. Deploy (summary — details in `docs/SPEC.md`)

1. Merge to `main` → Actions builds `ghcr.io/rafierosliputra/gallery:<sha>` + `:latest`.
2. `tnas` custom app pulls the image. Mounts: source photos read-only, app data on SSD dataset.
3. `cloudflared` on `tnas` exposes the app to Cloudflare (no open router ports).
4. Cloudflare Worker route `johorstudio.com/s/*` → tunnel. Thumbnails served from R2 custom domain.
5. Rafi approves before any change to DNS, routes, or the live app.

Agents never: change router/NAS settings, touch other apps on `tnas`, delete datasets, or print secrets. Mask as `<set>`.

## 9. Reporting format (to Rafi)

```
STATUS: done | wip | blocked:<why>
DONE: <what changed, 1–3 bullets>
EVIDENCE: <command → result | commit | url>
NEXT: <1 action>
```
