-- 009_album_sort.sql — photo order inside an album's folders.
-- Forward-only: never edit after it has been applied; add 010_*.sql instead.
-- name = file name A→Z (default), taken = time taken oldest first,
-- taken_desc = time taken newest first.
ALTER TABLE album ADD COLUMN sort text NOT NULL DEFAULT 'name'
  CHECK (sort IN ('name', 'taken', 'taken_desc'));
CREATE INDEX asset_folder_name_idx ON asset (folder_id, path, id) WHERE deleted_at IS NULL;
