ALTER TABLE collection_jobs ADD COLUMN import_number INTEGER CHECK(import_number IS NULL OR (kind='list' AND source='cli' AND catalogue_only=0 AND import_number>0 AND import_number<=9007199254740991));
DROP TRIGGER collection_job_queued;
CREATE TRIGGER collection_job_queued AFTER INSERT ON collection_jobs WHEN NEW.summary_only=0 BEGIN
  UPDATE collection_jobs SET not_before=MAX(NEW.not_before,COALESCE((
    SELECT MAX(j.completed_at)+q.cooldown_seconds FROM collection_jobs j JOIN collection_refresh q ON q.kind=NEW.kind
    WHERE NEW.import_number IS NULL AND j.import_number IS NULL AND j.id<>NEW.id AND j.summary_only=0 AND j.project_id=NEW.project_id AND j.revision=NEW.revision AND j.kind=NEW.kind
      AND ((NEW.kind='list' AND j.scope_key=NEW.scope_key AND j.discovery_depth=NEW.discovery_depth)
        OR (NEW.kind<>'list' AND j.observation_id=NEW.observation_id AND j.observation_generation=NEW.observation_generation))
  ),NEW.requested_at)),events_json=json_array(json_object('id',lower(hex(randomblob(8))),'at',NEW.requested_at,'phase','queued','state',NEW.state,'message',NEW.message)) WHERE id=NEW.id;
END;
