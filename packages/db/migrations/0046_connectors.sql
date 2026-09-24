-- Remote connectors (docs/23 M2). A connector belongs to one person and
-- authenticates with a hashed bearer token issued from the browser login.
CREATE TABLE connectors (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL CHECK (owner GLOB 'email:?*' OR owner GLOB 'service:?*'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  platform TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  state TEXT CHECK (state IS NULL OR state IN ('ready', 'auth_required', 'error')),
  message TEXT NOT NULL DEFAULT '',
  capabilities_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(capabilities_json)),
  revoked_at INTEGER
);
CREATE INDEX connectors_owner ON connectors (owner, revoked_at);

-- The person whose connector refreshes a project. NULL until assigned.
ALTER TABLE projects ADD COLUMN data_owner TEXT
  CHECK (data_owner IS NULL OR data_owner GLOB 'email:?*' OR data_owner GLOB 'service:?*');
CREATE INDEX projects_data_owner ON projects (data_owner);

-- The connector holding a lease; NULL for trusted local collectors.
ALTER TABLE collection_jobs ADD COLUMN lease_connector_id TEXT;
