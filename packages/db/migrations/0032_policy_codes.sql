CREATE TABLE ai_policy_codes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,code TEXT UNIQUE
);
CREATE TABLE ai_policy_aliases (
 project_id TEXT NOT NULL,gate_id TEXT NOT NULL,policy_id INTEGER NOT NULL REFERENCES ai_policy_codes(id),
 PRIMARY KEY(project_id,gate_id)
);
