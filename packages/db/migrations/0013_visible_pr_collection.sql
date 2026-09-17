-- NULL keeps manual full scans; [] refreshes the list; IDs limit detail work.
ALTER TABLE collection_jobs ADD COLUMN pull_ids_json TEXT
  CHECK (pull_ids_json IS NULL OR (json_valid(pull_ids_json) AND json_type(pull_ids_json) = 'array'));
