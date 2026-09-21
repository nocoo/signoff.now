UPDATE collection_jobs SET state='canceled',cancel_reason='status_lane_removed',completed_at=unixepoch(),updated_at=unixepoch(),lease_token=NULL,lease_expires_at=NULL
WHERE summary_only=1 AND state IN ('queued','running','auth_required');
UPDATE collection_refresh SET cooldown_seconds=600 WHERE kind='list';
ALTER TABLE collection_jobs ADD COLUMN phase TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE collection_jobs ADD COLUMN events_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(events_json));
ALTER TABLE collection_jobs ADD COLUMN result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json));
CREATE INDEX collection_jobs_observation_history ON collection_jobs(source,observation_id,requested_at DESC,id DESC) WHERE summary_only=0;
CREATE INDEX collection_jobs_project_history ON collection_jobs(source,project_id,kind,requested_at DESC,id DESC) WHERE summary_only=0;
CREATE UNIQUE INDEX collection_jobs_discovery_running ON collection_jobs(project_id) WHERE kind='list' AND state='running';
CREATE TRIGGER collection_job_progress AFTER UPDATE OF state,phase ON collection_jobs
WHEN NEW.state<>OLD.state OR NEW.phase<>OLD.phase BEGIN
  UPDATE collection_jobs SET events_json=json_insert(events_json,'$[#]',json_object('id',lower(hex(randomblob(8))),'at',NEW.updated_at,'phase',NEW.phase,'state',NEW.state,'message',NEW.message)) WHERE id=NEW.id;
END;
CREATE TRIGGER collection_job_queued AFTER INSERT ON collection_jobs WHEN NEW.summary_only=0 BEGIN
  UPDATE collection_jobs SET not_before=MAX(NEW.not_before,COALESCE((
    SELECT MAX(j.completed_at)+q.cooldown_seconds FROM collection_jobs j JOIN collection_refresh q ON q.kind=NEW.kind
    WHERE j.id<>NEW.id AND j.summary_only=0 AND j.project_id=NEW.project_id AND j.revision=NEW.revision AND j.kind=NEW.kind
      AND (NEW.kind='list' OR (j.observation_id=NEW.observation_id AND j.observation_generation=NEW.observation_generation))
  ),NEW.requested_at)),events_json=json_array(json_object('id',lower(hex(randomblob(8))),'at',NEW.requested_at,'phase','queued','state',NEW.state,'message',NEW.message)) WHERE id=NEW.id;
END;
