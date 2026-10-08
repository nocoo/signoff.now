ALTER TABLE collection_claim_bindings ADD COLUMN observation_active INTEGER NOT NULL DEFAULT 1 CHECK(observation_active IN (0,1));

ALTER TABLE workbench_repositories DROP COLUMN discovery_cursor_json;
ALTER TABLE collection_job_repositories DROP COLUMN discovery_cursor_json;

DROP TRIGGER project_observations_changed;
CREATE TRIGGER project_observations_changed AFTER UPDATE OF revision ON projects
WHEN NEW.revision<>OLD.revision BEGIN
  UPDATE pr_observations SET active=0,stopped_at=NEW.updated_at,stop_reason='scope_changed'
  WHERE project_id=NEW.id AND (active=1 OR stop_reason IN ('completed','abandoned')) AND (NEW.source<>OLD.source OR CASE
    WHEN json_extract(NEW.scope_resolution_json,'$.revision')=NEW.revision
      AND json_extract(NEW.scope_resolution_json,'$.previousRevision')=OLD.revision
    THEN json_extract(NEW.scope_resolution_json,'$.identityChanged')=1
      OR (json_extract(NEW.scope_resolution_json,'$.restricted')=1 AND
        json_extract(ref_json,'$.repository.id') NOT IN (SELECT value FROM json_each(NEW.scope_resolution_json,'$.repositoryIds')))
    ELSE NEW.provider<>OLD.provider OR lower(NEW.organization)<>lower(OLD.organization)
      OR lower(NEW.project_key)<>lower(OLD.project_key)
      OR (json_array_length(NEW.repositories_json)>0 AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.repositories_json) s WHERE lower(s.value) IN (
          lower(json_extract(pr_observations.ref_json,'$.repository.id')),lower(json_extract(pr_observations.ref_json,'$.repository.name')))))
    END);
  UPDATE collection_jobs SET state='canceled',cancel_reason=CASE WHEN NEW.source<>OLD.source OR CASE
    WHEN json_extract(NEW.scope_resolution_json,'$.revision')=NEW.revision
      AND json_extract(NEW.scope_resolution_json,'$.previousRevision')=OLD.revision
    THEN json_extract(NEW.scope_resolution_json,'$.scopeChanged')=1
    ELSE NEW.repositories_json<>OLD.repositories_json OR NEW.provider<>OLD.provider
      OR lower(NEW.organization)<>lower(OLD.organization) OR lower(NEW.project_key)<>lower(OLD.project_key)
    END THEN 'scope_changed' ELSE 'project_changed' END,
    completed_at=NEW.updated_at,updated_at=NEW.updated_at,lease_token=NULL,lease_expires_at=NULL
  WHERE project_id=NEW.id AND revision<>NEW.revision AND state IN ('queued','running','auth_required');
  DELETE FROM workbench_repositories WHERE project_id=NEW.id AND (NEW.source<>OLD.source OR CASE
    WHEN json_extract(NEW.scope_resolution_json,'$.revision')=NEW.revision
      AND json_extract(NEW.scope_resolution_json,'$.previousRevision')=OLD.revision
    THEN json_extract(NEW.scope_resolution_json,'$.identityChanged')=1
      OR (json_extract(NEW.scope_resolution_json,'$.restricted')=1 AND
        repository_id NOT IN (SELECT value FROM json_each(NEW.scope_resolution_json,'$.repositoryIds')))
    ELSE NEW.provider<>OLD.provider OR lower(NEW.organization)<>lower(OLD.organization)
      OR lower(NEW.project_key)<>lower(OLD.project_key)
      OR (json_array_length(NEW.repositories_json)>0 AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.repositories_json) s WHERE lower(s.value) IN (lower(workbench_repositories.name),lower(workbench_repositories.repository_id))))
    END);
END;

DROP TRIGGER project_observations_deleted;
CREATE TRIGGER project_observations_deleted BEFORE DELETE ON projects BEGIN
  UPDATE pr_observations SET active=0,stopped_at=unixepoch(),stop_reason='project_deleted',pull_id=NULL
    WHERE project_id=OLD.id AND (active=1 OR stop_reason IN ('completed','abandoned'));
  UPDATE pr_observations SET pull_id=NULL WHERE project_id=OLD.id AND pull_id IS NOT NULL;
  UPDATE collection_jobs SET state='canceled',cancel_reason='project_deleted',completed_at=unixepoch(),updated_at=unixepoch(),lease_token=NULL,lease_expires_at=NULL
    WHERE project_id=OLD.id AND state IN ('queued','running','auth_required');
END;
