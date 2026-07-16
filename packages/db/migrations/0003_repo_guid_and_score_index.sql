-- 0003_repo_guid_and_score_index.sql
-- - Global unique (provider, external_id) including archived rows (GUID reserved forever)
-- - ADO active+enabled repos must have external_id (CHECK)
-- - Cross-developer score range index (config_version, day_key, developer_id)
--
-- Rebuilds repos (and activities which FK to repos). Safe when activities empty;
-- if activities exist they are preserved via temp copy.

-- ---------------------------------------------------------------------------
-- Preserve activities while rebuilding repos (FK parent)
-- ---------------------------------------------------------------------------
CREATE TABLE activities_backup AS
SELECT
	*
FROM
	activities;

DROP TABLE activities;

-- ---------------------------------------------------------------------------
-- Rebuild repos with stronger identity rules
-- ---------------------------------------------------------------------------
CREATE TABLE repos_new (
	id TEXT PRIMARY KEY NOT NULL,
	provider TEXT NOT NULL DEFAULT 'ado' CHECK (provider IN ('ado', 'github')),
	org TEXT NOT NULL,
	project TEXT NOT NULL,
	name TEXT NOT NULL,
	remote_url TEXT,
	external_id TEXT,
	enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	created_at INTEGER NOT NULL DEFAULT (unixepoch()),
	updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
	archived_at INTEGER,
	-- Active ADO repos must carry a stable repository GUID
	CHECK (
		archived_at IS NOT NULL
		OR enabled = 0
		OR provider != 'ado'
		OR (
			external_id IS NOT NULL
			AND length(trim(external_id)) > 0
		)
	)
);

INSERT INTO
	repos_new (
		id,
		provider,
		org,
		project,
		name,
		remote_url,
		external_id,
		enabled,
		created_at,
		updated_at,
		archived_at
	)
SELECT
	id,
	provider,
	org,
	project,
	name,
	remote_url,
	external_id,
	enabled,
	created_at,
	updated_at,
	archived_at
FROM
	repos;

DROP TABLE repos;

ALTER TABLE repos_new
RENAME TO repos;

CREATE UNIQUE INDEX idx_repos_provider_coord_active ON repos (provider, org, project, name)
WHERE
	archived_at IS NULL;

-- Global uniqueness: archived GUID stays reserved; re-enable must UPDATE old row
CREATE UNIQUE INDEX idx_repos_provider_external_id ON repos (provider, external_id)
WHERE
	external_id IS NOT NULL;

CREATE INDEX idx_repos_enabled ON repos (enabled);

-- ---------------------------------------------------------------------------
-- Restore activities (same shape as 0002)
-- ---------------------------------------------------------------------------
CREATE TABLE activities (
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
	meta_json TEXT CHECK (
		meta_json IS NULL
		OR json_valid(meta_json)
	),
	ingested_at INTEGER NOT NULL DEFAULT (unixepoch()),
	FOREIGN KEY (developer_id) REFERENCES developers (id) ON DELETE RESTRICT,
	FOREIGN KEY (repo_id) REFERENCES repos (id) ON DELETE RESTRICT
);

INSERT INTO
	activities
SELECT
	*
FROM
	activities_backup;

DROP TABLE activities_backup;

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
-- Cross-developer score scans by version + day range
-- ---------------------------------------------------------------------------
CREATE INDEX idx_scores_config_day_dev ON scores (config_version, day_key, developer_id);
