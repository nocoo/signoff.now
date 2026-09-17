-- Presentation settings have their own CAS revision; collection jobs keep running.
ALTER TABLE projects ADD COLUMN readiness_rules_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(readiness_rules_json) AND json_type(readiness_rules_json) = 'array');
ALTER TABLE projects ADD COLUMN readiness_revision INTEGER NOT NULL DEFAULT 1
  CHECK (readiness_revision > 0);
