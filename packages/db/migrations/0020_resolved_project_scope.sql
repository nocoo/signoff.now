-- SQLite lower() does not fold Unicode. The project command resolves names and
-- aliases to retained provider IDs in JavaScript, guarded by revision + catalog.
-- Bind the decision to this one revision transition; raw/legacy writes retain
-- the previous conservative checks instead of reusing an old resolution.
ALTER TABLE projects ADD COLUMN scope_resolution_json TEXT
  CHECK(scope_resolution_json IS NULL OR json_valid(scope_resolution_json));

DROP TRIGGER project_observations_changed;
CREATE TRIGGER project_observations_changed AFTER UPDATE OF revision ON projects
WHEN NEW.revision<>OLD.revision BEGIN
  UPDATE pr_observations SET active=0,stopped_at=NEW.updated_at,stop_reason='scope_changed'
  WHERE project_id=NEW.id AND active=1 AND (NEW.source<>OLD.source OR CASE
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
