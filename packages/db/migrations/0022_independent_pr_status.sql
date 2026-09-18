-- Add a cheap, separately leased status lane without changing watch membership,
-- configured check cooldowns, discovery cursors or existing task receipts.
ALTER TABLE collection_jobs ADD COLUMN summary_only INTEGER NOT NULL DEFAULT 0
  CHECK(summary_only IN (0,1) AND (summary_only=0 OR kind='details'));
ALTER TABLE collection_staging ADD COLUMN raw_snapshot TEXT
  CHECK(raw_snapshot IS NULL OR json_valid(raw_snapshot));
ALTER TABLE collection_staging ADD COLUMN base_version INTEGER;

DROP INDEX collection_jobs_one_running;
CREATE UNIQUE INDEX collection_jobs_one_running ON collection_jobs(project_id,summary_only) WHERE state='running';
DROP INDEX collection_jobs_one_observation;
CREATE UNIQUE INDEX collection_jobs_one_observation ON collection_jobs(observation_id,observation_generation,summary_only)
  WHERE observation_id IS NOT NULL AND state IN ('queued','running','auth_required');
CREATE INDEX collection_status_due ON collection_jobs(observation_id,observation_generation,completed_at) WHERE summary_only=1;
CREATE INDEX collection_status_retention ON collection_jobs(completed_at) WHERE summary_only=1;
CREATE INDEX collection_jobs_source_state ON collection_jobs(source,state,updated_at);

-- Lightweight status probes have their own receipts, not full scan history.
DROP TRIGGER collection_finished;
CREATE TRIGGER collection_finished AFTER UPDATE OF state ON collection_jobs
WHEN NEW.summary_only=0 AND NEW.state IN ('complete','partial','failed') AND OLD.state='running' BEGIN
  INSERT INTO scan_runs(id,project_id,source,state,started_at,completed_at,pull_request_count,advanced_stages,message)
    SELECT NEW.id,NEW.project_id,NEW.source,NEW.state,COALESCE(NEW.started_at,NEW.requested_at),NEW.completed_at,NEW.completed_pulls,0,NEW.message
    WHERE EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND revision=NEW.revision AND source=NEW.source)
    ON CONFLICT(id) DO NOTHING;
  UPDATE projects SET last_scanned_at=NEW.completed_at,scan_state=NEW.state,scan_message=NEW.message
    WHERE id=NEW.project_id AND revision=NEW.revision AND source=NEW.source;
END;
