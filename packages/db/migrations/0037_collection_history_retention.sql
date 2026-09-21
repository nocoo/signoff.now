CREATE INDEX collection_jobs_retention
ON collection_jobs(COALESCE(completed_at,updated_at))
WHERE state IN ('complete','partial','failed','canceled');
CREATE INDEX scan_runs_retention ON scan_runs(completed_at);
