-- Reuse the existing roster. Accounts are explicitly linked; aliases from the
-- legacy activity pipeline never guess who authored a normalized PR.
ALTER TABLE developers ADD COLUMN source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('cli', 'demo'));
ALTER TABLE teams ADD COLUMN source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('cli', 'demo'));
ALTER TABLE tags ADD COLUMN source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('cli', 'demo'));

DROP INDEX idx_developers_alias_active;
CREATE UNIQUE INDEX idx_developers_alias_active ON developers (source, alias) WHERE archived_at IS NULL;
DROP INDEX idx_teams_name_active;
CREATE UNIQUE INDEX idx_teams_name_active ON teams (source, name) WHERE archived_at IS NULL;
DROP INDEX idx_tags_name_active;
CREATE UNIQUE INDEX idx_tags_name_active ON tags (source, name) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX developers_source_id ON developers (source, id);

CREATE TABLE developer_identities (
  source TEXT NOT NULL CHECK (source IN ('cli', 'demo')),
  identity_key TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('ado', 'github')),
  organization TEXT NOT NULL COLLATE NOCASE,
  actor_id TEXT NOT NULL,
  developer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  handle TEXT,
  avatar_url TEXT,
  last_seen_at INTEGER,
  PRIMARY KEY (source, identity_key),
  CHECK (identity_key = json_array(provider, lower(organization), actor_id)),
  FOREIGN KEY (source, developer_id) REFERENCES developers (source, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX developer_identity_account ON developer_identities (source, provider, organization, actor_id);
CREATE INDEX developer_identity_person ON developer_identities (developer_id);

-- Enforce the boundary even for legacy CRUD clients and direct SQL writes.
CREATE TRIGGER developer_teams_source_insert BEFORE INSERT ON developer_teams
WHEN (SELECT source FROM developers WHERE id = NEW.developer_id) != (SELECT source FROM teams WHERE id = NEW.team_id)
BEGIN SELECT RAISE(ABORT, 'Membership sources must match'); END;
CREATE TRIGGER developer_teams_source_update BEFORE UPDATE ON developer_teams
WHEN (SELECT source FROM developers WHERE id = NEW.developer_id) != (SELECT source FROM teams WHERE id = NEW.team_id)
BEGIN SELECT RAISE(ABORT, 'Membership sources must match'); END;
CREATE TRIGGER developer_tags_source_insert BEFORE INSERT ON developer_tags
WHEN (SELECT source FROM developers WHERE id = NEW.developer_id) != (SELECT source FROM tags WHERE id = NEW.tag_id)
BEGIN SELECT RAISE(ABORT, 'Membership sources must match'); END;
CREATE TRIGGER developer_tags_source_update BEFORE UPDATE ON developer_tags
WHEN (SELECT source FROM developers WHERE id = NEW.developer_id) != (SELECT source FROM tags WHERE id = NEW.tag_id)
BEGIN SELECT RAISE(ABORT, 'Membership sources must match'); END;
CREATE TRIGGER team_tags_source_insert BEFORE INSERT ON team_tags
WHEN (SELECT source FROM teams WHERE id = NEW.team_id) != (SELECT source FROM tags WHERE id = NEW.tag_id)
BEGIN SELECT RAISE(ABORT, 'Membership sources must match'); END;
CREATE TRIGGER team_tags_source_update BEFORE UPDATE ON team_tags
WHEN (SELECT source FROM teams WHERE id = NEW.team_id) != (SELECT source FROM tags WHERE id = NEW.tag_id)
BEGIN SELECT RAISE(ABORT, 'Membership sources must match'); END;

-- Only explicit module refreshes write here. Reads, PR scans, navigation and
-- passing time cannot alter a module's saved calculation or its timestamp.
CREATE TABLE pr_stat_snapshots (
  source TEXT NOT NULL CHECK (source IN ('cli', 'demo')),
  module TEXT NOT NULL CHECK (module IN ('overview', 'trend', 'members', 'repositories')),
  filter_key TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  PRIMARY KEY (source, module, filter_key)
);
CREATE INDEX pull_requests_created_cohort ON pull_requests (project_id, json_extract(snapshot, '$.createdAt'));
