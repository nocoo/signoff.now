-- 0006: ingest_runs state machine, ingest_chunks, activities.source_ids_json
-- Guard: both ingest_runs and activities must be empty (no DEFAULT '{}' poison).

CREATE TABLE _mig_0006_guard (n INTEGER NOT NULL CHECK (n = 0));

INSERT INTO
	_mig_0006_guard (n)
SELECT
	COUNT(*)
FROM
	ingest_runs;

INSERT INTO
	_mig_0006_guard (n)
SELECT
	COUNT(*)
FROM
	activities;

DROP TABLE _mig_0006_guard;

-- ---------------------------------------------------------------------------
-- Rebuild ingest_runs
-- ---------------------------------------------------------------------------
CREATE TABLE ingest_runs_new (
	id TEXT PRIMARY KEY NOT NULL,
	started_at INTEGER NOT NULL,
	finished_at INTEGER,
	status TEXT NOT NULL CHECK (status IN ('chunked', 'finalized', 'failed')),
	config_version INTEGER NOT NULL,
	mode TEXT NOT NULL CHECK (mode IN ('incremental', 'full_rematch')),
	run_meta_json TEXT NOT NULL CHECK (json_valid(run_meta_json)),
	stats_json TEXT,
	error_message TEXT
);

DROP TABLE ingest_runs;

ALTER TABLE ingest_runs_new
RENAME TO ingest_runs;

CREATE INDEX idx_ingest_runs_started ON ingest_runs (started_at);

-- ---------------------------------------------------------------------------
-- ingest_chunks
-- ---------------------------------------------------------------------------
CREATE TABLE ingest_chunks (
	run_id TEXT NOT NULL,
	chunk_index INTEGER NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('prepared', 'completed')),
	digest TEXT NOT NULL,
	dev_day_union_json TEXT NOT NULL CHECK (json_valid(dev_day_union_json)),
	finished_at INTEGER,
	PRIMARY KEY (run_id, chunk_index),
	FOREIGN KEY (run_id) REFERENCES ingest_runs (id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Rebuild activities with source_ids_json (table empty by guard)
-- ---------------------------------------------------------------------------
CREATE TABLE activities_new (
	id TEXT PRIMARY KEY NOT NULL,
	developer_id TEXT NOT NULL,
	type TEXT NOT NULL,
	occurred_at INTEGER NOT NULL,
	day_key TEXT NOT NULL,
	config_version INTEGER NOT NULL,
	provider TEXT NOT NULL DEFAULT 'ado' CHECK (provider IN ('ado', 'github')),
	org TEXT NOT NULL,
	project TEXT NOT NULL,
	repo_id TEXT,
	external_ref TEXT NOT NULL,
	matched_unique_name TEXT,
	source_ids_json TEXT NOT NULL CHECK (json_valid(source_ids_json)),
	meta_json TEXT CHECK (
		meta_json IS NULL
		OR json_valid(meta_json)
	),
	ingested_at INTEGER NOT NULL DEFAULT (unixepoch()),
	FOREIGN KEY (developer_id) REFERENCES developers (id) ON DELETE RESTRICT,
	FOREIGN KEY (repo_id) REFERENCES repos (id) ON DELETE RESTRICT
);

DROP TABLE activities;

ALTER TABLE activities_new
RENAME TO activities;

CREATE UNIQUE INDEX idx_activities_external_ref ON activities (external_ref);

CREATE INDEX idx_activities_developer_day ON activities (developer_id, day_key);

CREATE INDEX idx_activities_developer_day_occ ON activities (
	developer_id,
	day_key DESC,
	occurred_at DESC
);

CREATE INDEX idx_activities_day ON activities (day_key);

CREATE INDEX idx_activities_type ON activities (type);

CREATE INDEX idx_activities_org_project ON activities (org, project);

CREATE INDEX idx_activities_config_version ON activities (config_version);
