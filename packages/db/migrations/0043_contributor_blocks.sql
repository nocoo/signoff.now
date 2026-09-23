CREATE TABLE contributor_blocks (
  source TEXT NOT NULL CHECK (source IN ('cli', 'demo')),
  contributor_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (source, contributor_key)
);

CREATE TRIGGER contributor_blocks_revision_insert AFTER INSERT ON contributor_blocks BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source = NEW.source;
END;
CREATE TRIGGER contributor_blocks_revision_delete AFTER DELETE ON contributor_blocks BEGIN
  UPDATE directory_revisions SET revision = revision + 1 WHERE source = OLD.source;
END;

CREATE TRIGGER contributor_identity_block_insert AFTER INSERT ON developer_identities BEGIN
  INSERT OR IGNORE INTO contributor_blocks(source, contributor_key)
  SELECT NEW.source, 'member:' || NEW.developer_id
  WHERE EXISTS (SELECT 1 FROM contributor_blocks WHERE source = NEW.source AND contributor_key = 'identity:' || NEW.identity_key);
  INSERT OR IGNORE INTO contributor_blocks(source, contributor_key)
  SELECT source, 'identity:' || identity_key FROM developer_identities
  WHERE source = NEW.source AND developer_id = NEW.developer_id
  AND EXISTS (SELECT 1 FROM contributor_blocks WHERE source = NEW.source AND contributor_key = 'member:' || NEW.developer_id);
END;

CREATE TRIGGER contributor_identity_block_update AFTER UPDATE OF source, identity_key, developer_id ON developer_identities BEGIN
  INSERT OR IGNORE INTO contributor_blocks(source, contributor_key)
  SELECT NEW.source, 'member:' || NEW.developer_id
  WHERE EXISTS (SELECT 1 FROM contributor_blocks WHERE source = NEW.source AND contributor_key = 'identity:' || NEW.identity_key);
  INSERT OR IGNORE INTO contributor_blocks(source, contributor_key)
  SELECT source, 'identity:' || identity_key FROM developer_identities
  WHERE source = NEW.source AND developer_id = NEW.developer_id
  AND EXISTS (SELECT 1 FROM contributor_blocks WHERE source = NEW.source AND contributor_key = 'member:' || NEW.developer_id);
END;
