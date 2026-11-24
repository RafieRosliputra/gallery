# johorstudio-gallery

Google-Photos-style gallery for Johor Studio. This branch is the **phase-1
foundation**: Fastify skeleton, Postgres schema, migration runner, HEIC-capable
image, CI. No UI and no scanner yet.

Stack: Node 22 · TypeScript strict · Fastify 5 · Postgres 16 · sharp/libvips.
Rules for agents: `AGENTS.md`. Spec: `docs/SPEC.md`.

## Quickstart

```sh
npm install

# Postgres 16 (local test database; name must end in _test for the test suite)
docker run -d --name gallery-pg \
  -e POSTGRES_USER=gallery -e POSTGRES_PASSWORD=gallery -e POSTGRES_DB=gallery_test \
  -p 55432:5432 postgres:16

cp .env.example .env            # fake values only
npm run build
DATABASE_URL=postgres://gallery:gallery@localhost:55432/gallery_test npm run db:migrate
DATABASE_URL=postgres://gallery:gallery@localhost:55432/gallery_test npm start
curl -s localhost:3000/s/api/health
# {"ok":true,"version":"0.1.0","db":"up"}
```

Health returns `200` when Postgres answers, `503` with `db:"down"` when it does not.

## Tests

```sh
DATABASE_URL=postgres://gallery:gallery@localhost:55432/gallery_test npm test
DATABASE_URL=postgres://gallery:gallery@localhost:55432/gallery_test npm run typecheck
```

The migration test drops and recreates schema `public`; the guard refuses any
database whose name does not end in `_test`.

## Image / HEIC

`Dockerfile` targets `linux/amd64`. sharp is compiled against Alpine's system
libvips (8.18.2, libheif + libde265 + x265), because the npm prebuilt libvips
has no HEVC decoder. sharp is pinned to `0.34.5`: `0.35+` requires libvips
`>= 8.18.7`, newer than Alpine 3.24 ships (and libvips 8.18.7 + Alpine's
plugin-based libheif currently fails HEIC decode, libvips issue #3614).

```sh
docker build --platform linux/amd64 -t gallery:ci .
docker run --rm gallery:ci node scripts/heic-check.mjs
```

The check encodes a real HEIC with `heif-enc`, decodes it with sharp, makes a
300 px webp, asserts dimensions, and exits non-zero on any mismatch.

**Security note on the sharp pin:** `npm audit` flags sharp `< 0.35.4` because
of its bundled libvips/libheif. This image does not use the bundled libvips:
it links system libvips 8.18.2 and libheif 1.23.7. The libvips advisories
(CVE-2026-114113) affect GIF/TIFF/VIPS loaders, which this app does not accept;
the libheif advisories are fixed in libheif 1.23.2, older than what the image
ships. Before untrusted uploads land, block the unused loaders with
`sharp.block(...)` and re-check the pin when Alpine ships libvips >= 8.18.7.


## Decisions so far

- **Migration runner: plain forward-only runner** (`apps/server/src/migrate.ts`),
  ~90 lines: advisory lock, checksum guard, one transaction per file, no extra
  dependency. Compared `node-pg-migrate` (JS DSL + dependency tree, more than
  phase 1 needs) and `postgres-migrations` (thin, but another dependency to
  track); a plain runner is auditable and matches "numbered, forward-only".
- **Slug namespace: shared `slug_registry` table + triggers.** One primary key
  across client+album is race-free under concurrent writes without
  `SERIALIZABLE`, while `client.slug`/`album.slug` stay the source of truth.
- **Config: env only** (`apps/server/src/config.ts`), every variable documented
  in `.env.example`.

## Layout

```
apps/server/        Fastify API + migration runner
packages/shared/    shared response types and slug pattern
db/migrations/      numbered, forward-only SQL
scripts/            heic-check (runs inside the image)
deploy/             TrueNAS compose/cloudflared land in the deploy task
.github/workflows/  CI: test, image build, HEIC gate, GHCR push on main
```
