-- 004_album_folder_recursive_default.sql — album folders include subfolders
-- (Cam N) unless the caller explicitly opts out. Forward-only: never edit.
ALTER TABLE album_folder ALTER COLUMN recursive SET DEFAULT true;
