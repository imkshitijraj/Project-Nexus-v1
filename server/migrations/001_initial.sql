CREATE TABLE IF NOT EXISTS organizations (
 id text PRIMARY KEY, name text NOT NULL, revision integer NOT NULL DEFAULT 0,
 settings jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id), email text NOT NULL UNIQUE,
 name text NOT NULL, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','manager','member','viewer')),
 active boolean NOT NULL DEFAULT true, department text NOT NULL DEFAULT '', capacity numeric NOT NULL DEFAULT 40 CHECK(capacity>=0),
 preferences jsonb NOT NULL DEFAULT '{}'::jsonb, sessions jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,id)
);
CREATE INDEX IF NOT EXISTS users_org_idx ON users(org_id);
CREATE TABLE IF NOT EXISTS refresh_sessions (
 token_hash text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL,
 family text NOT NULL, revoked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_user_idx ON refresh_sessions(user_id);
CREATE INDEX IF NOT EXISTS refresh_family_idx ON refresh_sessions(family);
CREATE INDEX IF NOT EXISTS refresh_active_session_idx ON refresh_sessions(user_id,family,revoked,expires_at);
CREATE TABLE IF NOT EXISTS account_tokens (
 token_hash text PRIMARY KEY, org_id text REFERENCES organizations(id), user_id text REFERENCES users(id),
 email text NOT NULL, role text NOT NULL DEFAULT 'member', kind text NOT NULL CHECK(kind IN ('invite','reset')),
 expires_at timestamptz NOT NULL, used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS project_keys(org_id text NOT NULL REFERENCES organizations(id),id text NOT NULL,PRIMARY KEY(org_id,id));
CREATE TABLE IF NOT EXISTS records (
 org_id text NOT NULL REFERENCES organizations(id), kind text NOT NULL CHECK(kind IN ('projects','tasks','expenses','risks','milestones','events','resources','notifications','activity','files')),
 id text NOT NULL, project_id text, payload jsonb NOT NULL,
 PRIMARY KEY(org_id,kind,id), FOREIGN KEY(org_id,project_id) REFERENCES project_keys(org_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS records_org_project_idx ON records(org_id,project_id,kind);
CREATE INDEX IF NOT EXISTS records_due_idx ON records(org_id,kind,(payload->>'due'));
CREATE INDEX IF NOT EXISTS records_assignee_idx ON records(org_id,kind,(payload->>'assignee'));
CREATE TABLE IF NOT EXISTS project_links (
 org_id text NOT NULL REFERENCES organizations(id), project_id text NOT NULL, user_id text NOT NULL REFERENCES users(id),
 PRIMARY KEY(org_id,project_id,user_id),FOREIGN KEY(org_id,project_id) REFERENCES project_keys(org_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(org_id,user_id) REFERENCES users(org_id,id)
);
CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
