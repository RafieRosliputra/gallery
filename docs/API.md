# API — phase 1c

All routes live under `/s`. JSON bodies; errors are `{ error, message }` with a
Bahasa Melayu `message`. Bigint ids are JSON strings. This file is the contract
for the web client (phase 1d is reconciled to it, not the other way round).

The SvelteKit build (`WEB_DIR`, default `apps/web/build`) is served at `/s`:
hashed `_app/immutable/*` files are `public, max-age=31536000, immutable`,
`index.html` is `no-cache`, and every other unmatched `GET /s/*` returns
`index.html` so the client router owns the URL. `/s/api/*`, `/s/t/*` and
`/s/_r2/*` never fall back and return a real 404.

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
- `GET /s/api/client/:slug` → client portal; cards only, no asset list.
- `GET /s/api/album/:slug?cam=` → album meta; no asset list.
- `GET /s/api/bucket/:key?album=&cam=&cursor=&limit=` → one page of assets.
- `GET /s/api/asset/:id?album=` → one asset for viewer deep links.
- `GET /s/api/o/:assetId?album=` → original bytes (`inline`, `private, no-store`).
- `POST /s/api/zip` `{albumSlug,ids?,cam?}` → streamed ZIP.
- `GET /s/t/:derivKey/:size.webp` (`size` 300|1600) → derivative fallback.

### Shared objects

`client`:

```json
{ "id": "1", "name": "Klien Demo", "slug": "klien-demo" }
```

`album` (meta, no counts or cover):

```json
{
  "id": "10",
  "clientId": "1",
  "title": "Album A",
  "slug": "album-a",
  "allowDownload": true
}
```

`asset` (every field the API emits):

```json
{
  "id": "123",
  "w": 800,
  "h": 1200,
  "takenAt": "2024-05-01T02:00:00.000Z",
  "camera": "Cam 1",
  "thumbhash": "base64…",
  "mime": "image/jpeg",
  "thumb": "/s/t/<derivKey>/300.webp",
  "preview": "/s/t/<derivKey>/1600.webp",
  "original": "/s/api/o/123?album=album-a"
}
```

- `w`, `h`, `takenAt`, `camera`, `thumbhash` are nullable (`null` when the file
  has no such metadata). `mime` is always `image/jpeg` or `image/webp`.
- `thumb`/`preview` use `THUMB_BASE` (default `/s/t`; an R2 CDN URL later).
  Both stay viewable on every public link.
- `original` is present only on album-scoped public pages (`bucket`, album card
  cover). It returns `403 download_disabled` when the album has
  `allowDownload:false`; an admin session is always allowed.

`bucket` (date buckets; `label` appears only for admin `mode=folder` rows):

```json
{ "key": "2024-05", "count": 2 }
```

### Client portal — `GET /s/api/client/:slug`

```json
{
  "client": { "id": "1", "name": "Klien Demo", "slug": "klien-demo" },
  "albums": [
    {
      "id": "10",
      "clientId": "1",
      "title": "Album A",
      "slug": "album-a",
      "allowDownload": true,
      "count": 2,
      "cover": {
        "id": "123",
        "w": 800,
        "h": 1200,
        "takenAt": "2024-05-01T02:00:00.000Z",
        "camera": "Cam 1",
        "thumbhash": "base64…",
        "mime": "image/jpeg",
        "thumb": "/s/t/<derivKey>/300.webp",
        "preview": "/s/t/<derivKey>/1600.webp",
        "original": "/s/api/o/123?album=album-a"
      }
    }
  ]
}
```

Album card fields: `id`, `clientId`, `title`, `slug`, `allowDownload`, `count`
(number of live assets in the album's folder scope), `cover` (newest asset, or
`null` when the album is empty). Cards never carry an asset list.

### Album meta — `GET /s/api/album/:slug?cam=`

```json
{
  "album": {
    "id": "10",
    "clientId": "1",
    "title": "Album A",
    "slug": "album-a",
    "allowDownload": true
  },
  "client": { "id": "1", "name": "Klien Demo", "slug": "klien-demo" },
  "cameras": ["Cam 1", "Cam 2"],
  "buckets": [
    { "key": "2024-05", "count": 2 },
    { "key": "2024-04", "count": 8 }
  ],
  "total": 10,
  "thumbBase": "/s/t"
}
```

- `cameras` lists the distinct cameras in scope, sorted; `cam` filters `buckets`
  and `total` only (`Cam 1`, `Cam 2`, …; `all`/absent means no filter).
- `buckets` are `YYYY-MM` in `TIMEZONE`, newest first. `total` is their sum.
- Album meta never carries an asset list.

### Bucket page — `GET /s/api/bucket/:key?album=&cam=&cursor=&limit=`

```json
{
  "assets": [
    {
      "id": "123",
      "w": 800,
      "h": 1200,
      "takenAt": "2024-05-01T02:00:00.000Z",
      "camera": "Cam 1",
      "thumbhash": "base64…",
      "mime": "image/jpeg",
      "thumb": "/s/t/<derivKey>/300.webp",
      "preview": "/s/t/<derivKey>/1600.webp",
      "original": "/s/api/o/123?album=album-a"
    }
  ],
  "nextCursor": "MTIz"
}
```

- `key` is `YYYY-MM`. Public requests must include `album`; `f:<folderId>` keys
  are admin-only. `limit` defaults to 100, max 500. Pagination is keyset only;
  `nextCursor` is `null` on the last page.
- Asset fields are exactly the `asset` object above (`id`, `w`, `h`, `takenAt`,
  `camera`, `thumbhash`, `mime`, `thumb`, `preview`, `original`).

### One asset — `GET /s/api/asset/:id?album=`

```json
{
  "asset": {
    "id": "123",
    "w": 800,
    "h": 1200,
    "takenAt": "2024-05-01T02:00:00.000Z",
    "camera": "Cam 1",
    "thumbhash": "base64…",
    "mime": "image/jpeg",
    "thumb": "/s/t/<derivKey>/300.webp",
    "preview": "/s/t/<derivKey>/1600.webp",
    "original": "/s/api/o/123?album=album-a"
  },
  "albumSlug": "album-a"
}
```

Scope rules are the same as `GET /s/api/o/:assetId`: an admin session, or the
album named in `album` whose folder scope owns the asset. Otherwise `401`
(no album and no admin session), `403 forbidden` (asset outside that album) or
`404`. `albumSlug` is the scope used, or `null` for an admin request without
`album`. This endpoint backs `/s/<album-slug>?p=<assetId>` deep links.

### Originals — `GET /s/api/o/:assetId?album=`

Allowed for an admin session, or when the asset's folder belongs to the album in
`album` **and** that album has `allowDownload:true`. Otherwise:

- no album and no admin session → `401 unauthorized`;
- asset outside the album scope → `403 forbidden`;
- album with `allowDownload:false` → `403 download_disabled`.

A link scoped to album A cannot fetch album B's original. Previews under
`/s/t/...1600.webp` are not gated. Hot cache wins when `hot_until > now()` and
`DATA_DIR/hot/<derivKey>` exists.

### ZIP — `POST /s/api/zip`

`{albumSlug,ids?,cam?}` → streamed `application/zip`, no temp file;
`allow_download=false` → `403 download_disabled`. Ids are optional and are
intersected with the album scope. Entry names are the original basenames,
de-duplicated. Whole-album ZIP is allowed; JSON endpoints never return a whole
album.

## Admin

- `GET /s/api/admin/status` → `{assets,pendingThumbs,pendingR2,r2Enabled,lastScanAt,errors24h}`.
  `pendingR2` is 0 unless `R2_MODE` is `s3`/`worker`.
- `GET/POST /s/api/admin/clients`, `PATCH/DELETE /s/api/admin/clients/:id`
- `GET/POST /s/api/admin/albums`, `PATCH/DELETE /s/api/admin/albums/:id`

`GET /s/api/admin/albums` returns the whole list in one statement (no per-album
follow-up calls):

```json
{
  "albums": [
    {
      "id": "10",
      "clientId": "1",
      "title": "Album A",
      "slug": "album-a",
      "allowDownload": true,
      "clientName": "Klien Demo",
      "clientSlug": "klien-demo",
      "folderCount": 1,
      "count": 2,
      "cameras": ["Cam 1", "Cam 2"],
      "covers": [
        { "id": "123", "thumb": "/s/t/<derivKey>/300.webp", "preview": "/s/t/<derivKey>/1600.webp", "mime": "image/jpeg", "w": 800, "h": 1200, "takenAt": "2024-05-01T02:00:00.000Z", "camera": "Cam 1", "thumbhash": "base64…", "original": "/s/api/o/123?album=album-a" }
      ]
    }
  ]
}
```

`count` is the number of live assets in the album's folder scope; `cameras` is
the sorted distinct camera list; `covers` is up to three newest assets (full
`asset` shape). `POST`/`PATCH` return the same album object with `count: 0`,
`cameras: []` and `covers: []`.
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

### Album folders

`GET /s/api/admin/albums/:id/folders`:

```json
{
  "folders": [
    { "folder_id": "20", "path": "Klien Demo/Album A", "recursive": true }
  ]
}
```

`POST /s/api/admin/albums/:id/folders` body `{folderId, recursive?}`. `recursive`
defaults to `true` (migration 004 and the API): a folder includes its whole
subtree, so `Cam N` subfolders are part of the album. Send `false` to select only
that one folder. Re-adding the same folder updates `recursive`.

### Folder tree node — `GET /s/api/admin/folders?parent=<id>`

```json
{
  "parent": {
    "id": "2",
    "path": "Klien Demo",
    "name": "Klien Demo",
    "parentId": "1",
    "assetCount": 0,
    "hasChildren": true
  },
  "folders": [
    {
      "id": "20",
      "path": "Klien Demo/Album A",
      "name": "Album A",
      "parentId": "2",
      "assetCount": 2,
      "hasChildren": true
    }
  ]
}
```

Folder node fields: `id`, `path` (POSIX path relative to the source root),
`name` (basename; the root `.` renders as `/`), `parentId` (`null` for the root),
`assetCount` (live assets directly in that folder), `hasChildren` (any child
folder, so the UI knows whether to offer a drill-down). `parent` is `null` only
when the root folder has not been scanned yet.

Slug rules: `^[a-z0-9-]{3,60}$`, one namespace shared by clients and albums.
Conflicts return `409 {error:"slug_conflict"}` with a BM message.

## Album folder rules (migration 006)

- `album_folder.included`: each row is a recursive rule; per folder the most specific rule wins (own row, else nearest ancestor). `album_scope(album_id)` / `folder_scope(ids, included, recursive)` return the in-scope folder ids.
- `GET /s/api/admin/albums/:id/folders` → `{ folders: [{ folderId, path, recursive, included }] }`
- `PUT /s/api/admin/albums/:id/folders` body `{ rules: [{ folderId, included }] }` → replaces all rules (transaction), returns `{ rules, assetCount, folderCount }`
- `POST /s/api/admin/scope-preview` body `{ rules }` → `{ assetCount, folderCount }` for unsaved rules
- `GET /s/api/admin/folders?parent=` nodes now carry `totalCount` (subtree photos)
- `GET /s/api/album/:slug/folders?folder=` → `{ folderId, trail, folders: [{ id, name, count, cover }], assetCount }`; a single top folder is the album top; excluded or empty folders are hidden (404 when asked for directly)
- `GET /s/api/bucket/f:<folderId>?album=<slug>` is public; the album scope still applies
- `GET /s/api/o/:id?album=<slug>&view=1` serves the original inline for viewer zoom even when the album's download is off

## Extra source folders (SOURCE_MOUNTS)

`SOURCE_MOUNTS=client-1month=/data/mounts/client-1month` adds a read-only folder as a virtual top-level folder of SOURCE_ROOT: its files are scanned as `client-1month/...`, show in the folder tree and album picker, and resolve back into the mount for thumbnails, originals and ZIPs. A real folder of the same name directly under SOURCE_ROOT is shadowed. Production mounts `/mnt/ssd/client-1month` there (`:ro`, container joins gid 33 www-data to read it).
