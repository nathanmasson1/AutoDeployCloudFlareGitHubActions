import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const appBaseUrl = requiredEnv("APP_BASE_URL").replace(/\/+$/, "");
const jobId = requiredEnv("JOB_ID");
const runnerSecret = requiredEnv("RUNNER_SHARED_SECRET");

const secretsToMask = [runnerSecret];

try {
  const payload = await runnerFetch(`/api/runner/jobs/${encodeURIComponent(jobId)}`);
  secretsToMask.push(payload.cloudflare.token);
  for (const secret of secretsToMask) {
    if (secret) console.log(`::add-mask::${secret}`);
  }

  const template = payload.template;
  const site = payload.site;
  const repoUrl = `https://github.com/${template.owner}/${template.repo}.git`;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "auto-deploy-cloudflare-"));
  const repoDir = path.join(tempRoot, "template");
  const deployEnv = {
    ...process.env,
    ...payload.env,
    CI: "1",
    CLOUDFLARE_API_TOKEN: payload.cloudflare.token,
    CLOUDFLARE_ACCOUNT_ID: payload.cloudflare.accountId,
    WRANGLER_SEND_METRICS: "false",
  };

  await postEvent("Clonando template publico no runner GitHub Actions", "GitHub Actions: clonando template");
  await run("git", ["clone", "--depth", "1", "--branch", template.branch || "main", repoUrl, repoDir], { cwd: tempRoot, env: deployEnv });

  const workDir = path.resolve(repoDir, template.subdir || ".");
  await postEvent(`Template pronto em ${template.owner}/${template.repo}@${template.branch || "main"}`, "GitHub Actions: preparando template");

  await runIfExists("scripts/autodeploy-prepare.mjs", workDir, deployEnv);

  if (await fileExists(path.join(workDir, "package.json"))) {
    const installCommand = (await fileExists(path.join(workDir, "package-lock.json"))) ? "ci" : "install";
    await postEvent(`Instalando dependencias com npm ${installCommand}`, "GitHub Actions: instalando dependencias");
    await run("npm", [installCommand], { cwd: workDir, env: deployEnv });

    const pkg = JSON.parse(await readFile(path.join(workDir, "package.json"), "utf8"));
    if (pkg.scripts?.build) {
      await postEvent("Rodando npm run build", "GitHub Actions: build");
      await run("npm", ["run", "build"], { cwd: workDir, env: deployEnv });
    }
  }

  await runIfExists("scripts/prepare-cloudflare-assets.mjs", workDir, deployEnv);

  if (await fileExists(path.join(workDir, "scripts/autodeploy-deploy.mjs"))) {
    await postEvent("Publicando Worker/assets direto na Cloudflare", "GitHub Actions: deploy direto");
    await run("node", ["scripts/autodeploy-deploy.mjs"], { cwd: workDir, env: deployEnv });
  } else {
    await postEvent("Publicando com wrangler deploy", "GitHub Actions: wrangler deploy");
    await run("npx", ["wrangler", "deploy"], { cwd: workDir, env: deployEnv });
  }

  await postComplete(true, {
    workerName: site.workerName,
    workersDevUrl: site.workersDevUrl,
    adminUrl: site.adminUrl,
  });
  await rm(tempRoot, { recursive: true, force: true });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await postEvent(`ERRO: ${message}`, "GitHub Actions: falhou", "error").catch(() => undefined);
  await postComplete(false, { error: message }).catch(() => undefined);
  throw error;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} nao configurado.`);
  return value;
}

async function runnerFetch(pathname, init = {}) {
  const response = await fetch(`${appBaseUrl}${pathname}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${runnerSecret}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `Runner API respondeu HTTP ${response.status}`);
  }
  return payload;
}

async function postEvent(message, step = "", level = "info") {
  return runnerFetch(`/api/runner/jobs/${encodeURIComponent(jobId)}/events`, {
    method: "POST",
    body: JSON.stringify({
      message,
      step,
      status: "running",
      level,
    }),
  });
}

async function postComplete(success, result) {
  return runnerFetch(`/api/runner/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    body: JSON.stringify({
      success,
      error: success ? "" : result.error,
      result,
    }),
  });
}

async function runIfExists(scriptPath, cwd, env) {
  if (!(await fileExists(path.join(cwd, scriptPath)))) return;
  await postEvent(`Rodando ${scriptPath}`, `GitHub Actions: ${scriptPath}`);
  await run("node", [scriptPath], { cwd, env });
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function run(command, args, options) {
  const printable = [command, ...args].join(" ");
  console.log(`$ ${printable}`);

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === "win32",
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = maskSecrets(String(chunk));
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = maskSecrets(String(chunk));
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Comando falhou (${code}): ${printable}\n${output.slice(-8000)}`));
    });
  });
}

function maskSecrets(text) {
  return secretsToMask.reduce((current, secret) => (secret ? current.replaceAll(secret, "***") : current), text);
}
