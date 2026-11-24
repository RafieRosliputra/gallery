# API — phase 1c

All routes live under `/s`. JSON bodies; errors are `{ error, message }` with a
Bahasa Melayu `message`. Bigint ids are JSON strings.

## Auth (cookie session)

- `POST /s/api/auth/login` `{username,password}` → `{admin:{id,username}}`.
  Sets `gallery_session`: `HttpOnly; Secure; SameSite=Lax; Path=/s; Max-Age=2592000`.
  Five failures per 15 minutes per IP → `429` + `Retry-After`.
- `POST /s/api/auth/logout` → `204` (deletes the server-side session).
- `GET /s/api/auth/session` → `{admin}` or `401`.

Every `/s/api/admin/*` route requires a live session. Sessions are rows in
`admin_session`; only `sha256(token)` is stored. Cookie values are opaque.

`ORIGIN_SECRET`: when set on the server, every request except
`GET /s/api/health` must carry `X-Origin-Secret` (the Worker adds it), otherwise
`403`.

## Public

- `GET /s/api/resolve/:slug` → `{kind:"client",client}` or
  `{kind:"album",album,client}`; `404` if unknown.
- `GET /s/api/client/:slug` → `{client,albums:[{…album,count,cover}]}`.
  Cards only, no asset list.
- `GET /s/api/album/:slug?cam=` → `{album,client,cameras,buckets,total,thumbBase}`.
  `buckets` are `{key:"YYYY-MM",count}` in `TIMEZONE`; `cam` filters totals and
  buckets (`Cam 1`, `Cam 2`, …). No asset list.
- `GET /s/api/bucket/:key?album=&cam=&cursor=&limit=` → `{assets,nextCursor}`.
  `key` is `YYYY-MM`. Keyset only, `limit` default 100, max 500.
  Public requests must include `album`; `f:<folderId>` keys are admin-only.
- `GET /s/api/o/:assetId?album=` → original bytes (`inline`, `private, no-store`).
  Allowed for an admin session, or when the asset's folder belongs to the album
  in `album`. A link scoped to album A cannot fetch album B's original (`403`).
  Hot cache wins when `hot_until > now()` and `DATA_DIR/hot/<derivKey>` exists.
- `POST /s/api/zip` `{albumSlug,ids?,cam?}` → streamed `application/zip`, no temp
  file, `allow_download=false` → `403`. Ids are optional and are intersected with
  the album scope. Entry names are the original basenames, de-duplicated.
  Whole-album ZIP is allowed; JSON endpoints never return a whole album.
- `GET /s/t/:derivKey/:size.webp` (`size` 300|1600) → local derivative fallback,
  `Cache-Control: public, max-age=31536000, immutable`. The Worker tries R2 first.

Asset item:

```json
{
  "id": "123",
  "w": 800, "h": 1200,
  "takenAt": "2024-05-01T02:00:00.000Z",
  "camera": "Cam 1",
  "thumbhash": "base64…",
  "mime": "image/jpeg",
  "thumb": "/s/t/<derivKey>/300.webp",
  "preview": "/s/t/<derivKey>/1600.webp",
  "original": "/s/api/o/123?album=album-a"
}
```

`thumb`/`preview` use `THUMB_BASE` (default `/s/t`; an R2 CDN URL later).

## Admin

- `GET /s/api/admin/status` → `{assets,pendingThumbs,pendingR2,r2Enabled,lastScanAt,errors24h}`.
  `pendingR2` is 0 unless `R2_MODE` is `s3`/`worker`.
- `GET/POST /s/api/admin/clients`, `PATCH/DELETE /s/api/admin/clients/:id`
- `GET/POST /s/api/admin/albums`, `PATCH/DELETE /s/api/admin/albums/:id`
- `GET/POST /s/api/admin/albums/:id/folders`,
  `DELETE /s/api/admin/albums/:id/folders/:folderId`
- `GET /s/api/admin/folders?parent=<id>` → `{parent,folders}`; one level only
  (lazy children), 500-child cap. Omit `parent` for the root `.`.
- `GET /s/api/buckets?mode=date|folder&album=` → `{buckets}` (admin session;
  `/s/api/admin/buckets` is an alias). Folder keys are `f:<folderId>` with
  `label` = relative path.
- `POST /s/api/admin/rescan` → `202 {started:true}` or `409` when a pass is
  already running. Scans serialize on a Postgres advisory lock across CLI,
  timer and API.

Slug rules: `^[a-z0-9-]{3,60}$`, one namespace shared by clients and albums.
Conflicts return `409 {error:"slug_conflict"}` with a BM message.
