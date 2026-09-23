ALTER TABLE collection_jobs ADD COLUMN discovery_depth TEXT NOT NULL DEFAULT 'smart' CHECK(discovery_depth IN ('smart','deep'));
ALTER TABLE collection_jobs ADD COLUMN catalogue_only INTEGER NOT NULL DEFAULT 0 CHECK(catalogue_only IN (0,1));
CREATE TABLE collection_job_children (
 job_id TEXT NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
 child_id TEXT NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
 PRIMARY KEY(job_id,child_id)
);
CREATE INDEX collection_job_children_child ON collection_job_children(child_id);
DROP INDEX collection_jobs_one_scan;
CREATE UNIQUE INDEX collection_jobs_one_scan ON collection_jobs(project_id,revision,kind,scope_key,discovery_depth)
WHERE kind IN ('list','full') AND state IN ('queued','running','auth_required');
CREATE INDEX collection_jobs_discovery_cooldown ON collection_jobs(project_id,revision,scope_key,discovery_depth,completed_at) WHERE kind='list';
DROP TRIGGER collection_job_queued;
CREATE TRIGGER collection_job_queued AFTER INSERT ON collection_jobs WHEN NEW.summary_only=0 BEGIN
  UPDATE collection_jobs SET not_before=MAX(NEW.not_before,COALESCE((
    SELECT MAX(j.completed_at)+q.cooldown_seconds FROM collection_jobs j JOIN collection_refresh q ON q.kind=NEW.kind
    WHERE j.id<>NEW.id AND j.summary_only=0 AND j.project_id=NEW.project_id AND j.revision=NEW.revision AND j.kind=NEW.kind
      AND ((NEW.kind='list' AND j.scope_key=NEW.scope_key AND j.discovery_depth=NEW.discovery_depth)
        OR (NEW.kind<>'list' AND j.observation_id=NEW.observation_id AND j.observation_generation=NEW.observation_generation))
  ),NEW.requested_at)),events_json=json_array(json_object('id',lower(hex(randomblob(8))),'at',NEW.requested_at,'phase','queued','state',NEW.state,'message',NEW.message)) WHERE id=NEW.id;
END;
UPDATE collection_jobs SET state='canceled',cancel_reason='discovery_scope_changed',completed_at=unixepoch(),updated_at=unixepoch(),lease_token=NULL,lease_expires_at=NULL
WHERE kind='list' AND state IN ('queued','running','auth_required');
