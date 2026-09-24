-- Admins, tenants and tenant membership (docs/23). Environment admins come
-- from the SIGNOFF_ADMIN_EMAILS secret and are never stored here.
CREATE TABLE admins (
  principal TEXT PRIMARY KEY CHECK (principal GLOB 'email:?*' OR principal GLOB 'service:?*'),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 80),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO tenants (id, name, created_at, updated_at) VALUES ('default', 'Default', unixepoch(), unixepoch());

CREATE TABLE tenant_members (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  principal TEXT NOT NULL CHECK (principal GLOB 'email:?*' OR principal GLOB 'service:?*'),
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, principal)
);
CREATE INDEX tenant_members_principal ON tenant_members (principal, tenant_id);

-- Every existing project stays in the default tenant. SQLite cannot add a
-- REFERENCES column with a non-NULL default while foreign keys are enforced,
-- so triggers keep project tenants valid and prevent deleting a used tenant.
ALTER TABLE projects ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX projects_tenant ON projects (tenant_id, source);
CREATE TRIGGER project_tenant_insert BEFORE INSERT ON projects
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id = NEW.tenant_id) BEGIN
  SELECT RAISE(ABORT, 'Project tenant does not exist');
END;
CREATE TRIGGER project_tenant_update BEFORE UPDATE OF tenant_id ON projects
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id = NEW.tenant_id) BEGIN
  SELECT RAISE(ABORT, 'Project tenant does not exist');
END;
CREATE TRIGGER tenant_in_use BEFORE DELETE ON tenants
WHEN EXISTS (SELECT 1 FROM projects WHERE tenant_id = OLD.id) BEGIN
  SELECT RAISE(ABORT, 'Tenant still has projects');
END;
