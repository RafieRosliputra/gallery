-- 002_ingest.sql — scan bookkeeping + derivative key + soft delete.
-- Forward-only: never edit after it has been applied; add 003_*.sql instead.
--
-- DRIFT (SPEC v2 Data model said `asset.sha1`): full-file hashing on a 500k-photo
-- HDD is too slow. The derivative key is sha1(relPath + size + mtimeMs) and names
-- DATA_DIR/thumbs/<key>/ and the R2 key. The original file is never hashed.

ALTER TABLE asset ADD COLUMN deriv_key text;
ALTER TABLE asset ADD COLUMN deleted_at timestamptz;
ALTER TABLE asset ADD COLUMN scanned_at timestamptz NOT NULL DEFAULT now();

-- No rows exist before the scanner lands, but keep the copy for safety.
UPDATE asset SET deriv_key = sha1 WHERE deriv_key IS NULL;
ALTER TABLE asset ALTER COLUMN deriv_key SET NOT NULL;
ALTER TABLE asset DROP COLUMN sha1;

-- Thumbhash is stored base64 (SPEC keeps the column; the wire format is base64).
ALTER TABLE asset ALTER COLUMN thumbhash TYPE text USING encode(thumbhash, 'base64');

CREATE UNIQUE INDEX asset_deriv_key_idx ON asset (deriv_key);
CREATE INDEX asset_deleted_at_idx ON asset (deleted_at);
CREATE INDEX asset_thumb_pending_idx ON asset (id)
  WHERE thumb_ok = false AND deleted_at IS NULL;
CREATE INDEX asset_r2_pending_idx ON asset (id)
  WHERE thumb_ok = true AND r2_ok = false AND deleted_at IS NULL;

-- One row per scanner pass so `lastScanAt` survives across processes.
CREATE TABLE scan_run (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  scanned     integer NOT NULL DEFAULT 0,
  added       integer NOT NULL DEFAULT 0,
  changed     integer NOT NULL DEFAULT 0,
  unchanged   integer NOT NULL DEFAULT 0,
  deleted     integer NOT NULL DEFAULT 0,
  errors      integer NOT NULL DEFAULT 0
);

CREATE INDEX scan_run_finished_at_idx ON scan_run (finished_at DESC);

-- Bounded error feed for the status page (`errors24h`).
CREATE TABLE job_error (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source     text NOT NULL,
  message    text NOT NULL,
  asset_id   bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX job_error_created_at_idx ON job_error (created_at DESC);
