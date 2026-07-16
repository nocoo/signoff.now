-- 0002_correctness_and_indexes.sql
-- Address schema correctness blockers without rewriting 0001.
-- - Soft-delete (archived_at) + RESTRICT FKs for historical rows
-- - config_version on activities/scores + settings keys for stale/recompute
-- - Stable external_ref conventions documented in 02 (GUID/revision based)
-- - Reverse M2M indexes, activity time index, repos (provider, external_id)
-- - json_valid() CHECKs on JSON columns
--
-- Safe on empty business tables; preserves settings rows.

-- ---------------------------------------------------------------------------
-- Soft-delete columns
-- ---------------------------------------------------------------------------
ALTER TABLE developers ADD COLUMN archived_at INTEGER;
ALTER TABLE teams ADD COLUMN archived_at INTEGER;
ALTER TABLE tags ADD COLUMN archived_at INTEGER;
ALTER TABLE repos ADD COLUMN archived_at INTEGER;

-- Alias uniqueness only among active developers
DROP INDEX IF EXISTS idx_developers_alias;
CREATE UNIQUE INDEX idx_developers_alias_active ON developers (alias)
WHERE
	archived_at IS NULL;

DROP INDEX IF EXISTS idx_teams_name;
CREATE UNIQUE INDEX idx_teams_name_active ON teams (name)
WHERE
	archived_at IS NULL;

DROP INDEX IF EXISTS idx_tags_name;
CREATE UNIQUE INDEX idx_tags_name_active ON tags (name)
WHERE
	archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Repos: stable external identity + soft-delete friendly uniqueness
-- ---------------------------------------------------------------------------
-- Name coordinates remain unique among active rows; external_id unique when set
DROP INDEX IF EXISTS idx_repos_provider_coord;
CREATE UNIQUE INDEX idx_repos_provider_coord_active ON repos (provider, org, project, name)
WHERE
	archived_at IS NULL;

CREATE UNIQUE INDEX idx_repos_provider_external_id ON repos (provider, external_id)
WHERE
	external_id IS NOT NULL
	AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Reverse M2M indexes (Team/Tag → developers filter)
-- ---------------------------------------------------------------------------
CREATE INDEX idx_developer_teams_team ON developer_teams (team_id, developer_id);
CREATE INDEX idx_developer_tags_tag ON developer_tags (tag_id, developer_id);

-- ---------------------------------------------------------------------------
-- Rebuild activities: RESTRICT FKs + config_version + better indexes
-- (Business table expected empty in phase-0; no data migration needed.)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS activities;

CREATE TABLE activities (
	id TEXT PRIMARY KEY NOT NULL,
	developer_id TEXT NOT NULL,
	type TEXT NOT NULL,
	occurred_at INTEGER NOT NULL,
	-- Natural day under pipeline_config that was active at ingest/recompute
	day_key TEXT NOT NULL,
	-- Settings.pipeline_config_version used when day_key was derived
	config_version INTEGER NOT NULL,
	provider TEXT NOT NULL DEFAULT 'ado' CHECK (provider IN ('ado', 'github')),
	org TEXT NOT NULL,
	project TEXT NOT NULL,
	repo_id TEXT,
	-- Stable idempotency key (GUID / revision / thread based — see docs/02 §5)
	external_ref TEXT NOT NULL,
	matched_unique_name TEXT,
	meta_json TEXT CHECK (
		meta_json IS NULL
		OR json_valid(meta_json)
	),
	ingested_at INTEGER NOT NULL DEFAULT (unixepoch()),
	FOREIGN KEY (developer_id) REFERENCES developers (id) ON DELETE RESTRICT,
	FOREIGN KEY (repo_id) REFERENCES repos (id) ON DELETE RESTRICT
);

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

-- ---------------------------------------------------------------------------
-- Rebuild scores: config_version + json_valid breakdown
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS scores;

CREATE TABLE scores (
	developer_id TEXT NOT NULL,
	day_key TEXT NOT NULL,
	config_version INTEGER NOT NULL,
	total INTEGER NOT NULL DEFAULT 0,
	breakdown_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(breakdown_json)),
	activity_count INTEGER NOT NULL DEFAULT 0,
	computed_at INTEGER NOT NULL DEFAULT (unixepoch()),
	PRIMARY KEY (developer_id, day_key),
	FOREIGN KEY (developer_id) REFERENCES developers (id) ON DELETE RESTRICT
);

CREATE INDEX idx_scores_day ON scores (day_key);
CREATE INDEX idx_scores_config_version ON scores (config_version);

-- ---------------------------------------------------------------------------
-- Settings: json_valid + pipeline config version / stale flags
-- ---------------------------------------------------------------------------
CREATE TABLE settings_new (
	key TEXT PRIMARY KEY NOT NULL,
	value TEXT NOT NULL CHECK (json_valid(value)),
	updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO
	settings_new (key, value, updated_at)
SELECT
	key,
	value,
	updated_at
FROM
	settings;

DROP TABLE settings;

ALTER TABLE settings_new
RENAME TO settings;

-- Monotonic version: bump when timezone or activity_weights change (app responsibility)
INSERT INTO
	settings (key, value, updated_at)
VALUES
	-- Bump when timezone or activity_weights change (application responsibility)
	('pipeline_config_version', '1', unixepoch()),
	-- true after config change until full recompute completes
	('scores_stale', 'false', unixepoch()),
	-- JSON string reason for UI, or null
	('scores_stale_reason', 'null', unixepoch()) ON CONFLICT (key) DO NOTHING;
