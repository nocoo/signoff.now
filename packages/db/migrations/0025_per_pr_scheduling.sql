-- Claims atomically enforce two running tasks per project/lane. Watches retain
-- their unique active task per generation/lane; no work or watches are created.
DROP INDEX collection_jobs_one_running;
CREATE INDEX collection_jobs_running_lane ON collection_jobs(project_id,summary_only,kind) WHERE state='running';
CREATE INDEX collection_checks_due ON collection_jobs(observation_id,observation_generation,completed_at) WHERE summary_only=0;
