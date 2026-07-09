import type { GithubTemplateInfo } from "./types";

export const DEFAULT_BUILD_COMMAND = "npm ci && npm run build";

export const DEFAULT_DEPLOY_COMMAND = "node scripts/autodeploy-deploy.mjs";

export const REQUIRED_TEMPLATE_PATHS = [
  { path: "package.json", type: "file" },
  { path: "astro.config.mjs", type: "file" },
  { path: "wrangler.jsonc", type: "file" },
  { path: "src", type: "dir" },
  { path: "public", type: "dir" },
  { path: "migrations", type: "dir" },
  { path: "scripts/export-posts-d1-sql.mjs", type: "file" },
  { path: "scripts/export-site-data-d1-sql.mjs", type: "file" },
  { path: "scripts/prepare-cloudflare-assets.mjs", type: "file" },
  { path: "scripts/autodeploy-prepare.mjs", type: "file" },
  { path: "scripts/autodeploy-deploy.mjs", type: "file" },
] as const;

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return (normalized || "meu-site").slice(0, 48).replace(/-+$/g, "") || "meu-site";
}

export function normalizeDomain(value: string): string {
  const raw = String(value || "").trim().toLowerCase().replaceAll("\\", "/");
  if (!raw) return "";

  try {
    const target = /^[a-z][a-z0-9+.-]*:\/\//.test(raw) || raw.startsWith("//")
      ? raw
      : `https://${raw.replace(/^\/+/, "")}`;
    return new URL(target).hostname.replace(/^\.+|\.+$/g, "");
  } catch {
    return raw
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
      .replace(/^\/+/, "")
      .split(/[/?#]/)[0]
      .split("@")
      .pop()!
      .split(":")[0]
      .replace(/^\.+|\.+$/g, "");
  }
}

export function isValidDomain(value: string): boolean {
  if (!value || value.length > 253 || value.includes("*")) return false;
  const labels = value.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 10) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function randomId(prefix = ""): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}${hex}`;
}

export function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function parseGithubTemplateUrl(value: string): GithubTemplateInfo {
  const raw = value.trim();
  if (!raw) {
    throw new Error("Informe uma URL de template no GitHub.");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("URL do GitHub invalida.");
  }

  if (!["github.com", "www.github.com"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("A URL do template precisa ser do GitHub.");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("URL do GitHub incompleta. Use https://github.com/usuario/repositorio.");
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  let branch = "";
  let subdir = "";
  if (parts.length >= 4 && parts[2] === "tree") {
    branch = parts[3];
    subdir = parts.slice(4).join("/");
  }

  return { owner, repo, branch, subdir, url: raw };
}

export function namesForSite(siteName: string) {
  const slug = slugify(siteName);
  const short = slug.slice(0, 40).replace(/-+$/g, "") || "site";
  return {
    slug,
    workerName: short,
    d1Name: `${short}-db`,
    r2BucketName: `${short}-media`.slice(0, 63).replace(/-+$/g, ""),
    kvName: `${short}-session`,
  };
}

export function guessZoneName(hostname: string): string {
  const labels = normalizeDomain(hostname).split(".");
  if (labels.length <= 2) return labels.join(".");

  const secondLevelBr = new Set([
    "com",
    "net",
    "org",
    "gov",
    "edu",
    "mil",
    "jus",
    "leg",
    "med",
    "adv",
    "eng",
    "arq",
    "cont",
    "adm",
    "inf",
    "tur",
    "tv",
    "blog",
  ]);

  if (labels.at(-1) === "br" && secondLevelBr.has(labels.at(-2) || "")) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

export function escapeLikeLog(value: string, secrets: string[]): string {
  return secrets.reduce((text, secret) => (secret ? text.replaceAll(secret, "***") : text), value);
}
