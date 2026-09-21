ALTER TABLE ai_settings ADD COLUMN cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK(cooldown_seconds BETWEEN 60 AND 3600);
ALTER TABLE ai_settings ADD COLUMN schedule_revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE ai_views (
 id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, source TEXT NOT NULL,
 visible INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE ai_project_schedule (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 last_started_at INTEGER, last_completed_at INTEGER,
 last_batch_size INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER, output_tokens INTEGER
);
