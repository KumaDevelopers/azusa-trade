CREATE TABLE IF NOT EXISTS azusa_workspace_snapshots (
  key_hash text PRIMARY KEY,
  snapshot jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS azusa_admin_sessions (
  id_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS azusa_admin_sessions_expiry ON azusa_admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS azusa_admin_login_limits (
  client_hash text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
