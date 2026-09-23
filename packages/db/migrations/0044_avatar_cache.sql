CREATE TABLE avatar_cache (
  source TEXT NOT NULL CHECK (source IN ('cli', 'demo')),
  url TEXT NOT NULL,
  organization TEXT NOT NULL,
  content_type TEXT,
  body BLOB,
  etag TEXT,
  fetched_at INTEGER,
  due_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at INTEGER,
  PRIMARY KEY (source, url)
);
CREATE INDEX avatar_cache_due ON avatar_cache(source, due_at, lease_expires_at);

INSERT INTO avatar_cache(source, url, organization)
SELECT p.source, json_extract(pr.snapshot, '$.author.avatarUrl'), p.organization
FROM pull_requests pr JOIN projects p ON p.id=pr.project_id
WHERE p.provider='ado' AND json_extract(pr.snapshot, '$.author.avatarUrl') IS NOT NULL ON CONFLICT(source,url) DO NOTHING;
INSERT INTO avatar_cache(source, url, organization)
SELECT p.source, json_extract(r.value, '$.avatarUrl'), p.organization
FROM pull_requests pr JOIN projects p ON p.id=pr.project_id, json_each(pr.snapshot, '$.reviewers') r
WHERE p.provider='ado' AND json_extract(r.value, '$.avatarUrl') IS NOT NULL ON CONFLICT(source,url) DO NOTHING;
INSERT INTO avatar_cache(source, url, organization)
SELECT source, avatar_url, organization FROM developer_identities
WHERE provider='ado' AND avatar_url IS NOT NULL ON CONFLICT(source,url) DO NOTHING;

CREATE TRIGGER pull_request_avatar_insert AFTER INSERT ON pull_requests BEGIN
  INSERT INTO avatar_cache(source, url, organization)
  SELECT p.source, json_extract(NEW.snapshot, '$.author.avatarUrl'), p.organization FROM projects p
  WHERE p.id=NEW.project_id AND p.provider='ado' AND json_extract(NEW.snapshot, '$.author.avatarUrl') IS NOT NULL ON CONFLICT(source,url) DO NOTHING;
  INSERT INTO avatar_cache(source, url, organization)
  SELECT p.source, json_extract(r.value, '$.avatarUrl'), p.organization FROM projects p, json_each(NEW.snapshot, '$.reviewers') r
  WHERE p.id=NEW.project_id AND p.provider='ado' AND json_extract(r.value, '$.avatarUrl') IS NOT NULL ON CONFLICT(source,url) DO NOTHING;
END;
CREATE TRIGGER pull_request_avatar_update AFTER UPDATE OF snapshot ON pull_requests BEGIN
  INSERT INTO avatar_cache(source, url, organization)
  SELECT p.source, json_extract(NEW.snapshot, '$.author.avatarUrl'), p.organization FROM projects p
  WHERE p.id=NEW.project_id AND p.provider='ado' AND json_extract(NEW.snapshot, '$.author.avatarUrl') IS NOT NULL ON CONFLICT(source,url) DO NOTHING;
  INSERT INTO avatar_cache(source, url, organization)
  SELECT p.source, json_extract(r.value, '$.avatarUrl'), p.organization FROM projects p, json_each(NEW.snapshot, '$.reviewers') r
  WHERE p.id=NEW.project_id AND p.provider='ado' AND json_extract(r.value, '$.avatarUrl') IS NOT NULL ON CONFLICT(source,url) DO NOTHING;
END;
CREATE TRIGGER identity_avatar_insert AFTER INSERT ON developer_identities WHEN NEW.provider='ado' AND NEW.avatar_url IS NOT NULL BEGIN
  INSERT INTO avatar_cache(source, url, organization) VALUES(NEW.source,NEW.avatar_url,NEW.organization) ON CONFLICT(source,url) DO NOTHING;
END;
CREATE TRIGGER identity_avatar_update AFTER UPDATE OF avatar_url ON developer_identities WHEN NEW.provider='ado' AND NEW.avatar_url IS NOT NULL BEGIN
  INSERT INTO avatar_cache(source, url, organization) VALUES(NEW.source,NEW.avatar_url,NEW.organization) ON CONFLICT(source,url) DO NOTHING;
END;
