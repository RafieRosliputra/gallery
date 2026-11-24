# johorstudio-gallery

Google-Photos-style gallery for Johor Studio. This branch is **phase-1c**:
auth, public/admin API, Cloudflare Worker and TrueNAS deploy on top of the 1b
ingest pipeline (source → Postgres → WebP → R2). The SvelteKit UI is a separate
worktree/branch.

Stack: Node 22 · TypeScript strict · Fastify 5 · Postgres 16 · sharp 0.35.5
(prebuilt libvips) · pg-boss · argon2id · Cloudflare Worker (R2 + VPC origin).
Rules for agents: `AGENTS.md`. Spec: `docs/SPEC.md`. API: `docs/API.md`.

## Auth

```sh
npm run admin:create -- rafi   # password is read from stdin, never argv/logs
```

Sessions are server-side (`admin_session`, sha256 token), cookie
`gallery_session` (`HttpOnly; Secure; SameSite=Lax; Path=/s`, 30 days). Five
failed logins per 15 minutes per IP are rejected with `429`. All
`/s/api/admin/*` routes require a session. `ADMIN_OPEN` is gone.

## API in one screen

- Public: `resolve/:slug`, `client/:slug`, `album/:slug?cam=`, `bucket/:key`
  (keyset, ≤500), `o/:assetId?album=`, `POST zip` (streamed, `allow_download`
  enforced). See `docs/API.md`.
- Admin: client/album/album_folder CRUD, lazy folder tree, date/folder buckets,
  rescan, status (`r2Enabled`, `pendingR2` only when enabled).
- Derivatives: `GET /s/t/<derivKey>/<size>.webp` (local fallback; the Worker
  tries R2 first). API responses use `THUMB_BASE` (default `/s/t`).
- Scope: an album link can only fetch originals whose folder belongs to that
  album. Admin sessions can fetch any asset.

## Ingest

```sh
cp .env.example .env            # fake values only; SOURCE_ROOT/DATA_DIR/DATABASE_URL required
npm run scan                    # one incremental pass: stat files, upsert rows, queue thumbnails
npm run worker                  # pg-boss worker: 300/1600 WebP + thumbhash, then R2
```

- Inputs: `.jpg`, `.jpeg`, `.webp` (case-insensitive). Everything else, dotfiles,
  `@eaDir`, `.DS_Store`, `Thumbs.db` is ignored.
- `Cam 1`/`cam 2` folders become `asset.camera = "Cam N"` for every file below.
- `taken_at` = EXIF `DateTimeOriginal` (+ offset) else file mtime. `w`/`h` are
  after EXIF orientation.
- Incremental: path + size + mtime unchanged → skipped. A file missing from the
  new scan gets `deleted_at` (soft delete, row kept).
- `deriv_key = sha1(relPath + size + mtimeMs)`; originals are never hashed,
  converted or modified. Outputs: `DATA_DIR/thumbs/<derivKey>/{300,1600}.webp`,
  quality 80, metadata stripped, orientation baked in.
- Upload mode: `R2_MODE=off|s3|worker`. `s3` uses the four `R2_*` values;
  `worker` PUTs to `WORKER_UPLOAD_URL/<key>` with `X-Upload-Secret` (no R2
  credentials on the NAS). With no `R2_MODE`, a complete `R2_*` set means `s3`,
  otherwise `off`. Disabled uploads are logged once and skipped cleanly.
- `SCAN_EXCLUDE` (comma list, case-insensitive, any depth) defaults to
  `immich,@eaDir,#recycle,.Trash-1000,.Recycle.Bin`. Rows already ingested under
  a newly excluded directory are soft-deleted on the next pass.
- Every scan pass (CLI, periodic timer, admin rescan) takes the same Postgres
  advisory lock, so passes never overlap.
- `GET /s/api/admin/status` requires an admin session and returns
  `{assets,pendingThumbs,pendingR2,r2Enabled,lastScanAt,errors24h}`;
  `pendingR2` is 0 when R2 is off.

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
npm run admin:create -- rafi   # first admin; password on stdin
```

Health returns `200` when Postgres answers, `503` with `db:"down"` when it does not.

## Tests

```sh
DATABASE_URL=postgres://gallery:gallery@localhost:55432/gallery_test npm test
DATABASE_URL=postgres://gallery:gallery@localhost:55432/gallery_test npm run typecheck
```

The migration test drops and recreates schema `public`; the guard refuses any
database whose name does not end in `_test`. R2 assertions run only when the
`R2_*` env vars are set (CI points them at an S3-compatible container);
otherwise the test logs `r2: skipped`.

Fixtures are generated at test time with sharp — no real client photos.
Tests cover the ingest pipeline (nested `Cam 1`/`Cam 2`, EXIF orientation,
taken_at fallback, reruns, changed content, soft delete, escapes, blocked
GIF/TIFF/HEIF loaders, WebP, thumbhash, R2 headers), auth (login ok/fail,
rate limit, cookie flags, session expiry/logout), API scope (an album link
cannot fetch another album's original), bucket keyset, streamed ZIP, slug
conflicts and admin CRUD. `scan.test.ts` covers `SCAN_EXCLUDE` and the advisory
lock.

Worker tests are separate (miniflare, real R2 binding + service binding):

```sh
cd worker && npm ci && npm run typecheck && npm test
```

## Image / formats

`Dockerfile` targets `linux/amd64` and uses `node:22-bookworm-slim` plus sharp's
bundled prebuilt libvips. No system libvips, libheif, libde265 or x265, and no
source build. The runtime image only allows the JPEG and WebP libvips loaders
(`apps/server/src/scan/image-policy.ts`); GIF/TIFF/HEIF/SVG/PDF/VIPS are blocked.

```sh
docker build --platform linux/amd64 -t gallery:ci .
docker run --rm --network host \
  -e DATABASE_URL=postgres://gallery:gallery@127.0.0.1:5432/gallery_test \
  gallery:ci node scripts/format-check.mjs
```

`format-check` scans a generated JPEG and WebP inside the image, runs the real
thumbnail job, and asserts `450x300` grid + `1200x800` preview + thumbhash.

## Decisions so far

- **Migration runner: plain forward-only runner** (`apps/server/src/migrate.ts`),
  ~90 lines: advisory lock, checksum guard, one transaction per file, no extra
  dependency. Compared `node-pg-migrate` (JS DSL + dependency tree, more than
  phase 1 needs) and `postgres-migrations` (thin, but another dependency to
  track); a plain runner is auditable and matches "numbered, forward-only".
- **Slug namespace: shared `slug_registry` table + triggers.** One primary key
  across client+album is race-free under concurrent writes without
  `SERIALIZABLE`, while `client.slug`/`album.slug` stay the source of truth.
- **EXIF: exifr** (MIT, pure JS). `sharp.metadata()` only exposes a raw EXIF
  buffer + orientation, and `exiftool-vendored` ships/spawns Perl (~100 MB) for
  three fields. exifr parses `DateTimeOriginal` + offset without a subprocess.
- **deriv_key instead of full-file sha1** (DRIFT vs SPEC v2): hashing 500k
  originals on an HDD is too slow. `sha1(relPath + size + mtimeMs)` changes
  whenever the file changes and names both the thumbnail directory and R2 key.
- **Config: env only** (`apps/server/src/config.ts`), every variable documented
  in `.env.example`.
- **Argon2: `@node-rs/argon2`** (MIT). Prebuilt N-API binaries for linux/amd64
  and darwin; no node-gyp/Perl toolchain in the image. Argon2id, 19 MiB, t=2,
  p=1 (OWASP baseline). Password hashes are self-describing, so parameters can
  be raised later.
- **ZIP: `yazl` 3.x** (MIT). Compares with `archiver` (more deps + buffering)
  and `fflate` (in-memory). `yazl` writes a streaming ZIP directly to the
  response and pumps one file at a time, so no temp file and no album in memory.
- **Cookies: `@fastify/cookie`** (MIT, official Fastify plugin). We only need
  parse/set one opaque session cookie; signing is unnecessary because the token
  is random and stored hashed.
- **Worker tests: `miniflare`** (MIT, the runtime used by wrangler). Real R2
  binding and service binding, no Cloudflare account or deploy in CI.

## Layout

```
apps/server/        Fastify API, scanner, pg-boss worker, migration runner
packages/shared/    shared response types and slug pattern
db/migrations/      numbered, forward-only SQL (001 schema, 002 ingest, 003 API)
scripts/            format-check (runs in the image), perf report
deploy/             TrueNAS compose + RUNBOOK.md
worker/             Cloudflare Worker (routes, R2, VPC origin) + miniflare tests
docs/               SPEC.md, API.md
.github/workflows/  CI: test + R2 + perf + image build + format gate + GHCR push
```
