CREATE TABLE ai_rules (scope TEXT PRIMARY KEY,revision INTEGER NOT NULL,text TEXT NOT NULL);
CREATE TRIGGER ai_rules_inserted AFTER INSERT ON ai_rules BEGIN
 UPDATE ai_evaluations SET status='pending',input_revision=input_revision+1,lease_token=NULL,previous_json=COALESCE(result_json,previous_json)
 WHERE status<>'canceled' AND (NEW.scope='common' OR observation_id IN (SELECT id FROM pr_observations WHERE project_id=NEW.scope AND active=1));
END;
CREATE TRIGGER ai_rules_updated AFTER UPDATE ON ai_rules BEGIN
 UPDATE ai_evaluations SET status='pending',input_revision=input_revision+1,lease_token=NULL,previous_json=COALESCE(result_json,previous_json)
 WHERE status<>'canceled' AND (NEW.scope='common' OR observation_id IN (SELECT id FROM pr_observations WHERE project_id=NEW.scope AND active=1));
END;
UPDATE ai_evaluations SET status='pending',input_revision=input_revision+1,result_json=NULL,previous_json=NULL,fingerprint=NULL,lease_token=NULL,attempts=0,not_before=0,error=NULL WHERE status<>'canceled';
