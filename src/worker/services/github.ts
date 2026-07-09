import type { GithubTemplateInfo } from "../../shared/types";
import { parseGithubTemplateUrl, REQUIRED_TEMPLATE_PATHS } from "../../shared/utils";

interface GithubRepo {
  id: number;
  name: string;
  default_branch: string;
  owner: {
    id: number;
    login: string;
  };
}

interface GithubContent {
  type: "file" | "dir" | string;
  path: string;
}

type GithubContentResponse = GithubContent | GithubContent[];

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "auto-deploy-cloudflare",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub respondeu ${response.status} para ${url}`);
  }
  return response.json() as Promise<T>;
}

export async function resolveGithubTemplate(url: string): Promise<GithubTemplateInfo & { repoId: string; ownerId: string }> {
  const parsed = parseGithubTemplateUrl(url);
  try {
    const repo = await githubJson<GithubRepo>(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`);
    return {
      ...parsed,
      branch: parsed.branch || repo.default_branch || "main",
      repoId: String(repo.id),
      ownerId: String(repo.owner.id),
    };
  } catch (error) {
    if (!isGithubApiLimited(error)) throw error;
    const ids = await resolveGithubIdsFromHtml(parsed.owner, parsed.repo);
    return {
      ...parsed,
      branch: parsed.branch || "main",
      repoId: ids.repoId,
      ownerId: ids.ownerId,
    };
  }
}

export async function validateGithubTemplate(url: string): Promise<GithubTemplateInfo & { repoId: string; ownerId: string }> {
  const info = await resolveGithubTemplate(url);
  const missing: string[] = [];
  for (const required of REQUIRED_TEMPLATE_PATHS) {
    const path = [info.subdir, required.path].filter(Boolean).join("/");
    const endpoint = `https://api.github.com/repos/${info.owner}/${info.repo}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}?ref=${encodeURIComponent(info.branch)}`;
    try {
      const content = await githubJson<GithubContentResponse>(endpoint);
      if (!contentMatches(content, required.type)) missing.push(`${required.path} (${required.type})`);
    } catch (error) {
      const exists = isGithubApiLimited(error) ? await githubPathExists(info, path, required.type) : false;
      if (!exists) missing.push(`${required.path} (${required.type})`);
    }
  }
  if (missing.length) {
    throw new Error(`Template incompatível. Itens ausentes: ${missing.join(", ")}.`);
  }
  return info;
}

function contentMatches(content: GithubContentResponse, expectedType: "file" | "dir"): boolean {
  if (Array.isArray(content)) return expectedType === "dir";
  return content.type === expectedType;
}

function isGithubApiLimited(error: unknown): boolean {
  return error instanceof Error && error.message.includes("GitHub respondeu 403");
}

async function resolveGithubIdsFromHtml(owner: string, repo: string): Promise<{ repoId: string; ownerId: string }> {
  const html = await githubText(`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  const repoId = extractMetaContent(html, "octolytics-dimension-repository_id");
  const ownerId = extractMetaContent(html, "octolytics-dimension-user_id");
  if (!repoId || !ownerId) {
    throw new Error("GitHub API respondeu 403 e nao foi possivel resolver repoId/ownerId pelo HTML publico do GitHub.");
  }
  return { repoId, ownerId };
}

async function githubPathExists(
  info: GithubTemplateInfo,
  path: string,
  expectedType: "file" | "dir",
): Promise<boolean> {
  const mode = expectedType === "dir" ? "tree" : "blob";
  const encodedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const url = `https://github.com/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/${mode}/${encodeURIComponent(info.branch)}/${encodedPath}`;
  const response = await fetch(url, {
    headers: {
      "Accept": "text/html",
      "User-Agent": "auto-deploy-cloudflare",
    },
  });
  return response.ok;
}

async function githubText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "Accept": "text/html",
      "User-Agent": "auto-deploy-cloudflare",
    },
  });
  if (!response.ok) throw new Error(`GitHub respondeu ${response.status} para ${url}`);
  return response.text();
}

function extractMetaContent(html: string, name: string): string {
  const tags = html.match(/<meta[^>]+>/gi) || [];
  const tag = tags.find((item) => item.includes(`name="${name}"`) || item.includes(`name='${name}'`));
  return tag?.match(/\scontent=["']([^"']+)["']/i)?.[1] || "";
}
