import type { ClientRecord, CloudflareSettings, JobRecord, SiteRecord, TemplateRecord, UserRecord, UserRole } from "../../shared/types";
import { nowIso } from "../../shared/utils";
import type { Env } from "../env";

export const DEFAULT_CLIENT_ID = "default";

export interface StoredUserRecord extends UserRecord {
  passwordHash: string;
}

let schemaReady = false;

export async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.APP_DB.batch([
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS client_settings (client_id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, client_id TEXT NOT NULL DEFAULT 'default', role TEXT NOT NULL DEFAULT 'client', name TEXT NOT NULL, email TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, github_url TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL, branch TEXT NOT NULL, subdir TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, client_id TEXT NOT NULL DEFAULT 'default', status TEXT NOT NULL, site_name TEXT NOT NULL, slug TEXT NOT NULL, template_id TEXT NOT NULL, worker_name TEXT NOT NULL, custom_domain TEXT NOT NULL DEFAULT '', workers_dev_url TEXT NOT NULL DEFAULT '', admin_url TEXT NOT NULL DEFAULT '', d1_database TEXT NOT NULL DEFAULT '', d1_database_id TEXT NOT NULL DEFAULT '', r2_bucket TEXT NOT NULL DEFAULT '', kv_namespace TEXT NOT NULL DEFAULT '', kv_namespace_id TEXT NOT NULL DEFAULT '', build_trigger_id TEXT NOT NULL DEFAULT '', build_id TEXT NOT NULL DEFAULT '', repo_connection_uuid TEXT NOT NULL DEFAULT '', external_script_id TEXT NOT NULL DEFAULT '', webhook_secret TEXT NOT NULL DEFAULT '', cron_secret TEXT NOT NULL DEFAULT '', zone_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', raw_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, client_id TEXT NOT NULL DEFAULT 'default', site_id TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL, current_step TEXT NOT NULL, result_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL)"),
  ]);
  await ensureColumn(env, "sites", "client_id", "TEXT NOT NULL DEFAULT 'default'");
  await ensureColumn(env, "jobs", "client_id", "TEXT NOT NULL DEFAULT 'default'");
  await env.APP_DB.batch([
    env.APP_DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_client_id ON sites(client_id, updated_at)"),
    env.APP_DB.prepare("CREATE INDEX IF NOT EXISTS idx_jobs_client_id ON jobs(client_id, site_id)"),
    env.APP_DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)"),
    env.APP_DB.prepare("CREATE INDEX IF NOT EXISTS idx_users_client_id ON users(client_id)"),
  ]);
  await ensureDefaultClient(env);
  schemaReady = true;
}

async function ensureColumn(env: Env, table: "sites" | "jobs", column: string, definition: string): Promise<void> {
  const { results } = await env.APP_DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if ((results || []).some((row) => row.name === column)) return;
  await env.APP_DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

export async function ensureDefaultClient(env: Env): Promise<void> {
  const now = nowIso();
  await env.APP_DB.prepare(
    "INSERT OR IGNORE INTO clients (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(DEFAULT_CLIENT_ID, "Cliente padrao", "", now, now)
    .run();
  await env.APP_DB.prepare(
    `INSERT INTO client_settings (client_id, value, updated_at)
     SELECT ?, value, updated_at FROM settings
     WHERE key = ? AND NOT EXISTS (SELECT 1 FROM client_settings WHERE client_id = ?)`,
  )
    .bind(DEFAULT_CLIENT_ID, "cloudflare", DEFAULT_CLIENT_ID)
    .run();
}

export async function listClients(env: Env): Promise<ClientRecord[]> {
  const { results } = await env.APP_DB.prepare(
    "SELECT * FROM clients ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, name COLLATE NOCASE",
  )
    .bind(DEFAULT_CLIENT_ID)
    .all<Record<string, string>>();
  return (results || []).map(clientFromRow);
}

export async function getClient(env: Env, id: string): Promise<ClientRecord | null> {
  const row = await env.APP_DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first<Record<string, string>>();
  return row ? clientFromRow(row) : null;
}

export async function upsertClient(env: Env, client: ClientRecord): Promise<void> {
  await env.APP_DB.prepare(
    `INSERT INTO clients (id, name, email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, updated_at = excluded.updated_at`,
  )
    .bind(client.id, client.name, client.email, client.createdAt, client.updatedAt)
    .run();
}

export async function countUsers(env: Env): Promise<number> {
  const row = await env.APP_DB.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  return Number(row?.total || 0);
}

export async function listUsers(env: Env): Promise<UserRecord[]> {
  const { results } = await env.APP_DB.prepare(
    "SELECT * FROM users ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, name COLLATE NOCASE",
  ).all<Record<string, string | number>>();
  return (results || []).map(userFromRow);
}

export async function getUser(env: Env, id: string): Promise<UserRecord | null> {
  const row = await env.APP_DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<Record<string, string | number>>();
  return row ? userFromRow(row) : null;
}

export async function getStoredUser(env: Env, id: string): Promise<StoredUserRecord | null> {
  const row = await env.APP_DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<Record<string, string | number>>();
  return row ? storedUserFromRow(row) : null;
}

export async function getStoredUserByEmail(env: Env, email: string): Promise<StoredUserRecord | null> {
  const row = await env.APP_DB.prepare("SELECT * FROM users WHERE email = ?").bind(normalizeEmail(email)).first<Record<string, string | number>>();
  return row ? storedUserFromRow(row) : null;
}

export async function getFirstAdminUser(env: Env): Promise<UserRecord | null> {
  const row = await env.APP_DB.prepare("SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY created_at ASC LIMIT 1")
    .first<Record<string, string | number>>();
  return row ? userFromRow(row) : null;
}

export async function upsertUser(env: Env, user: StoredUserRecord): Promise<void> {
  await env.APP_DB.prepare(
    `INSERT INTO users (id, client_id, role, name, email, password_hash, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id, role = excluded.role, name = excluded.name,
       email = excluded.email, password_hash = excluded.password_hash, active = excluded.active, updated_at = excluded.updated_at`,
  )
    .bind(
      user.id,
      user.clientId || DEFAULT_CLIENT_ID,
      user.role,
      user.name,
      normalizeEmail(user.email),
      user.passwordHash,
      user.active ? 1 : 0,
      user.createdAt,
      user.updatedAt,
    )
    .run();
}

export function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export async function getSettings(env: Env, clientId = DEFAULT_CLIENT_ID): Promise<CloudflareSettings> {
  await ensureDefaultClient(env);
  const row = await env.APP_DB.prepare("SELECT value FROM client_settings WHERE client_id = ?").bind(clientId).first<{ value: string }>();
  if (!row) return { accountId: "" };
  return JSON.parse(row.value) as CloudflareSettings;
}

export async function saveSettings(env: Env, settings: CloudflareSettings, clientId = DEFAULT_CLIENT_ID): Promise<void> {
  await ensureDefaultClient(env);
  await env.APP_DB.prepare(
    "INSERT INTO client_settings (client_id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(clientId, JSON.stringify(settings), nowIso())
    .run();
}

export async function listTemplates(env: Env): Promise<TemplateRecord[]> {
  const { results } = await env.APP_DB.prepare("SELECT * FROM templates ORDER BY updated_at DESC").all<Record<string, string>>();
  return (results || []).map(templateFromRow);
}

export async function getTemplate(env: Env, id: string): Promise<TemplateRecord | null> {
  const row = await env.APP_DB.prepare("SELECT * FROM templates WHERE id = ?").bind(id).first<Record<string, string>>();
  return row ? templateFromRow(row) : null;
}

export async function upsertTemplate(env: Env, template: TemplateRecord): Promise<void> {
  await env.APP_DB.prepare(
    `INSERT INTO templates (id, name, github_url, owner, repo, branch, subdir, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, github_url = excluded.github_url, owner = excluded.owner,
       repo = excluded.repo, branch = excluded.branch, subdir = excluded.subdir, updated_at = excluded.updated_at`,
  )
    .bind(
      template.id,
      template.name,
      template.githubUrl,
      template.owner,
      template.repo,
      template.branch,
      template.subdir,
      template.createdAt,
      template.updatedAt,
    )
    .run();
}

export async function deleteTemplate(env: Env, id: string): Promise<void> {
  await env.APP_DB.prepare("DELETE FROM templates WHERE id = ?").bind(id).run();
}

export async function listSites(env: Env, clientId = ""): Promise<SiteRecord[]> {
  const statement = clientId
    ? env.APP_DB.prepare("SELECT * FROM sites WHERE status != 'deleted' AND client_id = ? ORDER BY updated_at DESC").bind(clientId)
    : env.APP_DB.prepare("SELECT * FROM sites WHERE status != 'deleted' ORDER BY updated_at DESC");
  const { results } = await statement.all<Record<string, string>>();
  return (results || []).map(siteFromRow);
}

export async function getSite(env: Env, id: string): Promise<SiteRecord | null> {
  const row = await env.APP_DB.prepare("SELECT * FROM sites WHERE id = ?").bind(id).first<Record<string, string>>();
  return row ? siteFromRow(row) : null;
}

export async function saveSite(env: Env, site: SiteRecord): Promise<void> {
  await env.APP_DB.prepare(
    `INSERT INTO sites (
      id, client_id, status, site_name, slug, template_id, worker_name, custom_domain, workers_dev_url, admin_url,
      d1_database, d1_database_id, r2_bucket, kv_namespace, kv_namespace_id, build_trigger_id, build_id,
      repo_connection_uuid, external_script_id, webhook_secret, cron_secret, zone_json, error, raw_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      client_id = excluded.client_id, status = excluded.status, site_name = excluded.site_name, slug = excluded.slug, template_id = excluded.template_id,
      worker_name = excluded.worker_name, custom_domain = excluded.custom_domain, workers_dev_url = excluded.workers_dev_url,
      admin_url = excluded.admin_url, d1_database = excluded.d1_database, d1_database_id = excluded.d1_database_id,
      r2_bucket = excluded.r2_bucket, kv_namespace = excluded.kv_namespace, kv_namespace_id = excluded.kv_namespace_id,
      build_trigger_id = excluded.build_trigger_id, build_id = excluded.build_id, repo_connection_uuid = excluded.repo_connection_uuid,
      external_script_id = excluded.external_script_id, webhook_secret = excluded.webhook_secret, cron_secret = excluded.cron_secret,
      zone_json = excluded.zone_json, error = excluded.error, raw_json = excluded.raw_json, updated_at = excluded.updated_at`,
  )
    .bind(
      site.id,
      site.clientId || DEFAULT_CLIENT_ID,
      site.status,
      site.siteName,
      site.slug,
      site.templateId,
      site.workerName,
      site.customDomain,
      site.workersDevUrl,
      site.adminUrl,
      site.d1Database,
      site.d1DatabaseId,
      site.r2Bucket,
      site.kvNamespace,
      site.kvNamespaceId,
      site.buildTriggerId,
      site.buildId,
      site.repoConnectionUuid,
      site.externalScriptId,
      site.webhookSecret,
      site.cronSecret,
      JSON.stringify(site.zone || {}),
      site.error,
      JSON.stringify(site.raw || {}),
      site.createdAt,
      site.updatedAt,
    )
    .run();
}

export async function saveJob(env: Env, job: Omit<JobRecord, "logs">): Promise<void> {
  await env.APP_DB.prepare(
    `INSERT INTO jobs (id, client_id, site_id, operation, status, current_step, result_json, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, current_step = excluded.current_step,
       result_json = excluded.result_json, error = excluded.error, updated_at = excluded.updated_at`,
  )
    .bind(
      job.id,
      job.clientId || DEFAULT_CLIENT_ID,
      job.siteId,
      job.operation,
      job.status,
      job.currentStep,
      JSON.stringify(job.result || {}),
      job.error,
      job.createdAt,
      job.updatedAt,
    )
    .run();
}

export async function getJob(env: Env, id: string): Promise<JobRecord | null> {
  const row = await env.APP_DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<Record<string, string>>();
  if (!row) return null;
  const logs = await getJobLogs(env, id);
  return jobFromRow(row, logs);
}

export async function addJobEvent(env: Env, jobId: string, message: string, level = "info", masks: string[] = []): Promise<void> {
  const clean = masks.reduce((text, mask) => (mask ? text.replaceAll(mask, "***") : text), message);
  await env.APP_DB.prepare("INSERT INTO job_events (job_id, level, message, created_at) VALUES (?, ?, ?, ?)")
    .bind(jobId, level, clean, nowIso())
    .run();
}

export async function getJobLogs(env: Env, jobId: string): Promise<string[]> {
  const { results } = await env.APP_DB.prepare("SELECT message FROM job_events WHERE job_id = ? ORDER BY id ASC LIMIT 1200")
    .bind(jobId)
    .all<{ message: string }>();
  return (results || []).map((row) => row.message);
}

export async function persistJobLogArtifact(env: Env, jobId: string): Promise<void> {
  const logs = await getJobLogs(env, jobId);
  await env.APP_BUCKET.put(`jobs/${jobId}/latest.log`, logs.join("\n"), {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });
}

function templateFromRow(row: Record<string, string>): TemplateRecord {
  return {
    id: row.id,
    name: row.name,
    githubUrl: row.github_url,
    owner: row.owner,
    repo: row.repo,
    branch: row.branch,
    subdir: row.subdir || "",
    url: row.github_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clientFromRow(row: Record<string, string>): ClientRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function userFromRow(row: Record<string, string | number>): UserRecord {
  const role = row.role === "admin" ? "admin" : "client";
  return {
    id: String(row.id || ""),
    clientId: String(row.client_id || DEFAULT_CLIENT_ID),
    role: role as UserRole,
    name: String(row.name || ""),
    email: String(row.email || ""),
    active: Number(row.active ?? 1) === 1,
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function storedUserFromRow(row: Record<string, string | number>): StoredUserRecord {
  return {
    ...userFromRow(row),
    passwordHash: String(row.password_hash || ""),
  };
}

function siteFromRow(row: Record<string, string>): SiteRecord {
  return {
    id: row.id,
    clientId: row.client_id || DEFAULT_CLIENT_ID,
    status: row.status as SiteRecord["status"],
    siteName: row.site_name,
    slug: row.slug,
    templateId: row.template_id,
    workerName: row.worker_name,
    customDomain: row.custom_domain || "",
    workersDevUrl: row.workers_dev_url || "",
    adminUrl: row.admin_url || "",
    d1Database: row.d1_database || "",
    d1DatabaseId: row.d1_database_id || "",
    r2Bucket: row.r2_bucket || "",
    kvNamespace: row.kv_namespace || "",
    kvNamespaceId: row.kv_namespace_id || "",
    buildTriggerId: row.build_trigger_id || "",
    buildId: row.build_id || "",
    repoConnectionUuid: row.repo_connection_uuid || "",
    externalScriptId: row.external_script_id || "",
    webhookSecret: row.webhook_secret || "",
    cronSecret: row.cron_secret || "",
    zone: JSON.parse(row.zone_json || "{}") as Record<string, unknown>,
    error: row.error || "",
    raw: JSON.parse(row.raw_json || "{}") as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function jobFromRow(row: Record<string, string>, logs: string[]): JobRecord {
  return {
    id: row.id,
    clientId: row.client_id || DEFAULT_CLIENT_ID,
    siteId: row.site_id,
    operation: row.operation,
    status: row.status as JobRecord["status"],
    currentStep: row.current_step,
    result: JSON.parse(row.result_json || "{}") as Record<string, unknown>,
    error: row.error || "",
    logs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
