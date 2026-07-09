import type { UserRecord } from "../shared/types";

export interface Env {
  APP_DB: D1Database;
  APP_BUCKET: R2Bucket;
  ASSETS: { fetch(request: Request): Promise<Response> };
  APP_ADMIN_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  RUNNER_SHARED_SECRET?: string;
  APP_BASE_URL?: string;
  GITHUB_ACTIONS_TOKEN?: string;
  GITHUB_ACTIONS_OWNER?: string;
  GITHUB_ACTIONS_REPO?: string;
  GITHUB_ACTIONS_WORKFLOW?: string;
  GITHUB_ACTIONS_REF?: string;
  SESSION_TTL_SECONDS?: string;
}

export interface AppVariables {
  authenticated: boolean;
  currentUser: UserRecord;
}
