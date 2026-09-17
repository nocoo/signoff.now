-- PR workbench: provider-neutral project identities and normalized PR snapshots.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('ado', 'github')),
  name TEXT NOT NULL,
  organization TEXT NOT NULL COLLATE NOCASE,
  project_key TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('demo', 'cli')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_scanned_at INTEGER,
  scan_state TEXT NOT NULL DEFAULT 'never' CHECK (scan_state IN ('never', 'complete', 'partial', 'failed')),
  scan_message TEXT,
  UNIQUE (provider, organization, project_key)
);

CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'merged', 'closed')),
  updated_at INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  UNIQUE (project_id, repository_id, external_id)
);
CREATE INDEX pull_requests_project_updated ON pull_requests(project_id, updated_at DESC);

CREATE TABLE scan_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('demo', 'cli')),
  state TEXT NOT NULL CHECK (state IN ('complete', 'partial', 'failed')),
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  pull_request_count INTEGER NOT NULL,
  advanced_stages INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL
);
CREATE INDEX scan_runs_project_completed ON scan_runs(project_id, completed_at DESC);
