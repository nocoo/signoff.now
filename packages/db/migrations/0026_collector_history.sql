CREATE INDEX collection_jobs_history ON collection_jobs(source,requested_at DESC,id DESC)
WHERE state IN ('complete','partial','failed','canceled');
