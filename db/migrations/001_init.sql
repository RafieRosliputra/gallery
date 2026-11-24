-- 001_init.sql — phase-1 schema, SPEC v2 § Data model.
-- Forward-only: never edit after it has been applied; add 002_*.sql instead.
--
-- Slug namespace: shared `slug_registry` table + triggers.
-- Why: one PRIMARY KEY across client+album is race-free under concurrent writes
-- without SERIALIZABLE, while client.slug / album.slug stay the source of truth.

CREATE TABLE folder (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path      text NOT NULL UNIQUE,
  parent_id bigint REFERENCES folder (id) ON DELETE CASCADE
);

CREATE TABLE asset (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path       text NOT NULL UNIQUE,
  folder_id  bigint NOT NULL REFERENCES folder (id) ON DELETE CASCADE,
  camera     text,
  size       bigint NOT NULL CHECK (size >= 0),
  mtime      timestamptz NOT NULL,
  sha1       text NOT NULL,
  taken_at   timestamptz,
  w          integer,
  h          integer,
  mime       text NOT NULL,
  thumbhash  bytea,
  thumb_ok   boolean NOT NULL DEFAULT false,
  r2_ok      boolean NOT NULL DEFAULT false,
  hot_until  timestamptz
);

CREATE INDEX asset_taken_at_id_idx ON asset (taken_at DESC, id);
CREATE INDEX asset_folder_id_taken_at_idx ON asset (folder_id, taken_at);
CREATE INDEX asset_camera_idx ON asset (camera);

CREATE TABLE client (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE album (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id      bigint NOT NULL REFERENCES client (id) ON DELETE CASCADE,
  title          text NOT NULL,
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  allow_download boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE album_folder (
  album_id  bigint NOT NULL REFERENCES album (id) ON DELETE CASCADE,
  folder_id bigint NOT NULL REFERENCES folder (id) ON DELETE CASCADE,
  recursive boolean NOT NULL DEFAULT false,
  PRIMARY KEY (album_id, folder_id)
);

CREATE TABLE admin (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL UNIQUE,
  pw_hash  text NOT NULL
);

CREATE TABLE slug_registry (
  slug       text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  kind       text NOT NULL CHECK (kind IN ('client', 'album')),
  ref_id     bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_id)
);

CREATE FUNCTION sync_slug_registry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  kind_name text := TG_ARGV[0];
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM slug_registry WHERE kind = kind_name AND ref_id = OLD.id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE slug_registry SET slug = NEW.slug WHERE kind = kind_name AND ref_id = NEW.id;
    RETURN NEW;
  ELSE
    INSERT INTO slug_registry (slug, kind, ref_id) VALUES (NEW.slug, kind_name, NEW.id);
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER client_slug_registry
AFTER INSERT OR UPDATE OF slug OR DELETE ON client
FOR EACH ROW EXECUTE FUNCTION sync_slug_registry('client');

CREATE TRIGGER album_slug_registry
AFTER INSERT OR UPDATE OF slug OR DELETE ON album
FOR EACH ROW EXECUTE FUNCTION sync_slug_registry('album');
