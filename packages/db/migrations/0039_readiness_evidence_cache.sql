DROP TRIGGER ai_pull_changed;
DROP TRIGGER ai_context_changed;
DROP TRIGGER ai_project_changed;
DROP TRIGGER ai_rules_inserted;
DROP TRIGGER ai_rules_updated;
ALTER TABLE ai_evaluations ADD COLUMN state_json TEXT CHECK(state_json IS NULL OR json_valid(state_json));
ALTER TABLE ai_evaluations ADD COLUMN last_started_at INTEGER;
ALTER TABLE ai_evaluations ADD COLUMN last_completed_at INTEGER;
CREATE TABLE ai_decision_cache (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL,
 state_json TEXT NOT NULL CHECK(json_valid(state_json)),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,fingerprint)
);
ALTER TABLE ai_project_schedule DROP COLUMN last_batch_size;
ALTER TABLE ai_project_schedule ADD COLUMN request_count INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER ai_pull_revision AFTER UPDATE OF snapshot ON pull_requests WHEN NEW.snapshot<>OLD.snapshot BEGIN
 UPDATE ai_evaluations SET input_revision=input_revision+1 WHERE status<>'canceled' AND observation_id IN (SELECT id FROM pr_observations WHERE pull_id=NEW.id AND active=1);
END;
CREATE TRIGGER ai_project_revision AFTER UPDATE OF policy_context_json,merge_requirements_json ON projects WHEN NEW.policy_context_json<>OLD.policy_context_json OR NEW.merge_requirements_json<>OLD.merge_requirements_json BEGIN
 UPDATE ai_evaluations SET input_revision=input_revision+1 WHERE status<>'canceled' AND observation_id IN (SELECT id FROM pr_observations WHERE project_id=NEW.id AND active=1);
END;
CREATE TRIGGER ai_rule_added AFTER INSERT ON ai_rules BEGIN
 UPDATE ai_evaluations SET input_revision=input_revision+1 WHERE status<>'canceled' AND (NEW.scope='common' OR observation_id IN (SELECT id FROM pr_observations WHERE project_id=NEW.scope AND active=1));
END;
CREATE TRIGGER ai_rule_changed AFTER UPDATE ON ai_rules WHEN OLD.text<>NEW.text BEGIN
 UPDATE ai_evaluations SET input_revision=input_revision+1 WHERE status<>'canceled' AND (NEW.scope='common' OR observation_id IN (SELECT id FROM pr_observations WHERE project_id=NEW.scope AND active=1));
END;
