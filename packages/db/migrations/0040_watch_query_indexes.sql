CREATE INDEX pull_requests_watch_identity ON pull_requests (
  project_id, lower(repository_id), CAST(external_id AS INTEGER)
);

CREATE INDEX pull_requests_project_state ON pull_requests (project_id, state, id);

CREATE INDEX pr_observations_active_identity ON pr_observations (source, identity)
WHERE active = 1;
