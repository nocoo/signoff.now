DROP INDEX collection_jobs_history;
CREATE INDEX collection_jobs_history
ON collection_jobs(source, requested_at DESC, id DESC);
