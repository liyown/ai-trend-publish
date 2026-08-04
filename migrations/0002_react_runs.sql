CREATE TABLE IF NOT EXISTS runtime_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_id TEXT,
  package_id TEXT,
  run_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_runs_created
  ON runtime_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_runs_plan_created
  ON runtime_runs(plan_id, created_at DESC);

CREATE TABLE IF NOT EXISTS runtime_run_sessions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  destination_id TEXT,
  session_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_run_sessions_run
  ON runtime_run_sessions(run_id, created_at ASC);

CREATE TABLE IF NOT EXISTS runtime_run_activities (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  activity_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  activity_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, sequence),
  UNIQUE(run_id, activity_key)
);
CREATE INDEX IF NOT EXISTS idx_runtime_run_activities_session
  ON runtime_run_activities(run_id, session_id, sequence ASC);

CREATE TABLE IF NOT EXISTS runtime_run_activity_sequences (
  run_id TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS internal_schema_versions (
  name TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
