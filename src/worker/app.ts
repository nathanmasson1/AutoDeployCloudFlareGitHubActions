import { Hono, type Context } from "hono";
import type { Env, AppVariables } from "./env";
import { clearSessionCookie, createSessionCookie, getSessionUser } from "./lib/auth";
import { decryptText, encryptText } from "./lib/crypto";
import {
  DEFAULT_CLIENT_ID,
  addJobEvent,
  countUsers,
  deleteTemplate,
  ensureSchema,
  getFirstAdminUser,
  getClient,
  getJob,
  getSite,
  getSettings,
  getStoredUser,
  getStoredUserByEmail,
  getTemplate,
  getUser,
  listClients,
  listSites,
  listTemplates,
  listUsers,
  normalizeEmail,
  persistJobLogArtifact,
  saveJob,
  saveSettings,
  saveSite,
  upsertClient,
  upsertTemplate,
  upsertUser,
} from "./lib/db";
import { jsonError, requireString } from "./lib/http";
import { hashPassword, verifyPassword } from "./lib/password";
import { deleteSite, refreshJob, retryBuild, startDeploy } from "./services/deployer";
import { CloudflareClient } from "./services/cloudflare";
import { validateGithubTemplate } from "./services/github";
import { maskSecret, nowIso, parseGithubTemplateUrl, randomId } from "../shared/utils";
import type { CloudflareAccount, CloudflareBuildToken, CloudflareSettings, DeployRequest, JobStatus, PublicSettings, TemplateRecord, UserRecord, UserRole } from "../shared/types";

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
  const sessionUser = await getSessionUser(context.req.raw, context.env);
  if (!sessionUser) {
    return jsonError("Nao autenticado.", 401);
  }
  const user = await getUser(context.env, sessionUser.id);
  if (!user?.active) {
    return jsonError("Nao autenticado.", 401);
  }
  context.set("authenticated", true);
  context.set("currentUser", user);
  await next();
});

app.get("/api/health", (context) => context.json({ ok: true }));

app.get("/api/me", async (context) => {
  const sessionUser = await getSessionUser(context.req.raw, context.env);
  const user = sessionUser ? await getUser(context.env, sessionUser.id) : null;
  return context.json({ authenticated: Boolean(user?.active), user: user?.active ? user : null });
});

app.post("/api/auth/login", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!context.env.APP_ADMIN_SECRET) return jsonError("APP_ADMIN_SECRET nao configurado.", 500);
  const password = String(body.password || "");
  if (!password) return jsonError("Informe a senha.", 400);

  let user: UserRecord | null = null;
  const userCount = await countUsers(context.env);

  if (userCount === 0) {
    if (password !== context.env.APP_ADMIN_SECRET) return jsonError("Senha inicial invalida.", 401);
    const now = nowIso();
    user = {
      id: randomId("user_"),
      clientId: DEFAULT_CLIENT_ID,
      role: "admin",
      name: "Administrador",
      email: normalizeEmail(body.email || "admin@local"),
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await upsertUser(context.env, { ...user, passwordHash: await hashPassword(password) });
  } else {
    const email = normalizeEmail(body.email || "");
    const storedUser = email ? await getStoredUserByEmail(context.env, email) : null;
    if (storedUser?.active && (await verifyPassword(password, storedUser.passwordHash))) {
      user = storedUser;
    } else if (!email && password === context.env.APP_ADMIN_SECRET) {
      user = await getFirstAdminUser(context.env);
    }
  }

  if (!user?.active) return jsonError("Email ou senha invalido.", 401);

  return context.json(
    { success: true, user },
    200,
    {
      "Set-Cookie": await createSessionCookie(context.env, user),
    },
  );
});

app.post("/api/auth/logout", (context) => context.json({ success: true }, 200, { "Set-Cookie": clearSessionCookie() }));

app.get("/api/clients", async (context) => {
  const user = currentUser(context);
  const allClients = await listClients(context.env);
  const visibleClients = user.role === "admin" ? allClients : allClients.filter((client) => client.id === user.clientId);
  const clients = await Promise.all(
    visibleClients.map(async (client) => ({
      ...client,
      settings: publicSettings(await getSettings(context.env, client.id)),
    })),
  );
  return context.json({ clients });
});

app.post("/api/clients", async (context) => {
  const unauthorized = requireAdmin(context);
  if (unauthorized) return unauthorized;
  const body = (await context.req.json().catch(() => ({}))) as { id?: string; name?: string; email?: string };
  const id = String(body.id || randomId("client_")).trim();
  const name = requireString(body.name, "Nome do cliente");
  const email = String(body.email || "").trim();
  const current = await getClient(context.env, id);
  const now = nowIso();
  const client = {
    id,
    name,
    email,
    createdAt: current?.createdAt || now,
    updatedAt: now,
  };
  await upsertClient(context.env, client);
  return context.json({ client });
});

app.get("/api/users", async (context) => {
  const unauthorized = requireAdmin(context);
  if (unauthorized) return unauthorized;
  return context.json({ users: await listUsers(context.env) });
});

app.post("/api/users", async (context) => {
  const unauthorized = requireAdmin(context);
  if (unauthorized) return unauthorized;
  const body = (await context.req.json().catch(() => ({}))) as {
    id?: string;
    clientId?: string;
    role?: UserRole;
    name?: string;
    email?: string;
    password?: string;
    active?: boolean;
  };
  const id = String(body.id || randomId("user_")).trim();
  const current = body.id ? await getStoredUser(context.env, id) : null;
  const role: UserRole = body.role === "admin" ? "admin" : "client";
  const clientId = role === "admin" ? DEFAULT_CLIENT_ID : String(body.clientId || "").trim();
  if (role === "client" && !(await getClient(context.env, clientId))) return jsonError("Cliente do usuario nao encontrado.", 400);
  const name = requireString(body.name, "Nome do usuario");
  const email = normalizeEmail(requireString(body.email, "Email do usuario"));
  if (!email.includes("@")) return jsonError("Email do usuario invalido.", 400);
  const userWithEmail = await getStoredUserByEmail(context.env, email);
  if (userWithEmail && userWithEmail.id !== id) return jsonError("Ja existe um usuario com este email.", 400);
  const password = String(body.password || "");
  if (!current && !password) return jsonError("Informe uma senha inicial para o usuario.", 400);
  const now = nowIso();
  const user = {
    id,
    clientId,
    role,
    name,
    email,
    active: body.active !== false,
    createdAt: current?.createdAt || now,
    updatedAt: now,
    passwordHash: password ? await hashPassword(password) : current!.passwordHash,
  };
  await upsertUser(context.env, user);
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return context.json({ user: publicUser });
});

app.get("/api/settings/cloudflare", async (context) => {
  const user = currentUser(context);
  const settings = await getSettings(context.env, user.role === "admin" ? DEFAULT_CLIENT_ID : user.clientId);
  return context.json(publicSettings(settings));
});

app.get("/api/clients/:clientId/settings/cloudflare", async (context) => {
  const clientId = accessibleClientId(context, context.req.param("clientId") || DEFAULT_CLIENT_ID);
  if (!clientId) return jsonError("Sem permissao para acessar este cliente.", 403);
  if (!(await getClient(context.env, clientId))) return jsonError("Cliente nao encontrado.", 404);
  const settings = await getSettings(context.env, clientId);
  return context.json(publicSettings(settings));
});

app.post("/api/settings/cloudflare", async (context) => {
  const user = currentUser(context);
  return saveCloudflareSettings(context, user.role === "admin" ? DEFAULT_CLIENT_ID : user.clientId);
});

app.post("/api/clients/:clientId/settings/cloudflare", async (context) => {
  const clientId = accessibleClientId(context, context.req.param("clientId") || DEFAULT_CLIENT_ID);
  if (!clientId) return jsonError("Sem permissao para alterar este cliente.", 403);
  return saveCloudflareSettings(context, clientId);
});

async function saveCloudflareSettings(context: Context<HonoEnv>, clientId: string) {
  if (!(await getClient(context.env, clientId))) return jsonError("Cliente nao encontrado.", 404);
  const body = (await context.req.json().catch(() => ({}))) as {
    cloudflareToken?: string;
    accountId?: string;
    accountName?: string;
    buildTokenUuid?: string;
    buildTokenName?: string;
    githubAppAcknowledged?: boolean;
    cloudflarePaidPlan?: boolean;
  };
  const current = await getSettings(context.env, clientId);
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
  await saveSettings(context.env, next, clientId);
  return context.json(publicSettings(next));
}

app.get("/api/cloudflare/accounts", async (context) => {
  const user = currentUser(context);
  const clientId = accessibleClientId(context, context.req.query("clientId") || (user.role === "admin" ? DEFAULT_CLIENT_ID : user.clientId));
  if (!clientId) return jsonError("Sem permissao para acessar este cliente.", 403);
  const settings = await getSettings(context.env, clientId);
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
  const user = currentUser(context);
  const clientId = accessibleClientId(context, context.req.query("clientId") || (user.role === "admin" ? DEFAULT_CLIENT_ID : user.clientId));
  if (!clientId) return jsonError("Sem permissao para acessar este cliente.", 403);
  const settings = await getSettings(context.env, clientId);
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
  const settings = await getSettings(context.env, site.clientId);
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
  const unauthorized = requireAdmin(context);
  if (unauthorized) return unauthorized;
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
  const unauthorized = requireAdmin(context);
  if (unauthorized) return unauthorized;
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
  const unauthorized = requireAdmin(context);
  if (unauthorized) return unauthorized;
  await deleteTemplate(context.env, context.req.param("id"));
  return context.json({ success: true });
});

app.get("/api/sites", async (context) => {
  const user = currentUser(context);
  const requestedClientId = context.req.query("clientId") || "";
  const clientId = user.role === "admin" ? requestedClientId : user.clientId;
  let sites = await listSites(context.env, clientId);
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
    sites = await listSites(context.env, clientId);
  }
  return context.json({ sites });
});

app.post("/api/sites/deploy", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as DeployRequest;
  const user = currentUser(context);
  const clientId = accessibleClientId(context, body.clientId || user.clientId || DEFAULT_CLIENT_ID);
  if (!clientId) return jsonError("Sem permissao para criar site neste cliente.", 403);
  const job = await startDeploy(context.env, { ...body, clientId });
  return context.json({ job });
});

app.patch("/api/sites/:id", async (context) => {
  const body = (await context.req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "refresh") {
    const site = await getSite(context.env, context.req.param("id"));
    if (site && !canAccessClient(context, site.clientId)) return jsonError("Sem permissao para acessar este site.", 403);
    if (!site?.buildTriggerId) return jsonError("Site sem build para atualizar.", 400);
    const jobs = await context.env.APP_DB.prepare("SELECT id FROM jobs WHERE site_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(site.id)
      .first<{ id: string }>();
    const job = jobs?.id ? await refreshJob(context.env, jobs.id) : null;
    return context.json({ site: await getSite(context.env, site.id), job });
  }
  if (body.action === "retry-build") {
    const site = await getSite(context.env, context.req.param("id"));
    if (!site) return jsonError("Site nao encontrado.", 404);
    if (!canAccessClient(context, site.clientId)) return jsonError("Sem permissao para acessar este site.", 403);
    const job = await retryBuild(context.env, context.req.param("id"));
    return context.json({ job });
  }
  return jsonError("Acao nao suportada.", 400);
});

app.delete("/api/sites/:id", async (context) => {
  const site = await getSite(context.env, context.req.param("id"));
  if (!site) return jsonError("Site nao encontrado.", 404);
  if (!canAccessClient(context, site.clientId)) return jsonError("Sem permissao para acessar este site.", 403);
  const job = await deleteSite(context.env, context.req.param("id"));
  return context.json({ job });
});

app.get("/api/jobs/:id", async (context) => {
  const current = await getJob(context.env, context.req.param("id"));
  if (!current) return jsonError("Job nao encontrado.", 404);
  if (!canAccessClient(context, current.clientId)) return jsonError("Sem permissao para acessar este job.", 403);
  const job = await refreshJob(context.env, context.req.param("id"));
  if (!job) return jsonError("Job nao encontrado.", 404);
  return context.json({ job });
});

app.get("/api/jobs/:id/logs", async (context) => {
  const id = context.req.param("id");
  const job = await getJob(context.env, id);
  if (!job) return jsonError("Job nao encontrado.", 404);
  if (!canAccessClient(context, job.clientId)) return jsonError("Sem permissao para acessar este job.", 403);
  const object = await context.env.APP_BUCKET.get(`jobs/${id}/cloudflare-build.log`)
    || await context.env.APP_BUCKET.get(`jobs/${id}/latest.log`);
  if (!object) {
    return new Response((job?.logs || []).join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(object.body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});

app.post("/api/domains/cleanup", async (context) => {
  const unauthorized = requireAdmin(context);
  if (unauthorized) return unauthorized;
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

function currentUser(context: Context<HonoEnv>): UserRecord {
  return context.get("currentUser");
}

function requireAdmin(context: Context<HonoEnv>): Response | null {
  return currentUser(context).role === "admin" ? null : jsonError("Apenas administradores podem fazer isso.", 403);
}

function canAccessClient(context: Context<HonoEnv>, clientId: string): boolean {
  const user = currentUser(context);
  return user.role === "admin" || user.clientId === clientId;
}

function accessibleClientId(context: Context<HonoEnv>, requestedClientId: string): string {
  const user = currentUser(context);
  const clientId = String(requestedClientId || DEFAULT_CLIENT_ID).trim() || DEFAULT_CLIENT_ID;
  if (user.role === "admin") return clientId;
  return user.clientId === clientId ? clientId : "";
}

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
