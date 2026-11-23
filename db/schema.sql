CREATE TABLE IF NOT EXISTS azusa_workspace_snapshots (
  key_hash text PRIMARY KEY,
  snapshot jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
