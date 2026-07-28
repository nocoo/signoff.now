-- 0010: tags on teams, mirroring the developer_tags table from 0001.
--
-- `developer_tags` has existed since the first migration but nothing ever read
-- or wrote it. This migration does not change that table; it adds the team
-- equivalent so both entities can carry tags, and the application layer starts
-- using both.
--
-- Same shape as developer_tags on purpose: composite primary key (so a repeated
-- selection is a no-op rather than a duplicate row) and ON DELETE CASCADE from
-- both sides (a hard-deleted tag or team leaves no dangling links). Archiving
-- is a soft delete and does NOT cascade — an archived tag keeps its links so
-- restoring it brings them back.

CREATE TABLE team_tags (
	team_id TEXT NOT NULL,
	tag_id TEXT NOT NULL,
	created_at INTEGER NOT NULL DEFAULT (unixepoch()),
	PRIMARY KEY (team_id, tag_id),
	FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
	FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

-- Mirrors idx_developer_tags_tag: the "which entities carry this tag" lookup
-- would otherwise scan the whole table.
CREATE INDEX idx_team_tags_tag ON team_tags (tag_id, team_id);
