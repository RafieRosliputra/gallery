-- 008_descriptions.sql — free text shown under a client's and an album's title.
-- Forward-only: never edit after it has been applied; add 009_*.sql instead.
ALTER TABLE client ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE album ADD COLUMN description text NOT NULL DEFAULT '';
