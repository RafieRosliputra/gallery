# @gallery/web

SvelteKit SPA for the admin gallery and the public client portal/album, served
by Fastify under `/s` (SPEC § API).

## Build & serve contract

```sh
VITE_MOCKS=1 npm run build -w @gallery/web   # CI/e2e build (MSW fixtures)
npm run build -w @gallery/web                # production build (no MSW)
```

- Output: `apps/web/build/` (`index.html` fallback + `_app/` + static logos).
- Fastify must serve `apps/web/build` at `/s` and return `build/index.html` for
  unmatched `GET /s/*` so the client router owns `/s/<slug>`, `/s/admin/...`,
  query-string overlays (`?p=`, `?fav=1`, `?share=1`) and deep links.
- API calls are same-origin under `/s/api/*`; route them before the static
  fallback. The typed contract is `packages/shared/src/api.ts`.
- `paths.base` is `/s`; every asset URL is emitted under `/s/_app/...`.

### CSP

The UI uses no inline `style=""` attributes (only Svelte `style:` directives,
which set CSSOM properties) and no inline scripts. Needed for the strict CSP:

```
default-src 'self';
script-src 'self';
style-src 'self';
font-src 'self';
img-src 'self' data: blob: https://cdn.johorstudio.com;
connect-src 'self';
worker-src 'self';   # only when serving a VITE_MOCKS build
```

`data:` is for thumbhash placeholders; `blob:` for downloads/previews if the
server returns blob URLs. Production builds contain no MSW code.

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

## Assumptions for phase 1c (OPEN-Q)

- `/s/api/admin/status` doubles as the session probe (401 → login).
- Added UI-only endpoints/shapes marked `ASSUME` in `packages/shared/src/api.ts`:
  `GET /s/api/asset/:id` (direct viewer links), admin album/folder list shapes,
  `POST /s/api/admin/clients`, `POST /s/api/admin/rescan`, and optional covers
  and dashboard extras. The base SPEC endpoints are unchanged.
