-- 0004_repo_project_guid.sql
-- Add ADO project GUID on repos (nullable; backfill later via Web CRUD).
-- Used by WI external_ref: ado:wi:{projectGuid}:{wiId}:...
-- Same (provider, org, project) should share one non-null GUID (enforced in Worker, not SQL).
-- TODO(06): optional index on (provider, org, project, project_external_id) if WI lookup needs it.

ALTER TABLE repos
ADD COLUMN project_external_id TEXT;
