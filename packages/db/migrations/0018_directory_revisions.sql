-- A directory edit covers both sides of a membership. One revision per source
-- detects stale editors, including changes made through the legacy roster APIs.
-- ponytail: source-wide conflicts suit a small roster; use entity revisions if
-- simultaneous editing becomes frequent.
CREATE TABLE directory_revisions (
  source TEXT PRIMARY KEY CHECK (source IN ('cli', 'demo')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO directory_revisions (source) VALUES ('cli'), ('demo');

CREATE TRIGGER developers_revision_insert AFTER INSERT ON developers
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source = NEW.source;
END;
CREATE TRIGGER developers_revision_update AFTER UPDATE ON developers
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source IN (OLD.source, NEW.source);
END;
CREATE TRIGGER developers_revision_delete AFTER DELETE ON developers
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source = OLD.source;
END;

CREATE TRIGGER teams_revision_insert AFTER INSERT ON teams
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source = NEW.source;
END;
CREATE TRIGGER teams_revision_update AFTER UPDATE ON teams
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source IN (OLD.source, NEW.source);
END;
CREATE TRIGGER teams_revision_delete AFTER DELETE ON teams
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source = OLD.source;
END;

CREATE TRIGGER tags_revision_insert AFTER INSERT ON tags
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source = NEW.source;
END;
CREATE TRIGGER tags_revision_update AFTER UPDATE ON tags
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source IN (OLD.source, NEW.source);
END;
CREATE TRIGGER tags_revision_delete AFTER DELETE ON tags
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source = OLD.source;
END;

CREATE TRIGGER developer_identities_revision_insert AFTER INSERT ON developer_identities
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source = NEW.source;
END;
CREATE TRIGGER developer_identities_revision_update AFTER UPDATE ON developer_identities
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source IN (OLD.source, NEW.source);
END;
CREATE TRIGGER developer_identities_revision_delete AFTER DELETE ON developer_identities
BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source = OLD.source;
END;

CREATE TRIGGER developer_teams_revision_insert AFTER INSERT ON developer_teams
BEGIN
  UPDATE directory_revisions SET revision = revision + 1
  WHERE source IN (SELECT source FROM developers WHERE id = NEW.developer_id);
END;
CREATE TRIGGER developer_teams_revision_update AFTER UPDATE ON developer_teams
BEGIN
  UPDATE directory_revisions SET revision = revision + 1
  WHERE source IN (SELECT source FROM developers WHERE id IN (OLD.developer_id, NEW.developer_id));
END;
CREATE TRIGGER developer_teams_revision_delete AFTER DELETE ON developer_teams
BEGIN
  UPDATE directory_revisions SET revision = revision + 1
  WHERE source IN (SELECT source FROM developers WHERE id = OLD.developer_id);
END;

CREATE TRIGGER developer_tags_revision_insert AFTER INSERT ON developer_tags
BEGIN
  UPDATE directory_revisions SET revision = revision + 1
  WHERE source IN (SELECT source FROM developers WHERE id = NEW.developer_id);
END;
CREATE TRIGGER developer_tags_revision_update AFTER UPDATE ON developer_tags
BEGIN
  UPDATE directory_revisions SET revision = revision + 1
  WHERE source IN (SELECT source FROM developers WHERE id IN (OLD.developer_id, NEW.developer_id));
END;
CREATE TRIGGER developer_tags_revision_delete AFTER DELETE ON developer_tags
BEGIN
  UPDATE directory_revisions SET revision = revision + 1
  WHERE source IN (SELECT source FROM developers WHERE id = OLD.developer_id);
END;

CREATE TRIGGER team_tags_revision_insert AFTER INSERT ON team_tags
BEGIN
  UPDATE directory_revisions SET revision = revision + 1
  WHERE source IN (SELECT source FROM teams WHERE id = NEW.team_id);
END;
CREATE TRIGGER team_tags_revision_update AFTER UPDATE ON team_tags
BEGIN
  UPDATE directory_revisions SET revision = revision + 1
  WHERE source IN (SELECT source FROM teams WHERE id IN (OLD.team_id, NEW.team_id));
END;
CREATE TRIGGER team_tags_revision_delete AFTER DELETE ON team_tags
BEGIN
  UPDATE directory_revisions SET revision = revision + 1
  WHERE source IN (SELECT source FROM teams WHERE id = OLD.team_id);
END;
