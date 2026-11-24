# Runbook — johorstudio-gallery on TrueNAS (`tnas`)

> Phase 1c. Never run builds, experiments or destructive commands on `tnas`.
> Every secret below is set by Rafi in the UI/CLI and is never committed.
> The Cloudflare Worker is already live at `johorstudio.com/s/*`; this runbook
> covers the NAS side, the first admin, the first scan and rollback.

## 1. Prerequisites

- TrueNAS SCALE with the datasets:
  - `/mnt/a/studio` — source photos, mounted **read-only**.
  - `/mnt/ssd/johorstudio-gallery/app` — thumbs, hot cache (writable).
  - `/mnt/ssd/johorstudio-gallery/pg` — Postgres 16 data (writable).
- Image already published by CI: `ghcr.io/rafierosliputra/gallery:<sha>` (+ `:latest`).
- Cloudflare tunnel named `johorstudio-gallery`, token available (Rafi's vault).
- Worker VPC service binding points at host `app:3000` (no public hostname).

## 2. Create the tunnel (once)

On a machine with `cloudflared` (not necessarily `tnas`):

```sh
cloudflared tunnel create johorstudio-gallery
cloudflared tunnel token johorstudio-gallery   # paste into TUNNEL_TOKEN, never git
```

In Cloudflare Zero Trust → Networks → Tunnels, attach the tunnel to the Workers
VPC service used by `worker/wrangler.jsonc` (`vpc_services[0].service_id`) and
route private host `app:3000` to this compose stack. Do **not** create a public
hostname for the origin: the Worker is the only public entry point.

## 3. Set secrets and environment

Copy `deploy/truenas-compose.yaml` into the TrueNAS custom app (Apps → Custom
App) and fill every `${VAR}` from the app environment. A local render check:

```sh
docker compose -f deploy/truenas-compose.yaml config
```

Required values:

| variable | source |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | new strong password |
| `DATABASE_URL` | `postgres://<user>:<pass>@db:5432/<db>` |
| `ORIGIN_SECRET` | same value as the Worker secret `ORIGIN_SECRET` |
| `R2_MODE` | `worker` (recommended) · `s3` · `off` |
| `UPLOAD_SECRET` | same value as the Worker secret `UPLOAD_SECRET` (worker mode) |
| `WORKER_UPLOAD_URL` | `https://johorstudio.com/s/_r2` |
| `THUMB_BASE` | `/s/t` (or the R2 CDN URL later) |
| `R2_*` | only for `R2_MODE=s3`; not needed for `worker` |
| `TUNNEL_TOKEN` | from step 2 |
| `SCAN_INTERVAL_MIN` | `10` (0 disables periodic scans) |
| `SCAN_EXCLUDE` | `immich,@eaDir,#recycle,.Recycle.Bin` |
| `TIMEZONE` | `Asia/Kuala_Lumpur` |

Worker secrets (already live; rotate only with Rafi's approval):

```sh
cd worker
npx wrangler secret put UPLOAD_SECRET
npx wrangler secret put ORIGIN_SECRET
```

`ORIGIN_SECRET` must match the app env; with it set, Fastify rejects every
request that did not come through the Worker (health is exempt).

## 4. Create the app

> The live app is managed by CLAUDE via `midclt app.update`; the UI path below
> stays for reference.

- **UI:** Apps → Discover → Custom App → paste `deploy/truenas-compose.yaml`
  and its environment → Install.
- **midclt:** on `tnas`, submit the same rendered compose through
  `midclt call app.create`, using the payload schema reported by the installed
  TrueNAS version (the Apps UI exposes the same fields). Do not hand-write a
  different payload.

The `app` service runs migrations before the HTTP server:

```sh
node apps/server/dist/migrate-cli.js && node apps/server/dist/index.js
```

The `jobs` service runs `node apps/server/dist/worker-cli.js` (thumbnails + R2
uploads) with `mem_limit: 768m`. No host ports are published.

Wait for the `app` healthcheck, then verify from inside the app network:

```sh
docker exec -it <app-container> node -e "fetch('http://127.0.0.1:3000/s/api/health').then(r=>r.text()).then(console.log)"
# {"ok":true,"version":"...","db":"up"}
```

## 5. First admin

Password is read from stdin, never argv and never logged:

```sh
docker exec -it <app-container> node apps/server/dist/admin-cli.js rafi
# Kata laluan: ********
```

Open `https://johorstudio.com/s`, log in, confirm `GET /s/api/auth/session`
returns the admin and that `/s/api/admin/status` is reachable.

## 6. First scan

The server starts one scan immediately when `SCAN_INTERVAL_MIN > 0` and then
every N minutes. Either wait, press **Rescan** in admin, or run:

```sh
docker exec -it <app-container> node apps/server/dist/scan-cli.js
```

Then check `/s/api/admin/status`: `assets > 0`, `pendingThumbs` draining,
`pendingR2` draining only when `r2Enabled` is true. `immich` under the source
is excluded by default and any old rows under an excluded directory are
soft-deleted on the next pass.

If thumbnails stay pending, check the `jobs` container:

```sh
docker logs --tail 100 <jobs-container>
```

## 7. Rollback

1. **App/image only:** redeploy the previous immutable tag, e.g. set
   `GALLERY_TAG=<previous-sha>` (or the full image in compose) and restart
   `app` + `jobs`. `:latest` is not a rollback target.
2. **Worker:** redeploy the previous commit (`cd worker && npx wrangler deploy`).
   Secrets are unchanged.
3. **Database:** migrations are forward-only. Never edit an applied migration.
   If a schema change is incompatible with the older image, stop `app`/`jobs`,
   restore the `pg` dataset from the pre-deploy snapshot, then start the older
   image. Never delete the `pg` dataset.
4. After any rollback: verify `/s/api/health`, login, one album page, one
   thumbnail, and one download.

## 8. Incident notes

- App rejects direct traffic with 403 when `ORIGIN_SECRET` is set — that is
  expected; requests must come through `johorstudio.com/s/*`.
- R2 `worker` mode keeps R2 credentials out of the NAS; the Worker stores
  derivatives through `PUT /s/_r2/t/<derivKey>/<size>.webp`.
- If the Worker is up but the app is down, thumbnails still come from R2 and
  pages return the BM 502 page.
