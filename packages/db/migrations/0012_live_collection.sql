-- Live CLI collection: repository scope, jobs, staging, and collector heartbeat.
ALTER TABLE projects ADD COLUMN repositories_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(repositories_json) AND json_type(repositories_json) = 'array');

CREATE TABLE collection_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'auth_required', 'complete', 'partial', 'failed')),
  requested_at INTEGER NOT NULL,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  completed_pulls INTEGER NOT NULL DEFAULT 0 CHECK (completed_pulls >= 0),
  total_pulls INTEGER CHECK (total_pulls IS NULL OR total_pulls >= 0),
  message TEXT NOT NULL DEFAULT '',
  lease_token TEXT,
  lease_expires_at INTEGER
);
CREATE INDEX collection_jobs_project_updated ON collection_jobs(project_id, updated_at DESC);
CREATE UNIQUE INDEX collection_jobs_one_active ON collection_jobs(project_id)
  WHERE state IN ('queued', 'running', 'auth_required');

CREATE TABLE collection_staging (
  job_id TEXT NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
  pull_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'merged', 'closed')),
  updated_at INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  PRIMARY KEY (job_id, pull_id)
);
CREATE INDEX collection_staging_job ON collection_staging(job_id);

CREATE TABLE collector_heartbeat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_seen_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ready', 'auth_required', 'error')),
  message TEXT NOT NULL
);
