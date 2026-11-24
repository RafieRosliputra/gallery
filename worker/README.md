# Cloudflare Worker — `johorstudio.com/s/*`

Live since 2026-11-25. Routes come from `wrangler.jsonc`:

- `johorstudio.com/s` and `johorstudio.com/s/*`
- `GET /s/t/<derivKey>/<size>.webp` → R2 (`GALLERY`) else origin (Fastify local
  fallback), immutable cache.
- `PUT /s/_r2/<derivKey>/<size>.webp` → R2, requires `X-Upload-Secret`.
- everything else → origin through the Workers VPC binding `ORIGIN`
  (`app:3000` over the `johorstudio-gallery` tunnel), with `X-Origin-Secret`.

There is **no public origin hostname**. `ORIGIN` is a VPC service binding.

## Secrets (never committed; `wrangler secret put`)

```sh
npx wrangler secret put UPLOAD_SECRET   # must equal the NAS UPLOAD_SECRET
npx wrangler secret put ORIGIN_SECRET   # must equal the NAS ORIGIN_SECRET
```

## Test

```sh
npm ci
npm run typecheck
npm test        # builds with esbuild, runs miniflare (R2 + service binding)
```

Miniflare's stable runtime predates the deployed compatibility date
(`2026-11-01`), so the test harness caps it at `2026-08-06`; the handler uses no
newer runtime feature.

## Deploy (Rafi approves every live change)

```sh
npx wrangler deploy
```

`wrangler.jsonc` keeps the live service id and R2 bucket. Do not add a public
route for the origin.
