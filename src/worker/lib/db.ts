import type { CloudflareSettings, JobRecord, SiteRecord, TemplateRecord } from "../../shared/types";
import { nowIso } from "../../shared/utils";
import type { Env } from "../env";

let schemaReady = false;

export async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  await env.APP_DB.batch([
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, github_url TEXT NOT NULL, owner TEXT NOT NULL, repo TEXT NOT NULL, branch TEXT NOT NULL, subdir TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, status TEXT NOT NULL, site_name TEXT NOT NULL, slug TEXT NOT NULL, template_id TEXT NOT NULL, worker_name TEXT NOT NULL, custom_domain TEXT NOT NULL DEFAULT '', workers_dev_url TEXT NOT NULL DEFAULT '', admin_url TEXT NOT NULL DEFAULT '', d1_database TEXT NOT NULL DEFAULT '', d1_database_id TEXT NOT NULL DEFAULT '', r2_bucket TEXT NOT NULL DEFAULT '', kv_namespace TEXT NOT NULL DEFAULT '', kv_namespace_id TEXT NOT NULL DEFAULT '', build_trigger_id TEXT NOT NULL DEFAULT '', build_id TEXT NOT NULL DEFAULT '', repo_connection_uuid TEXT NOT NULL DEFAULT '', external_script_id TEXT NOT NULL DEFAULT '', webhook_secret TEXT NOT NULL DEFAULT '', cron_secret TEXT NOT NULL DEFAULT '', zone_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', raw_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL, current_step TEXT NOT NULL, result_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.APP_DB.prepare("CREATE TABLE IF NOT EXISTS job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL)"),
  ]);
  schemaReady = true;
}

export async function getSettings(env: Env): Promise<CloudflareSettings> {
  const row = await env.APP_DB.prepare("SELECT value FROM settings WHERE key = ?").bind("cloudflare").first<{ value: string }>();
  if (!row) return { accountId: "" };
  return JSON.parse(row.value) as CloudflareSettings;
}

export async function saveSettings(env: Env, settings: CloudflareSettings): Promise<void> {
  await env.APP_DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind("cloudflare", JSON.stringify(settings), nowIso())
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

export async function listSites(env: Env): Promise<SiteRecord[]> {
  const { results } = await env.APP_DB.prepare("SELECT * FROM sites WHERE status != 'deleted' ORDER BY updated_at DESC").all<Record<string, string>>();
  return (results || []).map(siteFromRow);
}

export async function getSite(env: Env, id: string): Promise<SiteRecord | null> {
  const row = await env.APP_DB.prepare("SELECT * FROM sites WHERE id = ?").bind(id).first<Record<string, string>>();
  return row ? siteFromRow(row) : null;
}

export async function saveSite(env: Env, site: SiteRecord): Promise<void> {
  await env.APP_DB.prepare(
    `INSERT INTO sites (
      id, status, site_name, slug, template_id, worker_name, custom_domain, workers_dev_url, admin_url,
      d1_database, d1_database_id, r2_bucket, kv_namespace, kv_namespace_id, build_trigger_id, build_id,
      repo_connection_uuid, external_script_id, webhook_secret, cron_secret, zone_json, error, raw_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status, site_name = excluded.site_name, slug = excluded.slug, template_id = excluded.template_id,
      worker_name = excluded.worker_name, custom_domain = excluded.custom_domain, workers_dev_url = excluded.workers_dev_url,
      admin_url = excluded.admin_url, d1_database = excluded.d1_database, d1_database_id = excluded.d1_database_id,
      r2_bucket = excluded.r2_bucket, kv_namespace = excluded.kv_namespace, kv_namespace_id = excluded.kv_namespace_id,
      build_trigger_id = excluded.build_trigger_id, build_id = excluded.build_id, repo_connection_uuid = excluded.repo_connection_uuid,
      external_script_id = excluded.external_script_id, webhook_secret = excluded.webhook_secret, cron_secret = excluded.cron_secret,
      zone_json = excluded.zone_json, error = excluded.error, raw_json = excluded.raw_json, updated_at = excluded.updated_at`,
  )
    .bind(
      site.id,
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
    `INSERT INTO jobs (id, site_id, operation, status, current_step, result_json, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, current_step = excluded.current_step,
       result_json = excluded.result_json, error = excluded.error, updated_at = excluded.updated_at`,
  )
    .bind(job.id, job.siteId, job.operation, job.status, job.currentStep, JSON.stringify(job.result || {}), job.error, job.createdAt, job.updatedAt)
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

function siteFromRow(row: Record<string, string>): SiteRecord {
  return {
    id: row.id,
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
