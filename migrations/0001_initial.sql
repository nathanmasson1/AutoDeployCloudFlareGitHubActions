CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  github_url TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  subdir TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  site_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  template_id TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  custom_domain TEXT NOT NULL DEFAULT '',
  workers_dev_url TEXT NOT NULL DEFAULT '',
  admin_url TEXT NOT NULL DEFAULT '',
  d1_database TEXT NOT NULL DEFAULT '',
  d1_database_id TEXT NOT NULL DEFAULT '',
  r2_bucket TEXT NOT NULL DEFAULT '',
  kv_namespace TEXT NOT NULL DEFAULT '',
  kv_namespace_id TEXT NOT NULL DEFAULT '',
  build_trigger_id TEXT NOT NULL DEFAULT '',
  build_id TEXT NOT NULL DEFAULT '',
  repo_connection_uuid TEXT NOT NULL DEFAULT '',
  external_script_id TEXT NOT NULL DEFAULT '',
  webhook_secret TEXT NOT NULL DEFAULT '',
  cron_secret TEXT NOT NULL DEFAULT '',
  zone_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sites_updated_at ON sites(updated_at);
CREATE INDEX IF NOT EXISTS idx_jobs_site_id ON jobs(site_id);
CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id, id);
