-- Replace the old generic-state presentation with actual source requirement IDs.
ALTER TABLE projects ADD COLUMN merge_requirements_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(merge_requirements_json) AND json_type(merge_requirements_json) = 'array');
UPDATE projects SET readiness_rules_json = '[]', readiness_revision = readiness_revision + 1
WHERE EXISTS (SELECT 1 FROM json_each(readiness_rules_json) WHERE json_type(value, '$.kind') IS NOT NULL OR json_type(value, '$.policy') IS NOT NULL);
