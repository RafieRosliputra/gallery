# deploy

- `truenas-compose.yaml` — TrueNAS SCALE custom app: Postgres 16, app (migrations
  + Fastify), jobs (pg-boss worker), cloudflared. No host ports; every secret is
  a `${VAR}` placeholder.
- `RUNBOOK.md` — tunnel, secrets, first app, first admin, first scan, rollback.

The Cloudflare Worker lives in `../worker/`. Rafi approves every change to DNS,
routes or the live app.
