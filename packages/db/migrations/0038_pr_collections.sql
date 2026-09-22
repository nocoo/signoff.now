CREATE TABLE pr_collections (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('cli','demo')),
  name TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source,name)
);
CREATE TABLE pr_collection_members (
  collection_id TEXT NOT NULL REFERENCES pr_collections(id) ON DELETE CASCADE,
  pull_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY(collection_id,pull_id)
);
CREATE INDEX pr_collection_members_pull ON pr_collection_members(pull_id,collection_id);
CREATE TRIGGER pr_collection_scope BEFORE INSERT ON pr_collection_members
WHEN NOT EXISTS (
  SELECT 1 FROM pr_collections c JOIN pull_requests pr ON pr.id=NEW.pull_id
  JOIN projects p ON p.id=pr.project_id WHERE c.id=NEW.collection_id AND c.source=p.source
) BEGIN
  SELECT RAISE(ABORT,'Collection and PR sources must match');
END;
CREATE TRIGGER pr_collection_changed AFTER UPDATE ON pr_collections BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=NEW.source;
END;
CREATE TRIGGER pr_collection_deleted BEFORE DELETE ON pr_collections BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=OLD.source;
END;
CREATE TRIGGER pr_collection_member_added AFTER INSERT ON pr_collection_members BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=(SELECT source FROM pr_collections WHERE id=NEW.collection_id);
END;
CREATE TRIGGER pr_collection_member_removed AFTER DELETE ON pr_collection_members BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=(SELECT source FROM pr_collections WHERE id=OLD.collection_id);
END;
