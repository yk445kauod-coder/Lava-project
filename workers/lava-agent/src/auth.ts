/**
 * Authentication for the LAVA agent Worker.
 *
 * Passwords are hashed with PBKDF2-SHA256 (WebCrypto, available on Workers).
 * Sessions are opaque 256-bit bearer tokens; only the SHA-256 digest is stored,
 * so a database leak cannot be replayed as a login. Nothing here trusts the
 * client: every protected route resolves the token to a user row server-side.
 */
import type { Env } from "./db";
import { db } from "./db";
import { ApiError, badRequest } from "./http";

const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iters, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || !iters || !saltB64 || !hashB64) return false;
  const bits = await derive(password, unb64(saltB64), Number(iters));
  const expected = unb64(hashB64);
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  // Constant-time comparison; lengths are equal by construction here.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

const sha256Hex = async (s: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export type AuthUser = { id: string; email: string; name: string | null };

function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") || request.headers.get("x-lava-token") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/** Resolve the caller from the bearer token, or null when absent/invalid. */
export async function currentUser(request: Request, env: Env): Promise<AuthUser | null> {
  const token = bearer(request);
  if (!token) return null;
  const sql = db(env);
  const hash = await sha256Hex(token);
  const rows: any[] = await sql`
    SELECT u.id, u.email, u.name
    FROM ignis.auth_session s JOIN ignis.app_user u ON u.id = s.user_id
    WHERE s.token_hash = ${hash} AND s.expires_at > now()
    LIMIT 1`;
  if (!rows.length) return null;
  // Best-effort touch; never block the request on it.
  sql`UPDATE ignis.auth_session SET last_seen = now() WHERE token_hash = ${hash}`.catch(() => {});
  const r = rows[0];
  return { id: r.id, email: r.email, name: r.name ?? null };
}

/** Throwing variant for endpoints that require a signed-in caller. */
export async function requireUser(request: Request, env: Env): Promise<AuthUser> {
  const user = await currentUser(request, env);
  if (!user) throw new ApiError(401, "sign in required", "unauthorized");
  return user;
}

export async function createSession(env: Env, userId: string, userAgent: string | null): Promise<string> {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, "");
  const hash = await sha256Hex(token);
  const sql = db(env);
  await sql`
    INSERT INTO ignis.auth_session (user_id, token_hash, expires_at, user_agent)
    VALUES (${userId}::uuid, ${hash}, ${new Date(Date.now() + SESSION_TTL_MS).toISOString()}, ${userAgent})`;
  return token;
}

export async function destroySession(request: Request, env: Env): Promise<void> {
  const token = bearer(request);
  if (!token) return;
  const sql = db(env);
  await sql`DELETE FROM ignis.auth_session WHERE token_hash = ${await sha256Hex(token)}`;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCredentials(email: unknown, password: unknown): { email: string; password: string } {
  const e = String(email ?? "").trim().toLowerCase();
  const p = String(password ?? "");
  if (!EMAIL_RE.test(e)) throw badRequest("a valid email is required", "invalid_email");
  if (p.length < 8) throw badRequest("password must be at least 8 characters", "weak_password");
  return { email: e, password: p };
}
