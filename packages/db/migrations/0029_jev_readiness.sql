ALTER TABLE projects ADD COLUMN policy_context_json TEXT NOT NULL DEFAULT '{"default":[],"repositories":{}}' CHECK(json_valid(policy_context_json));
UPDATE projects SET policy_context_json=json_object(
 'default',json(COALESCE((SELECT json_group_array(json_object('gateId',json_extract(value,'$.gateId'),'description','')) FROM json_each(COALESCE(json_extract(state_machine_json,'$.default.gates'),readiness_rules_json))), '[]')),
 'repositories',json(COALESCE((SELECT json_group_object(key,json(COALESCE((SELECT json_group_array(json_object('gateId',json_extract(g.value,'$.gateId'),'description','')) FROM json_each(r.value,'$.gates') g),'[]'))) FROM json_each(state_machine_json,'$.repositories') r),'{}'))
);
CREATE TABLE ai_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), encrypted_key TEXT, revision INTEGER NOT NULL DEFAULT 1,
 tested_at INTEGER,test_state TEXT NOT NULL DEFAULT 'untested',test_error TEXT,
 runner_token TEXT,runner_expires INTEGER
);
INSERT INTO ai_settings(id) VALUES(1);
CREATE TABLE ai_evaluations (
 observation_id TEXT NOT NULL,generation INTEGER NOT NULL,
 input_revision INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'pending',fingerprint TEXT,config_revision INTEGER,
 result_json TEXT,previous_json TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,
 not_before INTEGER NOT NULL DEFAULT 0,lease_token TEXT,updated_at INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(observation_id,generation)
);
INSERT INTO ai_evaluations(observation_id,generation) SELECT id,generation FROM pr_observations WHERE active=1;
CREATE TRIGGER ai_watch_added AFTER INSERT ON pr_observations WHEN NEW.active=1 BEGIN
 INSERT INTO ai_evaluations(observation_id,generation) VALUES(NEW.id,NEW.generation);
END;
CREATE TRIGGER ai_watch_changed AFTER UPDATE OF active,generation ON pr_observations BEGIN
 UPDATE ai_evaluations SET status='canceled',lease_token=NULL,input_revision=input_revision+1 WHERE observation_id=NEW.id AND (generation<>NEW.generation OR NEW.active=0);
 INSERT INTO ai_evaluations(observation_id,generation) SELECT NEW.id,NEW.generation WHERE NEW.active=1 ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER ai_pull_changed AFTER UPDATE OF snapshot ON pull_requests WHEN NEW.snapshot<>OLD.snapshot BEGIN
 UPDATE ai_evaluations SET status='pending',input_revision=input_revision+1,lease_token=NULL,previous_json=COALESCE(result_json,previous_json)
 WHERE observation_id IN (SELECT id FROM pr_observations WHERE pull_id=NEW.id AND active=1) AND status<>'canceled';
END;
CREATE TRIGGER ai_context_changed AFTER UPDATE OF policy_context_json ON projects WHEN NEW.policy_context_json<>OLD.policy_context_json BEGIN
 UPDATE ai_evaluations SET status='pending',input_revision=input_revision+1,lease_token=NULL,previous_json=COALESCE(result_json,previous_json)
 WHERE observation_id IN (SELECT id FROM pr_observations WHERE project_id=NEW.id AND active=1) AND status<>'canceled';
END;
CREATE TRIGGER ai_config_changed AFTER UPDATE OF revision ON ai_settings WHEN NEW.revision<>OLD.revision BEGIN
 UPDATE ai_evaluations SET status='pending',input_revision=input_revision+1,lease_token=NULL,previous_json=COALESCE(result_json,previous_json) WHERE status<>'canceled';
END;
CREATE TRIGGER ai_result_changed AFTER UPDATE ON ai_evaluations WHEN NEW.status<>OLD.status OR COALESCE(NEW.result_json,'')<>COALESCE(OLD.result_json,'') BEGIN
 UPDATE workbench_revisions SET revision=revision+1 WHERE source=(SELECT source FROM pr_observations WHERE id=NEW.observation_id);
END;
CREATE INDEX ai_evaluations_pending ON ai_evaluations(status,not_before,updated_at);
CREATE TRIGGER ai_project_changed AFTER UPDATE OF merge_requirements_json,revision ON projects WHEN NEW.merge_requirements_json<>OLD.merge_requirements_json OR NEW.revision<>OLD.revision BEGIN
 UPDATE ai_evaluations SET status='pending',input_revision=input_revision+1,lease_token=NULL,previous_json=COALESCE(result_json,previous_json)
 WHERE observation_id IN (SELECT id FROM pr_observations WHERE project_id=NEW.id AND active=1) AND status<>'canceled';
END;
