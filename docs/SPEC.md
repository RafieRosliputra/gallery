# johorstudio-gallery — SPEC v2

> updated: 2026-11-24 by: claude · public copy (internal hosts/IPs removed)

## Decisions (Rafi, 2026-11-24)

- Host: `tnas` (TrueNAS SCALE, 4-core i5-4570, ~11 GB RAM — ~3–4 GB free). Keep footprint small.
- Formats: jpg, webp, heic. Scale: 100k–500k photos.
- Admin entry: `johorstudio.com/s` — password login in app (argon2id, rate-limited).
- Client portal: `johorstudio.com/s/<client-slug>` — one link per client, lists all their albums. Name slug only, no PIN (Rafi accepts the guessable-link risk).
- Album link: `johorstudio.com/s/<album-slug>` — own slug, so a client can share one album with their customers. Opened directly it shows that album only: no back link, no other albums.
- Navigation: SPA with history; back button works; never a new window.
- Camera subfolders (`Cam 1`, `Cam 2`, …) are kept: album shows tabs `Semua` (merged by EXIF time) · `Cam 1` · `Cam 2`.
- Favourites: browser localStorage only, never sent to server.
- Downloads: single original · ZIP all · ZIP favourites (ids from localStorage) · per-album download on/off.
- Admin timeline: two modes — by EXIF date, by folder.
- Album = virtual set of many folders under the source root. Files are never moved.
- New photos: Rafi copies into the source folder on HDD; app picks them up automatically.
- Hot cache: new originals copied to SSD for 30 days, cap 80 GB, evict oldest first when over cap.
- Thumbnails pushed to Cloudflare R2, served from a CDN domain.
- Later (phase 4): search by filename/date · face grouping on tnas CPU, nights only, client albums only.

## Storage

- Source (read-only mount): HDD photo root → `/data/source:ro`
- App data (SSD dataset): `/data/app/{pg,thumbs,hot,tmp}`
- Derivatives: grid 300px webp + preview 1600px webp + thumbhash (in DB). R2 key `t/<sha1>/<size>.webp`
- Originals served from hot cache if present, else source. Originals are never cached on Cloudflare. No video caching on Cloudflare.

## Data model (minimum)

- `folder(id, path UNIQUE, parent_id)`
- `asset(id, path UNIQUE, folder_id, camera NULL, size, mtime, sha1, taken_at, w, h, mime, thumbhash, thumb_ok, r2_ok, hot_until)`
- `client(id, name, slug UNIQUE, created_at)`
- `album(id, client_id, title, slug UNIQUE, allow_download, created_at)`
- `album_folder(album_id, folder_id, recursive)`
- `admin(id, username, pw_hash)`
- Slugs: `[a-z0-9-]{3,60}`, one namespace shared by client + album.
- Camera: a subfolder whose name matches `/^cam\s*\d+$/i` under an album folder → `asset.camera`.
- Indexes: `asset(taken_at DESC, id)`, `asset(folder_id, taken_at)`, `asset(camera)`, `client(slug)`, `album(slug)`.

## API (all under `/s`, never clashes with the main site)

- `GET  /s/api/resolve/:slug` → `{kind: "client" | "album", …}`
- `GET  /s/api/client/:slug` → client + album cards
- `GET  /s/api/album/:slug?cam=` → album meta + month buckets (never the full asset list)
- `GET  /s/api/bucket/:key?album=&cam=&cursor=` → asset page (keyset, ≤ 500)
- `GET  /s/api/buckets?mode=date|folder&album=` → `[{key, count}]` (admin)
- `GET  /s/api/o/:assetId` → original (hot → source). Allowed for admin, or if asset is in an album the request is scoped to.
- `POST /s/api/zip {albumSlug, ids?, cam?}` → streamed ZIP, no temp file, respects `allow_download`
- Admin CRUD: clients, albums, album folders, rescan, status.

## Performance targets (measure, don't claim)

- Admin timeline first paint < 1.5 s on a 100k-asset seeded DB; smooth scroll (virtual list, thumbhash placeholders).
- Public album page never loads a whole album.
- Thumbnail generation low priority (nice 19, concurrency 1–2). GUESS ~0.3–0.6 s/photo on the tnas CPU.

## Security

- Strict CSP (no `unsafe-inline`), argon2id, login rate limit, slug validation.
- Source mount is read-only; code also refuses writes outside `/data/app`.
- No secrets in the repo; config via env.

## Phases

1. Scanner (watch + nightly full rescan) · EXIF · thumbnails · R2 push · admin timeline (date + folder) ← start
2. Clients + albums (multi-folder) · portal page · album page · camera tabs · downloads · favourites
3. SSD hot cache 30 d / 80 GB + eviction job
4. Search filename/date · face grouping

## Deploy

GitHub Actions → GHCR image → TrueNAS custom app on `tnas` → `cloudflared` → Cloudflare Worker route `johorstudio.com/s/*`. Thumbnails: R2 + CDN domain. Rafi approves every DNS/route/live change.

## Open

1. HEIC: confirm sharp+libheif decodes HEIC inside the image — owner: DeepSeek
2. CDN domain name for R2 — owner: Rafi
3. Cloudflare: R2 bucket, tunnel on tnas, Worker route — owner: Rafi approves, CLAUDE prepares
4. Measure RAM of app + Postgres on tnas in phase 1 — owner: DeepSeek

## UI

15 screens (admin light, public dark): Claude Design canvas "johorstudio-gallery — semua page UI" (link kept in Rafi's private notes).
