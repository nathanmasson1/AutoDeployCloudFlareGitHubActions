import type { CloudflareAccount, CloudflareBuildToken } from "../../shared/types";
import { cloudflareErrorMessage } from "../lib/http";

const API_BASE = "https://api.cloudflare.com/client/v4";

export interface CloudflareApiResponse<T> {
  success: boolean;
  result: T;
  errors?: Array<{ message?: string; code?: number }>;
  messages?: unknown[];
}

export interface D1DatabaseResult {
  uuid?: string;
  name?: string;
}

export interface KvNamespaceResult {
  id?: string;
  title?: string;
}

export interface R2BucketResult {
  name?: string;
}

export interface WorkerScriptSummary {
  id?: string;
  tag?: string;
}

export interface BuildToken {
  uuid?: string;
  id?: string;
  name?: string;
  build_token_uuid?: string;
  build_token_name?: string;
  cloudflare_token_id?: string;
}

export interface BuildTrigger {
  uuid?: string;
  id?: string;
  trigger_uuid?: string;
}

export interface BuildRecord {
  uuid?: string;
  id?: string;
  build_uuid?: string;
  status?: string;
  outcome?: string;
  build_outcome?: string;
  created_on?: string;
  finished_on?: string;
  deployment_id?: string;
  version_id?: string;
}

function listFromResult<T>(result: unknown, nestedKeys: string[] = []): T[] {
  if (Array.isArray(result)) return result as T[];
  if (!result || typeof result !== "object") return [];
  const record = result as Record<string, unknown>;
  for (const key of nestedKeys) {
    const value = record[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

export class CloudflareClient {
  constructor(
    private readonly token: string,
    private readonly accountId = "",
  ) {}

  async request<T>(method: string, path: string, body?: unknown, extraHeaders: HeadersInit = {}): Promise<CloudflareApiResponse<T>> {
    const headers = new Headers(extraHeaders);
    headers.set("Authorization", `Bearer ${this.token}`);
    if (body !== undefined && !(body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as CloudflareApiResponse<T>) : ({ success: response.ok, result: null as T } as CloudflareApiResponse<T>);
    if (!response.ok || payload.success === false) {
      throw new Error(this.explainCloudflareError(path, cloudflareErrorMessage(payload)));
    }
    return payload;
  }

  private explainCloudflareError(path: string, message: string): string {
    if (path.includes("/builds/") && /authentication error/i.test(message)) {
      return [
        "Token Cloudflare sem acesso a Workers Builds.",
        "Crie um novo token user-scoped com Account > Workers Builds Configuration > Edit, D1 > Edit, Workers R2 Storage > Edit, Workers KV Storage > Edit, Workers Scripts > Edit, Account Settings > Edit, Zone > Zone > Read, Zone > Zone > Edit, Zone > DNS > Edit e Zone > Workers Routes > Edit.",
        "Depois salve o novo token em Credenciais e tente criar o site novamente.",
      ].join(" ");
    }
    return message;
  }

  async assertBuildsAccess(): Promise<void> {
    await this.listBuildTokens();
  }

  async accounts(): Promise<CloudflareAccount[]> {
    const payload = await this.request<unknown>("GET", "/accounts");
    return listFromResult<CloudflareAccount>(payload.result, ["accounts"]);
  }

  async listD1(): Promise<D1DatabaseResult[]> {
    const payload = await this.request<unknown>("GET", `/accounts/${this.accountId}/d1/database`);
    return listFromResult<D1DatabaseResult>(payload.result, ["databases"]);
  }

  async createD1(name: string): Promise<D1DatabaseResult> {
    const payload = await this.request<D1DatabaseResult>("POST", `/accounts/${this.accountId}/d1/database`, {
      name,
      primary_location_hint: "enam",
    });
    return payload.result;
  }

  async ensureD1(name: string): Promise<D1DatabaseResult> {
    const existing = (await this.listD1()).find((database) => database.name === name);
    return existing || this.createD1(name);
  }

  async listR2(): Promise<R2BucketResult[]> {
    const payload = await this.request<unknown>("GET", `/accounts/${this.accountId}/r2/buckets`);
    return listFromResult<R2BucketResult>(payload.result, ["buckets"]);
  }

  async createR2(name: string): Promise<R2BucketResult> {
    const payload = await this.request<R2BucketResult>("POST", `/accounts/${this.accountId}/r2/buckets`, {
      name,
      locationHint: "enam",
    });
    return payload.result;
  }

  async ensureR2(name: string): Promise<R2BucketResult> {
    const existing = (await this.listR2()).find((bucket) => bucket.name === name);
    return existing || this.createR2(name);
  }

  async listKv(): Promise<KvNamespaceResult[]> {
    const payload = await this.request<unknown>("GET", `/accounts/${this.accountId}/storage/kv/namespaces`);
    return listFromResult<KvNamespaceResult>(payload.result, ["namespaces"]);
  }

  async createKv(title: string): Promise<KvNamespaceResult> {
    const payload = await this.request<KvNamespaceResult>("POST", `/accounts/${this.accountId}/storage/kv/namespaces`, { title });
    return payload.result;
  }

  async ensureKv(title: string): Promise<KvNamespaceResult> {
    const existing = (await this.listKv()).find((namespace) => namespace.title === title);
    return existing || this.createKv(title);
  }

  async uploadWorkerPlaceholder(workerName: string): Promise<void> {
    const metadata = {
      main_module: "index.js",
      compatibility_date: "2026-07-08",
      compatibility_flags: ["nodejs_compat"],
      bindings: [],
    };
    const source = `export default { async fetch() { return new Response("Provisioned by Auto Deploy Cloudflare"); } };`;
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("index.js", new Blob([source], { type: "application/javascript+module" }), "index.js");
    await this.request("PUT", `/accounts/${this.accountId}/workers/scripts/${workerName}`, form);
  }

  async putWorkerSecret(workerName: string, name: string, text: string): Promise<void> {
    await this.request("PUT", `/accounts/${this.accountId}/workers/scripts/${workerName}/secrets`, {
      name,
      text,
      type: "secret_text",
    });
  }

  async listWorkerScripts(): Promise<WorkerScriptSummary[]> {
    const payload = await this.request<unknown>("GET", `/accounts/${this.accountId}/workers/scripts`);
    return listFromResult<WorkerScriptSummary>(payload.result, ["scripts"]);
  }

  async getWorkerTag(workerName: string): Promise<string> {
    const scripts = await this.listWorkerScripts();
    const found = scripts.find((script) => script.id === workerName);
    if (!found?.tag) {
      throw new Error(`Worker ${workerName} foi criado, mas a tag nao apareceu na API.`);
    }
    return found.tag;
  }

  async getWorkersDevSubdomain(): Promise<string> {
    const payload = await this.request<Record<string, string>>("GET", `/accounts/${this.accountId}/workers/subdomain`);
    return payload.result?.subdomain || payload.result?.name || "";
  }

  async findZone(name: string): Promise<Record<string, unknown> | null> {
    const payload = await this.request<unknown>("GET", `/zones?name=${encodeURIComponent(name)}&account.id=${encodeURIComponent(this.accountId)}`);
    return listFromResult<Record<string, unknown>>(payload.result, ["zones"])[0] || null;
  }

  async createZone(name: string): Promise<Record<string, unknown>> {
    const payload = await this.request<Record<string, unknown>>("POST", "/zones", {
      account: { id: this.accountId },
      name,
      type: "full",
    });
    return payload.result;
  }

  async ensureZone(name: string): Promise<Record<string, unknown>> {
    return (await this.findZone(name)) || this.createZone(name);
  }

  async connectRepository(input: {
    providerAccountId: string;
    providerAccountName: string;
    repoId: string;
    repoName: string;
  }): Promise<string> {
    const payload = await this.request<Record<string, unknown>>("PUT", `/accounts/${this.accountId}/builds/repos/connections`, {
      provider_type: "github",
      provider_account_id: input.providerAccountId,
      provider_account_name: input.providerAccountName,
      repo_id: input.repoId,
      repo_name: input.repoName,
    });
    return String(payload.result?.repo_connection_uuid || payload.result?.uuid || payload.result?.id || "");
  }

  async listBuildTokens(): Promise<BuildToken[]> {
    const payload = await this.request<unknown>("GET", `/accounts/${this.accountId}/builds/tokens`);
    return listFromResult<BuildToken>(payload.result, ["tokens"]);
  }

  async publicBuildTokens(): Promise<CloudflareBuildToken[]> {
    return (await this.listBuildTokens())
      .map((token) => ({
        uuid: token.build_token_uuid || token.uuid || token.id || "",
        name: token.build_token_name || token.name || "Build token sem nome",
        cloudflareTokenId: token.cloudflare_token_id || "",
      }))
      .filter((token) => token.uuid);
  }

  async ensureBuildToken(preferredUuid = ""): Promise<string> {
    const tokens = await this.listBuildTokens();
    const preferred = preferredUuid
      ? tokens.find((candidate) => [candidate.build_token_uuid, candidate.uuid, candidate.id].includes(preferredUuid))
      : null;
    if (preferredUuid && !preferred) return preferredUuid;
    if (preferred) return preferred.build_token_uuid || preferred.uuid || preferred.id || preferredUuid;
    if (tokens.length > 1) {
      throw new Error("Selecione um Build token em Credenciais antes de criar sites. Evitei escolher automaticamente porque ha mais de um token e alguns podem estar rolados/invalidos.");
    }
    const token = tokens.find((candidate) => candidate.build_token_uuid || candidate.uuid || candidate.id);
    if (!token) {
      throw new Error("Nenhum build token disponivel. Crie ou selecione um build token em Worker > Settings > Builds > API token e tente novamente.");
    }
    const uuid = token.build_token_uuid || token.uuid || token.id;
    if (!uuid) {
      throw new Error(`Nao consegui obter UUID do build token. Chaves retornadas: ${Object.keys(token).join(", ") || "nenhuma"}.`);
    }
    return uuid;
  }

  async createBuildTrigger(input: {
    workerName: string;
    externalScriptId: string;
    repoConnectionUuid: string;
    buildTokenUuid: string;
    branch: string;
    rootDirectory: string;
    buildCommand: string;
    deployCommand: string;
  }): Promise<string> {
    const payload = await this.request<BuildTrigger>("POST", `/accounts/${this.accountId}/builds/triggers`, {
      trigger_name: `${input.workerName} production`,
      external_script_id: input.externalScriptId,
      repo_connection_uuid: input.repoConnectionUuid,
      build_token_uuid: input.buildTokenUuid,
      build_command: input.buildCommand,
      deploy_command: input.deployCommand,
      root_directory: input.rootDirectory,
      branch_includes: [input.branch || "main"],
      branch_excludes: [],
      path_includes: ["*"],
      path_excludes: [],
    });
    const triggerId = payload.result?.trigger_uuid || payload.result?.uuid || payload.result?.id;
    if (!triggerId) throw new Error("Cloudflare criou o trigger, mas nao retornou UUID.");
    return triggerId;
  }

  async setBuildEnvironmentVariables(triggerId: string, variables: Record<string, string>): Promise<void> {
    const payload = Object.fromEntries(
      Object.entries(variables).map(([key, value]) => [key, { value, is_secret: false }]),
    );
    await this.request("PATCH", `/accounts/${this.accountId}/builds/triggers/${triggerId}/environment_variables`, payload);
  }

  async setBuildTriggerToken(triggerId: string, buildTokenUuid: string): Promise<void> {
    await this.request("PATCH", `/accounts/${this.accountId}/builds/triggers/${triggerId}`, {
      build_token_uuid: buildTokenUuid,
    });
  }

  async runBuild(triggerId: string, branch: string): Promise<string> {
    const payload = await this.request<BuildRecord>("POST", `/accounts/${this.accountId}/builds/triggers/${triggerId}/builds`, {
      branch: branch || "main",
    });
    const buildId = payload.result?.build_uuid || payload.result?.uuid || payload.result?.id;
    if (!buildId) throw new Error("Cloudflare nao retornou o UUID do build.");
    return buildId;
  }

  async getBuild(triggerId: string, buildId: string): Promise<BuildRecord | null> {
    if (buildId) {
      try {
        const payload = await this.request<BuildRecord>("GET", `/accounts/${this.accountId}/builds/builds/${buildId}`);
        return payload.result;
      } catch {
        // Older API shapes expose builds under the trigger; fall through.
      }
    }
    const payload = await this.request<unknown>("GET", `/accounts/${this.accountId}/builds/triggers/${triggerId}/builds`);
    const builds = listFromResult<BuildRecord>(payload.result, ["builds"]);
    return builds.find((build) => (build.uuid || build.id) === buildId) || builds[0] || null;
  }

  async getBuildLogs(triggerId: string, buildId: string): Promise<string> {
    const candidates = [
      `/accounts/${this.accountId}/builds/builds/${buildId}/logs`,
      `/accounts/${this.accountId}/builds/triggers/${triggerId}/builds/${buildId}/logs`,
    ];
    for (const path of candidates) {
      try {
        const payload = await this.request<unknown>("GET", path);
        if (typeof payload.result === "string") return payload.result;
        return JSON.stringify(payload.result, null, 2);
      } catch {
        // Try next endpoint shape.
      }
    }
    return "";
  }

  async deleteWorker(workerName: string): Promise<void> {
    await this.request("DELETE", `/accounts/${this.accountId}/workers/scripts/${workerName}`);
  }

  async deleteD1(name: string): Promise<void> {
    await this.request("DELETE", `/accounts/${this.accountId}/d1/database/${encodeURIComponent(name)}`);
  }

  async deleteR2(name: string): Promise<void> {
    await this.request("DELETE", `/accounts/${this.accountId}/r2/buckets/${encodeURIComponent(name)}`);
  }

  async deleteKv(id: string): Promise<void> {
    await this.request("DELETE", `/accounts/${this.accountId}/storage/kv/namespaces/${id}`);
  }
}
