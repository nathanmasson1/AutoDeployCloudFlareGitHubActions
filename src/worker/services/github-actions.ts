import type { Env } from "../env";

function required(value: string | undefined, name: string): string {
  const clean = String(value || "").trim();
  if (!clean) throw new Error(`${name} nao configurado para disparar GitHub Actions.`);
  return clean;
}

export async function dispatchGitHubActionsDeploy(env: Env, jobId: string): Promise<void> {
  const owner = required(env.GITHUB_ACTIONS_OWNER, "GITHUB_ACTIONS_OWNER");
  const repo = required(env.GITHUB_ACTIONS_REPO, "GITHUB_ACTIONS_REPO");
  const token = required(env.GITHUB_ACTIONS_TOKEN, "GITHUB_ACTIONS_TOKEN");
  const appBaseUrl = required(env.APP_BASE_URL, "APP_BASE_URL").replace(/\/+$/, "");
  const workflow = String(env.GITHUB_ACTIONS_WORKFLOW || "direct-deploy.yml").trim();
  const ref = String(env.GITHUB_ACTIONS_REF || "main").trim();

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "auto-deploy-cloudflare",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref,
      inputs: {
        app_base_url: appBaseUrl,
        job_id: jobId,
      },
    }),
  });

  if (response.status !== 204) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Nao consegui disparar GitHub Actions (${response.status}). ${detail}`.trim());
  }
}
