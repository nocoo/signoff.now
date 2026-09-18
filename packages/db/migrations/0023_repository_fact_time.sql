-- A repository name is shared by many PRs. A slow check for one PR must not
-- overwrite a newer name observed by another PR or repository discovery.
ALTER TABLE workbench_repositories ADD COLUMN name_observed_at REAL NOT NULL DEFAULT 0
  CHECK(name_observed_at>=0);
