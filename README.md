# johorstudio-gallery

Google-Photos-style gallery for Johor Studio. This branch is the **phase-1b
ingest pipeline**: source folder → Postgres rows → WebP derivatives → Cloudflare
R2. No UI and no auth yet.

Stack: Node 22 · TypeScript strict · Fastify 5 · Postgres 16 · sharp 0.35.5
(prebuilt libvips) · pg-boss. Rules for agents: `AGENTS.md`. Spec:
`docs/SPEC.md`.

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
- R2 is optional: if any of `R2_ENDPOINT`/`R2_BUCKET`/`R2_ACCESS_KEY_ID`/
  `R2_SECRET_ACCESS_KEY` is missing, `r2.upload` is skipped and logged once.
- The server process also runs an incremental scan every `SCAN_INTERVAL_MIN`
  (default 10; `0` disables it).
- `GET /s/api/admin/status` → `{assets, pendingThumbs, pendingR2, lastScanAt,
  errors24h}` only when `ADMIN_OPEN=1` (tests/phase 1b; auth comes in 1c).

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
database whose name does not end in `_test`. R2 assertions run only when the
`R2_*` env vars are set (CI points them at an S3-compatible container);
otherwise the test logs `r2: skipped`.

Fixtures are generated at test time with sharp — no real client photos.
Tests cover a nested `Cam 1`/`Cam 2` tree, EXIF orientation, taken_at fallback,
an unchanged rerun, changed content, soft delete, path/symlink escapes, blocked
GIF/TIFF/HEIF loaders, WebP dimensions, thumbhash and R2 object headers.

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

## Layout

```
apps/server/        Fastify API, scanner, pg-boss worker, migration runner
packages/shared/    shared response types and slug pattern
db/migrations/      numbered, forward-only SQL (001 schema, 002 ingest)
scripts/            format-check (runs in the image), perf report
deploy/             TrueNAS compose/cloudflared land in the deploy task
.github/workflows/  CI: test + R2 + perf + image build + format gate + GHCR push
```
