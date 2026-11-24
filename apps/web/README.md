# @gallery/web

SvelteKit SPA for the admin gallery and the public client portal/album, served
by Fastify under `/s` (SPEC § API).

## Build & serve contract

```sh
VITE_MOCKS=1 npm run build -w @gallery/web   # CI/e2e build (MSW fixtures)
npm run build -w @gallery/web                # production build (no MSW)
```

- Output: `apps/web/build/` (`index.html` fallback + `_app/` + static logos).
- Fastify serves `WEB_DIR` (default `apps/web/build`; Docker sets
  `/app/apps/web/build`) at `/s`, returns `build/index.html` for unmatched
  `GET /s/*` so the client router owns `/s/<slug>`, `/s/admin/...`, query-string
  overlays (`?p=`, `?fav=1`, `?share=1`) and deep links, and 404s unknown
  `/s/api/*`, `/s/t/*`, `/s/_r2/*` paths instead of falling back.
- Hashed `_app/immutable/*` files are cached `immutable` for a year;
  `index.html` is `no-cache`; other static files get one hour.
- API calls are same-origin under `/s/api/*`; they are registered before the
  static wildcard. The wire contract is `packages/shared/src/index.ts`
  (phase 1c).
  `src/lib/api/client.ts` adapts it into the UI view models in
  `src/lib/api/models.ts` (nullable dimensions, single cover, month keys).
- `paths.base` is `/s`; every asset URL is emitted under `/s/_app/...`.

### CSP

The UI uses no inline `style=""` attributes (only Svelte `style:` directives,
which set CSSOM properties). SvelteKit does emit an inline bootstrap script into
the SPA fallback, so `svelte.config.js` sets `kit.csp.mode = 'hash'`: the build
writes a strict `<meta http-equiv="content-security-policy">` with that script's
SHA-256 (no `unsafe-inline`). Fastify copies that exact value into a
`Content-Security-Policy` response header for `index.html`.

```
default-src 'self';
script-src 'self' 'sha256-…';
style-src 'self';
font-src 'self';
img-src 'self' data: blob: https://cdn.johorstudio.com;
connect-src 'self';
worker-src 'self';   # only when serving a VITE_MOCKS build
object-src 'none'; base-uri 'self'; form-action 'self';
```

`data:` is for thumbhash placeholders; `blob:` for downloads/previews if the
server returns blob URLs. Production builds contain no MSW code. Playwright runs
with `bypassCSP` only so the screenshot helper can inject a no-transition style;
the built pages keep the CSP.

## Layout

`src/lib/layout/justified.ts` is a ~70-line Flickr-style row algorithm. Compare:
`justified-layout` (Flickr, MIT) computes every box in one call and has had no
release since 2019; the local algorithm works per month bucket, is unit-tested
for "fills width, never crops, last row capped", and keeps the bundle small.
Rows use the real `w/h` from the API; target heights are 200 px desktop and
130 px phone, with 4 px / 2 px gaps.

## Routing semantics

- Album opened from that client's portal **in this tab** → `← <client>`.
  Direct URL / new tab → no back link (sessionStorage marker, `lib/routing/back.ts`).
- Viewer is `?p=<assetId>`; browser back closes it. Arrow keys and horizontal
  swipe step; Escape closes.
- Favourites live in `localStorage` under `gallery:fav:<albumSlug>` and are
  never sent to the server except as explicit ZIP ids.
- All download UI is removed when `allow_download = false`.

## Tests

```sh
npm run check -w @gallery/web      # svelte-check (0 warnings)
npm run test -w @gallery/web       # vitest: layout, favourites, guards, back
npm run test:e2e -w @gallery/web   # Playwright; build with VITE_MOCKS=1 first
```

Playwright serves the built app through `vite preview` (127.0.0.1:4173), runs a
phone smoke (portal → album → viewer → back → portal, 390×844) and writes
route screenshots to `test-results/screenshots/` for the CI artifact.
MSW is started only when `VITE_MOCKS=1` at build time.

## Integration notes

- Auth is `/s/api/auth/login|logout|session` (httpOnly cookie, path `/s`).
  The admin layout probes `/auth/session`; 401 redirects to `/s?next=…`.
- Admin album cards use `GET /s/api/admin/albums`, which already returns
  `count`, `cameras` and up to three `covers`; the client no longer fans out per
  album.
- Folder navigation is id-based (`/admin/folders?parent=<id>`). The edit tree
  auto-expands the first two levels; deeper levels need a lazy expand control.
- Direct viewer links (`/s/<album>?p=<assetId>`) call
  `GET /s/api/asset/:id?album=<slug>`, with the same scope rules as originals.
- `GET /s/api/admin/status` exposes assets/pending/lastScan; the dashboard's
  hot-cache, RAM and log cards render `—`/derived values until those optional
  fields exist.
