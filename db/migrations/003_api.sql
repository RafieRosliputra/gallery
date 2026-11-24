-- 003_api.sql — phase-1c auth sessions, login rate limiting, API lookup indexes.
-- Forward-only: never edit after it has been applied; add 004_*.sql instead.

-- Sessions are server-side: only sha256(token) is stored, never the raw cookie.
CREATE TABLE admin_session (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash   text NOT NULL UNIQUE,
  admin_id     bigint NOT NULL REFERENCES admin (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text,
  user_agent   text
);

CREATE INDEX admin_session_expires_at_idx ON admin_session (expires_at);
CREATE INDEX admin_session_admin_id_idx ON admin_session (admin_id);

-- Login throttling: 5 failures per 15 minutes per IP (checked in the API layer).
CREATE TABLE login_failure (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip         text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_failure_ip_created_at_idx ON login_failure (ip, created_at DESC);

-- Album scope walks folder subtrees, album CRUD lists children, and the admin
-- timeline pages assets per folder.
CREATE INDEX album_folder_folder_id_idx ON album_folder (folder_id);
CREATE INDEX folder_parent_id_idx ON folder (parent_id);
CREATE INDEX asset_folder_page_idx ON asset (folder_id, taken_at DESC, id DESC)
  WHERE deleted_at IS NULL;
