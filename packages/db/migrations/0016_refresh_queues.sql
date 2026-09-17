-- Independent queues own whole rounds; only configuration edits advance project revisions.
ALTER TABLE collection_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'full'
  CHECK (kind IN ('list', 'details', 'full'));
UPDATE collection_jobs SET kind = CASE WHEN pull_ids_json IS NULL THEN 'full'
  WHEN json_array_length(pull_ids_json) = 0 THEN 'list' ELSE 'details' END;
ALTER TABLE collection_jobs ADD COLUMN round_id TEXT;
DROP INDEX collection_jobs_one_active;
-- Queue multiple PRs, but serialize publication for each project.
CREATE UNIQUE INDEX collection_jobs_one_running ON collection_jobs(project_id) WHERE state = 'running';
CREATE UNIQUE INDEX collection_jobs_one_scan ON collection_jobs(project_id, kind)
  WHERE kind IN ('list', 'full') AND state IN ('queued', 'running', 'auth_required');
CREATE INDEX collection_jobs_round ON collection_jobs(round_id, state);

CREATE TABLE collection_refresh (
  kind TEXT PRIMARY KEY CHECK (kind IN ('list', 'details')),
  cooldown_seconds INTEGER NOT NULL CHECK (cooldown_seconds IN (0, 60, 120, 300, 600)),
  last_completed_at INTEGER,
  round_id TEXT,
  refresh_requested INTEGER NOT NULL DEFAULT 0 CHECK (refresh_requested IN (0, 1)),
  foreground_until INTEGER NOT NULL DEFAULT 0,
  view_id TEXT NOT NULL DEFAULT '',
  view_sequence INTEGER NOT NULL DEFAULT 0,
  page_key TEXT NOT NULL DEFAULT '',
  pull_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(pull_ids_json) AND json_type(pull_ids_json) = 'array')
);
INSERT INTO collection_refresh (kind, cooldown_seconds) VALUES ('list', 120), ('details', 300);
