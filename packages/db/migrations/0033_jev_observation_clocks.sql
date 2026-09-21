DROP TRIGGER ai_pull_changed;
CREATE TRIGGER ai_pull_changed AFTER UPDATE OF snapshot ON pull_requests
WHEN json_remove(NEW.snapshot,'$.observedAt','$.summaryObservedAt','$.checksObservedAt','$.updatedAt')
  <> json_remove(OLD.snapshot,'$.observedAt','$.summaryObservedAt','$.checksObservedAt','$.updatedAt')
  OR (json_type(NEW.snapshot,'$.checksObservedAt') IS 'null')
  <> (json_type(OLD.snapshot,'$.checksObservedAt') IS 'null')
BEGIN
 UPDATE ai_evaluations SET status='pending',input_revision=input_revision+1,lease_token=NULL,previous_json=COALESCE(result_json,previous_json)
 WHERE observation_id IN (SELECT id FROM pr_observations WHERE pull_id=NEW.id AND active=1) AND status<>'canceled';
END;
