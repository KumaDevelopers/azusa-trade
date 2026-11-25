import { createHash, createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { neon } from "@neondatabase/serverless";
import type { NextRequest, NextResponse } from "next/server";
import { isAdminPasswordHash } from "./admin-credentials.mjs";

export const ADMIN_USERNAME = "admin";
export const ADMIN_WORKSPACE_KEY = "admin:workspace:v1";
const SESSION_SECONDS = 7 * 86400;
const LOGIN_WINDOW_MINUTES = 10;
const LOGIN_LIMIT = 8;
const production = process.env.NODE_ENV === "production";
const cookieName = production ? "__Host-azusa-admin" : "azusa-admin";

export function adminConfig() {
  const url = process.env.DATABASE_URL;
  const passwordHash = process.env.AZUSA_ADMIN_PASSWORD_HASH?.trim();
  return url && passwordHash && isAdminPasswordHash(passwordHash) ? { sql: neon(url), passwordHash } : null;
}

type AdminConfig = NonNullable<ReturnType<typeof adminConfig>>;

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === new URL(request.url).origin) return true;
  // Next can expose the internal bound hostname in self-hosted deployments.
  const host = request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  return !!host && !!origin && origin === `${forwardedProtocol === "https" ? "https:" : new URL(request.url).protocol}//${host}`;
}

function sessionId(request: NextRequest, config: AdminConfig) {
  const token = request.cookies.get(cookieName)?.value;
  return token && /^[a-f0-9]{64}$/.test(token) ? sessionKey(config, token) : null;
}

function sessionKey(config: AdminConfig, token: string) {
  return createHmac("sha256", config.passwordHash).update("azusatrade-admin-session:" + token).digest("hex");
}

export async function hasAdminSession(request: NextRequest, config: AdminConfig) {
  const id = sessionId(request, config);
  if (!id) return false;
  const [session] = await config.sql`SELECT 1 FROM azusa_admin_sessions WHERE id_hash = ${id} AND expires_at > now()`;
  return Boolean(session);
}

export async function openAdminSession(config: AdminConfig) {
  const token = randomBytes(32).toString("hex");
  await config.sql.transaction([
    config.sql`DELETE FROM azusa_admin_sessions WHERE expires_at <= now()`,
    config.sql`DELETE FROM azusa_admin_login_limits WHERE expires_at <= now()`,
    config.sql`INSERT INTO azusa_admin_sessions (id_hash, expires_at)
      VALUES (${sessionKey(config, token)}, now() + make_interval(secs => ${SESSION_SECONDS}))`,
  ]);
  return token;
}

export async function closeAdminSession(request: NextRequest, config: AdminConfig) {
  const id = sessionId(request, config);
  if (id) await config.sql`DELETE FROM azusa_admin_sessions WHERE id_hash = ${id}`;
}

export function adminCookie(response: NextResponse, token = "") {
  response.cookies.set(cookieName, token, {
    httpOnly: true, secure: production, sameSite: "strict", path: "/", maxAge: token ? SESSION_SECONDS : 0,
  });
  return response;
}

export async function allowAdminLogin(request: Request, config: AdminConfig) {
  const candidate = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : undefined;
  const address = candidate && isIP(candidate) ? candidate : "unavailable";
  const key = createHash("sha256").update("azusa-admin:" + address).digest("hex");
  const [row] = await config.sql`INSERT INTO azusa_admin_login_limits (client_hash, attempts, expires_at)
    VALUES (${key}, 1, now() + make_interval(mins => ${LOGIN_WINDOW_MINUTES}))
    ON CONFLICT (client_hash) DO UPDATE SET
      attempts = CASE WHEN azusa_admin_login_limits.expires_at <= now() THEN 1
        ELSE LEAST(azusa_admin_login_limits.attempts + 1, ${LOGIN_LIMIT + 1}) END,
      expires_at = CASE WHEN azusa_admin_login_limits.expires_at <= now() THEN EXCLUDED.expires_at
        ELSE azusa_admin_login_limits.expires_at END
    RETURNING attempts`;
  return Number(row?.attempts) <= LOGIN_LIMIT;
}
