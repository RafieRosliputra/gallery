-- 007_folder_moves.sql — record folders the scanner saw move.
-- Forward-only: never edit after it has been applied; add 008_*.sql instead.
--
-- When a file disappears from one path and the same file (same name, size and
-- mtime) shows up at another, the scanner keeps the asset row (id, thumbnails,
-- favourites) and moves it. Whole folders that moved are logged here, and album
-- rules on the old folder are pointed at the new one.
CREATE TABLE folder_move (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_path  text NOT NULL,
  to_path    text NOT NULL,
  assets     integer NOT NULL,
  albums     integer NOT NULL DEFAULT 0,
  moved_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX folder_move_moved_at_idx ON folder_move (moved_at DESC);
CREATE INDEX asset_size_mtime_idx ON asset (size, mtime);
