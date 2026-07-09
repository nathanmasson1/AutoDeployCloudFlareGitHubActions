export type SiteStatus =
  | "draft"
  | "provisioning"
  | "building"
  | "online"
  | "domain_pending"
  | "failed"
  | "delete_pending"
  | "deleted";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface CloudflareSettings {
  accountId: string;
  accountName?: string;
  tokenCipher?: string;
  tokenMask?: string;
  buildTokenUuid?: string;
  buildTokenName?: string;
  githubAppAcknowledged?: boolean;
  cloudflarePaidPlan?: boolean;
}

export interface PublicSettings {
  hasToken: boolean;
  tokenMask: string;
  accountId: string;
  accountName: string;
  buildTokenUuid: string;
  buildTokenName: string;
  githubAppAcknowledged: boolean;
  cloudflarePaidPlan: boolean;
}

export interface ClientRecord {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientSummary extends ClientRecord {
  settings: PublicSettings;
}

export type UserRole = "admin" | "client";

export interface UserRecord {
  id: string;
  clientId: string;
  role: UserRole;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MeResponse {
  authenticated: boolean;
  user: UserRecord | null;
}

export interface GithubTemplateInfo {
  owner: string;
  repo: string;
  branch: string;
  subdir: string;
  url: string;
}

export interface TemplateRecord extends GithubTemplateInfo {
  id: string;
  name: string;
  githubUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface SiteRecord {
  id: string;
  clientId: string;
  status: SiteStatus;
  siteName: string;
  slug: string;
  templateId: string;
  workerName: string;
  customDomain: string;
  workersDevUrl: string;
  adminUrl: string;
  d1Database: string;
  d1DatabaseId: string;
  r2Bucket: string;
  kvNamespace: string;
  kvNamespaceId: string;
  buildTriggerId: string;
  buildId: string;
  repoConnectionUuid: string;
  externalScriptId: string;
  webhookSecret: string;
  cronSecret: string;
  zone: Record<string, unknown>;
  error: string;
  raw: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  clientId: string;
  siteId: string;
  operation: string;
  status: JobStatus;
  currentStep: string;
  result: Record<string, unknown>;
  error: string;
  logs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeployRequest {
  clientId?: string;
  siteName: string;
  adminPassword: string;
  templateId: string;
  customDomain?: string;
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface CloudflareBuildToken {
  uuid: string;
  name: string;
  cloudflareTokenId: string;
}

export interface ApiError {
  error: string;
}
