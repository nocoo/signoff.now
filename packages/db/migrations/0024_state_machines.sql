ALTER TABLE projects ADD COLUMN state_machine_json TEXT NOT NULL DEFAULT '{"default":null,"repositories":{}}' CHECK(json_valid(state_machine_json));
ALTER TABLE projects ADD COLUMN state_machine_revision INTEGER NOT NULL DEFAULT 1 CHECK(state_machine_revision > 0);

CREATE TABLE state_machine_versions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  settings_json TEXT NOT NULL,
  readiness_rules_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(project_id, revision)
);
INSERT INTO state_machine_versions
  SELECT id,state_machine_revision,state_machine_json,readiness_rules_json,unixepoch() FROM projects;
CREATE TRIGGER state_machine_initial AFTER INSERT ON projects BEGIN
  INSERT INTO state_machine_versions VALUES(NEW.id,NEW.state_machine_revision,NEW.state_machine_json,NEW.readiness_rules_json,unixepoch());
END;
CREATE TRIGGER state_machine_version AFTER UPDATE OF state_machine_revision ON projects
WHEN NEW.state_machine_revision<>OLD.state_machine_revision BEGIN
  INSERT INTO state_machine_versions VALUES(NEW.id,NEW.state_machine_revision,NEW.state_machine_json,NEW.readiness_rules_json,unixepoch());
  UPDATE workbench_revisions SET revision=revision+1 WHERE source=NEW.source;
END;

-- Written by the accepted snapshot mutation itself, so a failed lease/CAS cannot
-- leave a fictitious transition. No pre-migration history is manufactured.
CREATE TABLE pr_state_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pull_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  observed_at REAL NOT NULL,
  from_snapshot TEXT,
  to_snapshot TEXT NOT NULL,
  project_context TEXT NOT NULL
);
CREATE INDEX pr_state_events_pull ON pr_state_events(pull_id,id DESC);
CREATE TRIGGER pr_state_initial AFTER INSERT ON pull_requests BEGIN
  INSERT INTO pr_state_events(pull_id,project_id,observed_at,from_snapshot,to_snapshot,project_context)
  SELECT NEW.id,NEW.project_id,COALESCE(NEW.published_at,json_extract(NEW.snapshot,'$.observedAt')),NULL,NEW.snapshot,
    json_object('owner',p.owner,'readinessRules',json(p.readiness_rules_json),'mergeRequirements',json(p.merge_requirements_json),
      'stateMachine',json(p.state_machine_json),'stateMachineRevision',p.state_machine_revision)
  FROM projects p WHERE p.id=NEW.project_id;
END;
CREATE TRIGGER pr_state_change AFTER UPDATE OF snapshot ON pull_requests
WHEN json_array(
    json_remove(NEW.snapshot,'$.observedAt','$.summaryObservedAt','$.checksObservedAt','$.updatedAt','$.title','$.description','$.activity','$.labels','$.comments','$.filesChanged','$.additions','$.deletions','$.repository.name'),
    json_type(NEW.snapshot,'$.checksObservedAt') IS 'null')
  <> json_array(
    json_remove(OLD.snapshot,'$.observedAt','$.summaryObservedAt','$.checksObservedAt','$.updatedAt','$.title','$.description','$.activity','$.labels','$.comments','$.filesChanged','$.additions','$.deletions','$.repository.name'),
    json_type(OLD.snapshot,'$.checksObservedAt') IS 'null')
BEGIN
  INSERT INTO pr_state_events(pull_id,project_id,observed_at,from_snapshot,to_snapshot,project_context)
  SELECT NEW.id,NEW.project_id,COALESCE(NEW.published_at,json_extract(NEW.snapshot,'$.observedAt')),OLD.snapshot,NEW.snapshot,
    json_object('owner',p.owner,'readinessRules',json(p.readiness_rules_json),'mergeRequirements',json(p.merge_requirements_json),
      'stateMachine',json(p.state_machine_json),'stateMachineRevision',p.state_machine_revision)
  FROM projects p WHERE p.id=NEW.project_id;
  DELETE FROM pr_state_events WHERE pull_id=NEW.id AND id NOT IN (
    SELECT id FROM pr_state_events WHERE pull_id=NEW.id ORDER BY id DESC LIMIT 30
  );
END;
