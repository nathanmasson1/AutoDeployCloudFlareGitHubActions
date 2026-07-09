import { base64UrlDecode, base64UrlEncode } from "../../shared/utils";
import type { UserRecord, UserRole } from "../../shared/types";
import type { Env } from "../env";

const COOKIE_NAME = "adc_session";

export interface SessionUser {
  id: string;
  clientId: string;
  role: UserRole;
  name: string;
  email: string;
}

interface SessionPayload extends SessionUser {
  exp: number;
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const item of (header || "").split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key) cookies[key] = rest.join("=");
  }
  return cookies;
}

export async function createSessionCookie(env: Env, user: UserRecord): Promise<string> {
  const ttl = Number(env.SESSION_TTL_SECONDS || "604800");
  const payload: SessionPayload = {
    id: user.id,
    clientId: user.clientId,
    role: user.role,
    name: user.name,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(env.APP_ADMIN_SECRET, body);
  const secure = "Secure";
  return `${COOKIE_NAME}=${body}.${signature}; Path=/; HttpOnly; SameSite=Lax; ${secure}; Max-Age=${ttl}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export async function getSessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const value = parseCookies(request.headers.get("Cookie"))[COOKIE_NAME];
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = await hmac(env.APP_ADMIN_SECRET, body);
  if (expected !== signature) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionPayload;
    if (Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    if (!payload.id || !payload.role) return null;
    return {
      id: payload.id,
      clientId: payload.clientId,
      role: payload.role,
      name: payload.name,
      email: payload.email,
    };
  } catch {
    return null;
  }
}

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  return Boolean(await getSessionUser(request, env));
}
