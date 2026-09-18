-- Existing PR caches remain readable. Nothing is implicitly observed on upgrade.
CREATE TABLE pr_observations (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL UNIQUE,
  activation_token TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('cli','demo')),
  project_id TEXT NOT NULL,
  ref_json TEXT NOT NULL CHECK(json_valid(ref_json)),
  pull_id TEXT,
  generation INTEGER NOT NULL CHECK(generation > 0),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  added_at INTEGER NOT NULL,
  stopped_at INTEGER,
  stop_reason TEXT CHECK(stop_reason IN ('manual','completed','abandoned','project_deleted','scope_changed')),
  CHECK((active = 1 AND stopped_at IS NULL AND stop_reason IS NULL) OR (active = 0 AND stopped_at IS NOT NULL AND stop_reason IS NOT NULL))
);
CREATE INDEX pr_observations_active ON pr_observations(source,project_id,active);

CREATE TABLE workbench_repositories (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  project_external_id TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(aliases_json)),
  last_discovered_at INTEGER,
  discovery_state TEXT NOT NULL DEFAULT 'not_collected' CHECK(discovery_state IN ('not_collected','legacy','complete','failed')),
  discovery_message TEXT,
  PRIMARY KEY(project_id,repository_id)
);
INSERT INTO workbench_repositories(project_id,repository_id,name,aliases_json,discovery_state)
SELECT project_id, repository_id, json_extract(snapshot,'$.repository.name'),
  json_array(repository_id,json_extract(snapshot,'$.repository.name')), 'legacy'
FROM pull_requests GROUP BY project_id,repository_id;

ALTER TABLE pull_requests ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pull_requests ADD COLUMN published_at INTEGER;
UPDATE pull_requests SET published_at = json_extract(snapshot,'$.observedAt');

-- Jobs deliberately do not cascade with project deletion: their receipts must remain queryable.
CREATE TABLE collection_jobs_next (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  source TEXT NOT NULL DEFAULT 'cli' CHECK(source IN ('cli','demo')),
  project_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(project_json)),
  state TEXT NOT NULL CHECK(state IN ('queued','running','auth_required','complete','partial','failed','canceled')),
  requested_at INTEGER NOT NULL,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  completed_pulls INTEGER NOT NULL DEFAULT 0 CHECK(completed_pulls >= 0),
  total_pulls INTEGER CHECK(total_pulls IS NULL OR total_pulls >= 0),
  message TEXT NOT NULL DEFAULT '',
  lease_token TEXT,
  lease_expires_at INTEGER,
  pull_ids_json TEXT CHECK(pull_ids_json IS NULL OR json_valid(pull_ids_json)),
  kind TEXT NOT NULL DEFAULT 'full' CHECK(kind IN ('list','details','full')),
  round_id TEXT,
  scope_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(scope_json)),
  scope_key TEXT NOT NULL DEFAULT '*',
  observation_id TEXT,
  observation_generation INTEGER,
  not_before INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  repositories_resolved INTEGER NOT NULL DEFAULT 0 CHECK(repositories_resolved IN (0,1)),
  cancel_reason TEXT,
  error_kind TEXT
);
INSERT INTO collection_jobs_next(id,project_id,revision,source,state,requested_at,started_at,updated_at,completed_at,completed_pulls,total_pulls,message,pull_ids_json,kind,round_id,cancel_reason)
SELECT j.id,j.project_id,j.revision,p.source,
  CASE WHEN j.state IN ('queued','running','auth_required') THEN 'canceled' ELSE j.state END,
  j.requested_at,j.started_at,j.updated_at,COALESCE(j.completed_at,j.updated_at),j.completed_pulls,j.total_pulls,
  CASE WHEN j.state IN ('queued','running','auth_required') THEN 'Upgrade: select PRs to watch before refreshing checks' ELSE j.message END,
  j.pull_ids_json,j.kind,j.round_id,
  CASE WHEN j.state IN ('queued','running','auth_required') THEN 'watchlist_upgrade' ELSE NULL END
FROM collection_jobs j JOIN projects p ON p.id=j.project_id;
DROP TABLE collection_staging;
DROP TABLE collection_jobs;
ALTER TABLE collection_jobs_next RENAME TO collection_jobs;
CREATE INDEX collection_jobs_project_updated ON collection_jobs(project_id,updated_at DESC);
CREATE INDEX collection_jobs_round ON collection_jobs(round_id,state);
CREATE UNIQUE INDEX collection_jobs_one_running ON collection_jobs(project_id) WHERE state='running';
CREATE UNIQUE INDEX collection_jobs_one_scan ON collection_jobs(project_id,revision,kind,scope_key)
  WHERE kind IN ('list','full') AND state IN ('queued','running','auth_required');
CREATE UNIQUE INDEX collection_jobs_one_observation ON collection_jobs(observation_id,observation_generation)
  WHERE observation_id IS NOT NULL AND state IN ('queued','running','auth_required');

CREATE TABLE collection_staging (
  job_id TEXT NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
  pull_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('open','merged','closed')),
  updated_at INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  PRIMARY KEY(job_id,pull_id)
);
CREATE TABLE collection_claim_bindings (
  job_id TEXT NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
  pull_id TEXT NOT NULL,
  snapshot_version INTEGER NOT NULL,
  observation_id TEXT,
  generation INTEGER,
  PRIMARY KEY(job_id,pull_id)
);
CREATE TABLE collection_job_repositories (
  job_id TEXT NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  project_external_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','canceled')),
  pull_count INTEGER,
  message TEXT,
  publication_token TEXT,
  PRIMARY KEY(job_id,repository_id)
);
CREATE TABLE collection_project_rounds (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  round_id TEXT,
  last_completed_at INTEGER
);
UPDATE collection_refresh SET cooldown_seconds=CASE WHEN kind='list' THEN 0 ELSE cooldown_seconds END,
  round_id=NULL,refresh_requested=0,foreground_until=0,view_id='',view_sequence=0,page_key='',pull_ids_json='[]';

CREATE TABLE workbench_revisions (
  source TEXT PRIMARY KEY CHECK(source IN ('cli','demo')),
  revision INTEGER NOT NULL DEFAULT 1
);
INSERT INTO workbench_revisions(source) VALUES('cli'),('demo');

-- Database fences apply equally to web, CLI, project CRUD and late collector responses.
CREATE TRIGGER observation_stopped AFTER UPDATE OF active ON pr_observations
WHEN OLD.active=1 AND NEW.active=0 BEGIN
  UPDATE collection_jobs SET state='canceled',cancel_reason=CASE NEW.stop_reason
    WHEN 'manual' THEN 'observation_removed' WHEN 'project_deleted' THEN 'project_deleted'
    WHEN 'scope_changed' THEN 'scope_changed' ELSE 'observation_retired' END,
    completed_at=NEW.stopped_at,updated_at=NEW.stopped_at,lease_token=NULL,lease_expires_at=NULL
  WHERE observation_id=NEW.id AND observation_generation=NEW.generation AND state IN ('queued','running','auth_required');
END;
CREATE TRIGGER collection_canceled AFTER UPDATE OF state ON collection_jobs
WHEN NEW.state='canceled' AND OLD.state<>NEW.state BEGIN
  UPDATE collection_job_repositories SET state='canceled' WHERE job_id=NEW.id AND state IN ('queued','running');
  DELETE FROM collection_staging WHERE job_id=NEW.id;
END;
CREATE TRIGGER project_observations_deleted BEFORE DELETE ON projects BEGIN
  UPDATE pr_observations SET active=0,stopped_at=unixepoch(),stop_reason='project_deleted',pull_id=NULL
    WHERE project_id=OLD.id AND active=1;
  UPDATE pr_observations SET pull_id=NULL WHERE project_id=OLD.id AND pull_id IS NOT NULL;
  UPDATE collection_jobs SET state='canceled',cancel_reason='project_deleted',completed_at=unixepoch(),updated_at=unixepoch(),lease_token=NULL,lease_expires_at=NULL
    WHERE project_id=OLD.id AND state IN ('queued','running','auth_required');
END;
CREATE TRIGGER collection_finished AFTER UPDATE OF state ON collection_jobs
WHEN NEW.state IN ('complete','partial','failed') AND OLD.state='running' BEGIN
  INSERT INTO scan_runs(id,project_id,source,state,started_at,completed_at,pull_request_count,advanced_stages,message)
    SELECT NEW.id,NEW.project_id,NEW.source,NEW.state,COALESCE(NEW.started_at,NEW.requested_at),NEW.completed_at,NEW.completed_pulls,0,NEW.message
    WHERE EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND revision=NEW.revision AND source=NEW.source)
    ON CONFLICT(id) DO NOTHING;
  UPDATE projects SET last_scanned_at=NEW.completed_at,scan_state=NEW.state,scan_message=NEW.message
    WHERE id=NEW.project_id AND revision=NEW.revision AND source=NEW.source;
END;
CREATE TRIGGER project_observations_changed AFTER UPDATE OF revision ON projects
WHEN NEW.revision<>OLD.revision BEGIN
  UPDATE pr_observations SET active=0,stopped_at=NEW.updated_at,stop_reason='scope_changed'
  WHERE project_id=NEW.id AND active=1 AND (
    NEW.source<>OLD.source OR NEW.provider<>OLD.provider OR lower(NEW.organization)<>lower(OLD.organization)
    OR lower(NEW.project_key)<>lower(OLD.project_key)
    OR (json_array_length(NEW.repositories_json)>0 AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.repositories_json) scope WHERE lower(scope.value) IN (
        lower(json_extract(pr_observations.ref_json,'$.repository.id')),lower(json_extract(pr_observations.ref_json,'$.repository.name'))
      )
    ))
  );
  UPDATE collection_jobs SET state='canceled',cancel_reason=CASE WHEN NEW.repositories_json<>OLD.repositories_json
    OR NEW.source<>OLD.source OR NEW.provider<>OLD.provider OR lower(NEW.organization)<>lower(OLD.organization)
    OR lower(NEW.project_key)<>lower(OLD.project_key) THEN 'scope_changed' ELSE 'project_changed' END,
    completed_at=NEW.updated_at,updated_at=NEW.updated_at,lease_token=NULL,lease_expires_at=NULL
  WHERE project_id=NEW.id AND revision<>NEW.revision AND state IN ('queued','running','auth_required');
  DELETE FROM workbench_repositories WHERE project_id=NEW.id AND (NEW.source<>OLD.source OR NEW.provider<>OLD.provider
    OR lower(NEW.organization)<>lower(OLD.organization) OR lower(NEW.project_key)<>lower(OLD.project_key)
    OR (json_array_length(NEW.repositories_json)>0 AND NOT EXISTS (
      SELECT 1 FROM json_each(NEW.repositories_json) s WHERE lower(s.value) IN (lower(workbench_repositories.name),lower(workbench_repositories.repository_id))
    )));
END;

CREATE TRIGGER pr_version AFTER UPDATE OF snapshot ON pull_requests WHEN OLD.snapshot<>NEW.snapshot BEGIN
  UPDATE pull_requests SET version=OLD.version+1 WHERE id=NEW.id;
END;
CREATE TRIGGER pr_catalog_insert AFTER INSERT ON pull_requests BEGIN
  INSERT INTO workbench_repositories(project_id,repository_id,name,aliases_json)
    VALUES(NEW.project_id,NEW.repository_id,json_extract(NEW.snapshot,'$.repository.name'),json_array(NEW.repository_id,json_extract(NEW.snapshot,'$.repository.name')))
    ON CONFLICT(project_id,repository_id) DO NOTHING;
END;
CREATE TRIGGER pr_observation_deleted AFTER DELETE ON pull_requests BEGIN
  UPDATE pr_observations SET pull_id=NULL WHERE pull_id=OLD.id;
END;

-- Conservative source-wide cursors: every actual data change invalidates later pages.
CREATE TRIGGER project_revision_insert AFTER INSERT ON projects BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=NEW.source;
END;
CREATE TRIGGER project_revision_update AFTER UPDATE ON projects
WHEN NEW.name<>OLD.name OR NEW.organization<>OLD.organization OR NEW.project_key<>OLD.project_key
  OR NEW.provider<>OLD.provider OR NEW.source<>OLD.source OR NEW.revision<>OLD.revision
  OR NEW.readiness_revision<>OLD.readiness_revision OR NEW.merge_requirements_json<>OLD.merge_requirements_json
  OR NEW.last_scanned_at IS NOT OLD.last_scanned_at OR NEW.scan_state<>OLD.scan_state OR NEW.scan_message IS NOT OLD.scan_message
BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source IN (NEW.source,OLD.source);
END;
CREATE TRIGGER project_revision_delete BEFORE DELETE ON projects BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=OLD.source;
END;
CREATE TRIGGER pr_revision_insert AFTER INSERT ON pull_requests BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=(SELECT source FROM projects WHERE id=NEW.project_id);
END;
CREATE TRIGGER pr_revision_update AFTER UPDATE OF snapshot,published_at ON pull_requests
WHEN NEW.snapshot<>OLD.snapshot OR NEW.published_at IS NOT OLD.published_at BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=(SELECT source FROM projects WHERE id=NEW.project_id);
END;
CREATE TRIGGER pr_revision_delete AFTER DELETE ON pull_requests BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=(SELECT source FROM projects WHERE id=OLD.project_id);
END;
CREATE TRIGGER repository_revision_insert AFTER INSERT ON workbench_repositories BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=(SELECT source FROM projects WHERE id=NEW.project_id);
END;
CREATE TRIGGER repository_revision_update AFTER UPDATE ON workbench_repositories
WHEN NEW.name<>OLD.name OR NEW.aliases_json<>OLD.aliases_json OR NEW.project_external_id IS NOT OLD.project_external_id
  OR NEW.last_discovered_at IS NOT OLD.last_discovered_at OR NEW.discovery_state<>OLD.discovery_state OR NEW.discovery_message IS NOT OLD.discovery_message BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=(SELECT source FROM projects WHERE id=NEW.project_id);
END;
CREATE TRIGGER repository_revision_delete AFTER DELETE ON workbench_repositories BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=(SELECT source FROM projects WHERE id=OLD.project_id);
END;
CREATE TRIGGER observation_revision_insert AFTER INSERT ON pr_observations BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=NEW.source;
END;
CREATE TRIGGER observation_revision_update AFTER UPDATE ON pr_observations
WHEN NEW.active<>OLD.active OR NEW.generation<>OLD.generation OR NEW.ref_json<>OLD.ref_json OR NEW.pull_id IS NOT OLD.pull_id BEGIN
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=NEW.source;
END;
