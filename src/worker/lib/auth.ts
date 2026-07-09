import { base64UrlDecode, base64UrlEncode } from "../../shared/utils";
import type { Env } from "../env";

const COOKIE_NAME = "adc_session";

interface SessionPayload {
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

export async function createSessionCookie(env: Env): Promise<string> {
  const ttl = Number(env.SESSION_TTL_SECONDS || "604800");
  const payload: SessionPayload = { exp: Math.floor(Date.now() / 1000) + ttl };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(env.APP_ADMIN_SECRET, body);
  const secure = "Secure";
  return `${COOKIE_NAME}=${body}.${signature}; Path=/; HttpOnly; SameSite=Lax; ${secure}; Max-Age=${ttl}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const value = parseCookies(request.headers.get("Cookie"))[COOKIE_NAME];
  if (!value) return false;
  const [body, signature] = value.split(".");
  if (!body || !signature) return false;
  const expected = await hmac(env.APP_ADMIN_SECRET, body);
  if (expected !== signature) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionPayload;
    return Number(payload.exp || 0) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
