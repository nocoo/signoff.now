-- Only successful repository discovery establishes a cursor. Existing cached
-- snapshots may be partial or individually watched, so migration never infers it.
ALTER TABLE workbench_repositories ADD COLUMN discovery_cursor_json TEXT
  CHECK(discovery_cursor_json IS NULL OR json_valid(discovery_cursor_json));
-- Freeze the starting cursor with the repository plan across retries/reclaims.
ALTER TABLE collection_job_repositories ADD COLUMN discovery_cursor_json TEXT
  CHECK(discovery_cursor_json IS NULL OR json_valid(discovery_cursor_json));
ALTER TABLE collection_jobs ADD COLUMN full_discovery INTEGER NOT NULL DEFAULT 0
  CHECK(full_discovery IN (0,1));
