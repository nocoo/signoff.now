CREATE INDEX collection_jobs_lease ON collection_jobs(lease_token)
WHERE lease_token IS NOT NULL;
