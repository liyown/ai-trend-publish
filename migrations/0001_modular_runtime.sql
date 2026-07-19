CREATE TABLE IF NOT EXISTS workspace_documents (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_documents_kind_updated
  ON workspace_documents(kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS connector_connections (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  connection_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_credentials (
  credential_ref TEXT PRIMARY KEY,
  credentials_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  job_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_jobs_type_created
  ON runtime_jobs(type, created_at DESC);

CREATE TABLE IF NOT EXISTS runtime_tasks (
  job_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  task_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (job_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_runtime_tasks_job
  ON runtime_tasks(job_id, updated_at ASC);
