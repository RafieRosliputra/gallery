-- 005_requeue.sql — self-healing job queue.
-- Jobs lost during redeploys left assets with thumb_ok = false and nothing queued.
-- The reconciler (apps/server/src/jobs/reconcile.ts) re-feeds them in batches,
-- using these columns to avoid double-queueing and to stop retrying broken files.

ALTER TABLE asset ADD COLUMN thumb_queued_at timestamptz;
ALTER TABLE asset ADD COLUMN thumb_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE asset ADD COLUMN r2_queued_at timestamptz;

CREATE INDEX asset_thumb_feed_idx ON asset (taken_at DESC NULLS LAST, id)
  WHERE thumb_ok = false AND deleted_at IS NULL;
