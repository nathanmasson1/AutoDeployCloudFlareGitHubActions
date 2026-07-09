import { Hono, type Context } from "hono";
import type { Env, AppVariables } from "./env";
import { clearSessionCookie, createSessionCookie, isAuthenticated } from "./lib/auth";
import { decryptText, encryptText } from "./lib/crypto";
import {
  addJobEvent,
  deleteTemplate,
  ensureSchema,
  getJob,
  getSite,
  getSettings,
  getTemplate,
  listSites,
  listTemplates,
  persistJobLogArtifact,
  saveJob,
  saveSettings,
  saveSite,
  upsertTemplate,
} from "./lib/db";
import { jsonError, requireString } from "./lib/http";
import { deleteSite, refreshJob, retryBuild, startDeploy } from "./services/deployer";
import { CloudflareClient } from "./services/cloudflare";
import { validateGithubTemplate } from "./services/github";
import { maskSecret, nowIso, parseGithubTemplateUrl, randomId } from "../shared/utils";
import type { CloudflareAccount, CloudflareBuildToken, CloudflareSettings, DeployRequest, JobStatus, PublicSettings, TemplateRecord } from "../shared/types";

type HonoEnv = {
  Bindings: Env;
  Variables: AppVariables;
};

type JobStatusInput = JobStatus | string | undefined;

const app = new Hono<HonoEnv>();

app.use("*", async (context, next) => {
  if (context.req.path.startsWith("/api")) {
    await ensureSchema(context.env);
  }
  await next();
});

app.use("/api/*", async (context, next) => {
  if (context.req.path === "/api/auth/login" || context.req.path === "/api/health" || context.req.path.startsWith("/api/runner/")) {
    await next();
    return;
  }
  if (!(await isAuthenticated(context.req.raw, context.env))) {
    return jsonError("Nao autenticado.", 401);
  }
  context.set("authenticated", true);
  await next();
});

app.get("/api/health", (context) => context.json({ ok: true }));

app.get("/api/me", async (context) => {
  const authenticated = await isAuthenticated(context.req.raw, context.env);
  return context.json({ authenticated });
});

app.post("/api/auth/login", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { password?: string };
  if (!context.env.APP_ADMIN_SECRET) return jsonError("APP_ADMIN_SECRET nao configurado.", 500);
  if (String(body.password || "") !== context.env.APP_ADMIN_SECRET) {
    return jsonError("Senha invalida.", 401);
  }
  return context.json(
    { success: true },
    200,
    {
      "Set-Cookie": await createSessionCookie(context.env),
    },
  );
});

app.post("/api/auth/logout", (context) => context.json({ success: true }, 200, { "Set-Cookie": clearSessionCookie() }));

app.get("/api/settings/cloudflare", async (context) => {
  const settings = await getSettings(context.env);
  return context.json(publicSettings(settings));
});

app.post("/api/settings/cloudflare", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as {
    cloudflareToken?: string;
    accountId?: string;
    accountName?: string;
    buildTokenUuid?: string;
    buildTokenName?: string;
    githubAppAcknowledged?: boolean;
    cloudflarePaidPlan?: boolean;
  };
  const current = await getSettings(context.env);
  const next: CloudflareSettings = {
    ...current,
    accountId: String(body.accountId ?? current.accountId ?? "").trim(),
    accountName: String(body.accountName ?? current.accountName ?? "").trim(),
    buildTokenUuid: String(body.buildTokenUuid ?? current.buildTokenUuid ?? "").trim(),
    buildTokenName: String(body.buildTokenName ?? current.buildTokenName ?? "").trim(),
    githubAppAcknowledged: Boolean(body.githubAppAcknowledged ?? current.githubAppAcknowledged),
    cloudflarePaidPlan: Boolean(body.cloudflarePaidPlan ?? current.cloudflarePaidPlan),
  };

  const token = String(body.cloudflareToken || "").trim();
  if (token) {
    const cf = new CloudflareClient(token);
    const accounts = await cf.accounts();
    if (!next.accountId && accounts.length === 1) {
      next.accountId = accounts[0].id;
      next.accountName = accounts[0].name;
    }
    if (next.accountId) {
      const matched = accounts.find((account) => account.id === next.accountId);
      next.accountName = matched?.name || next.accountName || "";
    }
    next.tokenCipher = await encryptText(token, context.env.TOKEN_ENCRYPTION_KEY);
    next.tokenMask = maskSecret(token);
  }

  if (!next.accountId) {
    return jsonError("Selecione ou informe o Account ID.");
  }
  await saveSettings(context.env, next);
  return context.json(publicSettings(next));
});

app.get("/api/cloudflare/accounts", async (context) => {
  const settings = await getSettings(context.env);
  const token = settings.tokenCipher ? await decryptText(settings.tokenCipher, context.env.TOKEN_ENCRYPTION_KEY) : "";
  if (!token) return jsonError("Cadastre o Cloudflare API Token primeiro.");
  const accounts = await new CloudflareClient(token).accounts();
  return context.json({ accounts });
});

app.post("/api/cloudflare/token-inspect", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { cloudflareToken?: string; accountId?: string };
  const token = requireString(body.cloudflareToken, "Cloudflare API Token");
  const requestedAccountId = String(body.accountId || "").trim();
  const accounts: CloudflareAccount[] = await new CloudflareClient(token).accounts();
  const selectedAccount = accounts.find((account) => account.id === requestedAccountId) || accounts[0] || null;

  return context.json({
    accounts,
    selectedAccountId: selectedAccount?.id || "",
    selectedAccountName: selectedAccount?.name || "",
  });
});

app.get("/api/cloudflare/build-tokens", async (context) => {
  const settings = await getSettings(context.env);
  const token = settings.tokenCipher ? await decryptText(settings.tokenCipher, context.env.TOKEN_ENCRYPTION_KEY) : "";
  if (!token) return jsonError("Cadastre o Cloudflare API Token primeiro.");
  if (!settings.accountId) return jsonError("Selecione o Account ID primeiro.");
  const buildTokens: CloudflareBuildToken[] = await new CloudflareClient(token, settings.accountId).publicBuildTokens();
  return context.json({ buildTokens });
});

app.get("/api/runner/jobs/:id", async (context) => {
  const unauthorized = authenticateRunner(context);
  if (unauthorized) return unauthorized;

  const job = await getJob(context.env, context.req.param("id"));
  if (!job) return jsonError("Job nao encontrado.", 404);
  const site = await getSite(context.env, job.siteId);
  if (!site) return jsonError("Site nao encontrado.", 404);
  const template = await getTemplate(context.env, site.templateId);
  if (!template) return jsonError("Template nao encontrado.", 404);
  const settings = await getSettings(context.env);
  const token = settings.tokenCipher ? await decryptText(settings.tokenCipher, context.env.TOKEN_ENCRYPTION_KEY) : "";
  if (!token || !settings.accountId) return jsonError("Cloudflare API Token ou Account ID nao configurado.", 400);

  return context.json({
    job: { id: job.id, operation: job.operation },
    site,
    template,
    cloudflare: {
      token,
      accountId: settings.accountId,
    },
    env: {
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: settings.accountId,
      AUTODEPLOY_ACCOUNT_ID: settings.accountId,
      AUTODEPLOY_WORKER_NAME: site.workerName,
      AUTODEPLOY_D1_NAME: site.d1Database,
      AUTODEPLOY_D1_ID: site.d1DatabaseId,
      AUTODEPLOY_R2_BUCKET: site.r2Bucket,
      AUTODEPLOY_KV_ID: site.kvNamespaceId,
      AUTODEPLOY_CUSTOM_DOMAIN: site.customDomain,
      AUTODEPLOY_SITE_NAME: site.siteName,
      AUTODEPLOY_WORKERS_DEV_URL: site.workersDevUrl,
      AUTODEPLOY_ADMIN_URL: site.adminUrl,
    },
  });
});

app.post("/api/runner/jobs/:id/events", async (context) => {
  const unauthorized = authenticateRunner(context);
  if (unauthorized) return unauthorized;

  const job = await getJob(context.env, context.req.param("id"));
  if (!job) return jsonError("Job nao encontrado.", 404);
  const body = (await context.req.json().catch(() => ({}))) as {
    message?: string;
    level?: string;
    step?: string;
    status?: JobStatusInput;
  };

  if (body.step || body.status) {
    const { logs: _logs, ...jobWithoutLogs } = job;
    await saveJob(context.env, {
      ...jobWithoutLogs,
      status: normalizeJobStatus(body.status) || job.status,
      currentStep: String(body.step || job.currentStep),
      updatedAt: nowIso(),
    });
  }
  if (body.message) {
    await addJobEvent(context.env, job.id, String(body.message), String(body.level || "info"));
  }
  await persistJobLogArtifact(context.env, job.id);
  return context.json({ success: true });
});

app.post("/api/runner/jobs/:id/complete", async (context) => {
  const unauthorized = authenticateRunner(context);
  if (unauthorized) return unauthorized;

  const job = await getJob(context.env, context.req.param("id"));
  if (!job) return jsonError("Job nao encontrado.", 404);
  const site = await getSite(context.env, job.siteId);
  if (!site) return jsonError("Site nao encontrado.", 404);
  const body = (await context.req.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    result?: Record<string, unknown>;
  };
  const { logs: _logs, ...jobWithoutLogs } = job;
  const success = body.success !== false;

  if (success) {
    site.status = site.customDomain && Object.keys(site.zone || {}).length === 0 ? "domain_pending" : "online";
    site.error = "";
    site.raw = { ...site.raw, directDeployResult: body.result || {} };
    site.updatedAt = nowIso();
    await saveSite(context.env, site);
    await saveJob(context.env, {
      ...jobWithoutLogs,
      status: "done",
      currentStep: "Deploy direto concluido",
      result: { site, ...(body.result || {}) },
      error: "",
      updatedAt: nowIso(),
    });
    await addJobEvent(context.env, job.id, "Deploy direto concluido com sucesso.");
  } else {
    const error = String(body.error || "Deploy direto falhou.");
    site.status = "failed";
    site.error = error;
    site.updatedAt = nowIso();
    await saveSite(context.env, site);
    await saveJob(context.env, {
      ...jobWithoutLogs,
      status: "failed",
      currentStep: "Deploy direto falhou",
      error,
      updatedAt: nowIso(),
    });
    await addJobEvent(context.env, job.id, `ERRO: ${error}`, "error");
  }

  await persistJobLogArtifact(context.env, job.id);
  return context.json({ success: true });
});

app.get("/api/templates", async (context) => context.json({ templates: await listTemplates(context.env) }));

app.post("/api/templates", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { name?: string; githubUrl?: string };
  const name = requireString(body.name, "Nome");
  const githubUrl = requireString(body.githubUrl, "URL do GitHub");
  parseGithubTemplateUrl(githubUrl);
  const info = await validateGithubTemplate(githubUrl);
  const now = nowIso();
  const template: TemplateRecord = {
    id: randomId("tpl_"),
    name,
    githubUrl,
    owner: info.owner,
    repo: info.repo,
    branch: info.branch,
    subdir: info.subdir,
    url: githubUrl,
    createdAt: now,
    updatedAt: now,
  };
  await upsertTemplate(context.env, template);
  return context.json({ template });
});

app.put("/api/templates/:id", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { name?: string; githubUrl?: string };
  const name = requireString(body.name, "Nome");
  const githubUrl = requireString(body.githubUrl, "URL do GitHub");
  const info = await validateGithubTemplate(githubUrl);
  const now = nowIso();
  const template: TemplateRecord = {
    id: context.req.param("id"),
    name,
    githubUrl,
    owner: info.owner,
    repo: info.repo,
    branch: info.branch,
    subdir: info.subdir,
    url: githubUrl,
    createdAt: now,
    updatedAt: now,
  };
  await upsertTemplate(context.env, template);
  return context.json({ template });
});

app.delete("/api/templates/:id", async (context) => {
  await deleteTemplate(context.env, context.req.param("id"));
  return context.json({ success: true });
});

app.get("/api/sites", async (context) => {
  let sites = await listSites(context.env);
  const shouldRefresh = context.req.query("refresh") === "1";
  const buildingSites = shouldRefresh ? sites.filter((site) => site.status === "building" && site.buildTriggerId) : [];
  if (buildingSites.length) {
    await Promise.all(
      buildingSites.map(async (site) => {
        const latestJob = await context.env.APP_DB.prepare("SELECT id FROM jobs WHERE site_id = ? ORDER BY created_at DESC LIMIT 1")
          .bind(site.id)
          .first<{ id: string }>();
        if (latestJob?.id) await refreshJob(context.env, latestJob.id);
      }),
    );
    sites = await listSites(context.env);
  }
  return context.json({ sites });
});

app.post("/api/sites/deploy", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as DeployRequest;
  const job = await startDeploy(context.env, body);
  return context.json({ job });
});

app.patch("/api/sites/:id", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "refresh") {
    const sites = await listSites(context.env);
    const site = sites.find((item) => item.id === context.req.param("id"));
    if (!site?.buildTriggerId) return jsonError("Site sem build para atualizar.", 400);
    const jobs = await context.env.APP_DB.prepare("SELECT id FROM jobs WHERE site_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(site.id)
      .first<{ id: string }>();
    const job = jobs?.id ? await refreshJob(context.env, jobs.id) : null;
    return context.json({ site: await getSite(context.env, site.id), job });
  }
  if (body.action === "retry-build") {
    const job = await retryBuild(context.env, context.req.param("id"));
    return context.json({ job });
  }
  return jsonError("Acao nao suportada.", 400);
});

app.delete("/api/sites/:id", async (context) => {
  const job = await deleteSite(context.env, context.req.param("id"));
  return context.json({ job });
});

app.get("/api/jobs/:id", async (context) => {
  const job = await refreshJob(context.env, context.req.param("id"));
  if (!job) return jsonError("Job nao encontrado.", 404);
  return context.json({ job });
});

app.get("/api/jobs/:id/logs", async (context) => {
  const id = context.req.param("id");
  const object = await context.env.APP_BUCKET.get(`jobs/${id}/cloudflare-build.log`)
    || await context.env.APP_BUCKET.get(`jobs/${id}/latest.log`);
  if (!object) {
    const job = await getJob(context.env, id);
    return new Response((job?.logs || []).join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(object.body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});

app.post("/api/domains/cleanup", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { customDomain?: string; workerName?: string };
  return context.json({
    message: "Limpeza de dominio ainda depende das APIs de routes/domains do Worker. Use excluir site para remover recursos principais.",
    input: body,
  });
});

app.onError((error) => jsonError(error instanceof Error ? error.message : String(error), 500));

app.get("*", async (context) => {
  return context.env.ASSETS.fetch(context.req.raw);
});

function authenticateRunner(context: Context<HonoEnv>): Response | null {
  const expected = String(context.env.RUNNER_SHARED_SECRET || "").trim();
  if (!expected) return jsonError("RUNNER_SHARED_SECRET nao configurado.", 500);
  const received = String(context.req.header("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (received !== expected) return jsonError("Runner nao autorizado.", 401);
  return null;
}

function normalizeJobStatus(status: JobStatusInput): JobStatus | null {
  if (status === "queued" || status === "running" || status === "done" || status === "failed") return status;
  return null;
}

function publicSettings(settings: CloudflareSettings): PublicSettings {
  return {
    hasToken: Boolean(settings.tokenCipher),
    tokenMask: settings.tokenMask || "",
    accountId: settings.accountId || "",
    accountName: settings.accountName || "",
    buildTokenUuid: settings.buildTokenUuid || "",
    buildTokenName: settings.buildTokenName || "",
    githubAppAcknowledged: Boolean(settings.githubAppAcknowledged),
    cloudflarePaidPlan: Boolean(settings.cloudflarePaidPlan),
  };
}

export default app;
