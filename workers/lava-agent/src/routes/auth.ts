/**
 * Authentication endpoints.
 *
 *   POST /auth/register { email, password, name? } -> { token, user }
 *   POST /auth/login    { email, password }         -> { token, user }
 *   POST /auth/logout                               -> { ok: true }
 *   GET  /auth/me                                   -> { user }
 *
 * The token is returned once and stored client-side; the server keeps only its
 * SHA-256 digest.
 */
import type { Env } from "../db";
import { db } from "../db";
import { badRequest, json, readJson } from "../http";
import { ApiError } from "../http";
import {
  createSession, currentUser, destroySession, hashPassword, requireUser, validateCredentials, verifyPassword,
} from "../auth";

export async function handleAuthRoutes(request: Request, url: URL, env: Env): Promise<Response | null> {
  const { pathname } = url;
  if (!pathname.startsWith("/auth/")) return null;

  if (request.method === "POST" && pathname === "/auth/register") {
    const body = await readJson<{ email?: string; password?: string; name?: string }>(request);
    const { email, password } = validateCredentials(body.email, body.password);
    const name = body.name ? String(body.name).trim().slice(0, 120) : null;
    const sql = db(env);
    const existing: any[] = await sql`SELECT id FROM ignis.app_user WHERE lower(email) = ${email} LIMIT 1`;
    if (existing.length) throw new ApiError(409, "an account with that email already exists", "email_taken");
    const hash = await hashPassword(password);
    const rows: any[] = await sql`
      INSERT INTO ignis.app_user (email, name, password_hash)
      VALUES (${email}, ${name}, ${hash})
      RETURNING id, email, name`;
    const user = rows[0];
    const token = await createSession(env, user.id, request.headers.get("user-agent"));
    return json({ token, user: { id: user.id, email: user.email, name: user.name } }, 201);
  }

  if (request.method === "POST" && pathname === "/auth/login") {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const sql = db(env);
    const rows: any[] = await sql`
      SELECT id, email, name, password_hash FROM ignis.app_user WHERE lower(email) = ${email} LIMIT 1`;
    // Same error whether the email is unknown or the password is wrong, so the
    // endpoint cannot be used to enumerate accounts.
    if (!rows.length || !(await verifyPassword(password, rows[0].password_hash))) {
      throw new ApiError(401, "invalid email or password", "invalid_credentials");
    }
    const user = rows[0];
    await sql`UPDATE ignis.app_user SET last_login_at = now() WHERE id = ${user.id}::uuid`;
    const token = await createSession(env, user.id, request.headers.get("user-agent"));
    return json({ token, user: { id: user.id, email: user.email, name: user.name } });
  }

  if (request.method === "POST" && pathname === "/auth/logout") {
    await destroySession(request, env);
    return json({ ok: true });
  }

  if (request.method === "GET" && pathname === "/auth/me") {
    const user = await currentUser(request, env);
    if (!user) throw new ApiError(401, "not signed in", "unauthorized");
    return json({ user });
  }

  // A future password change must prove the current one; keep the check server-side.
  if (request.method === "POST" && pathname === "/auth/password") {
    const user = await requireUser(request, env);
    const body = await readJson<{ current?: string; next?: string }>(request);
    const next = String(body.next ?? "");
    if (next.length < 8) throw badRequest("new password must be at least 8 characters", "weak_password");
    const sql = db(env);
    const rows: any[] = await sql`SELECT password_hash FROM ignis.app_user WHERE id = ${user.id}::uuid`;
    if (!rows.length || !(await verifyPassword(String(body.current ?? ""), rows[0].password_hash))) {
      throw new ApiError(401, "current password is incorrect", "invalid_credentials");
    }
    await sql`UPDATE ignis.app_user SET password_hash = ${await hashPassword(next)} WHERE id = ${user.id}::uuid`;
    return json({ ok: true });
  }

  return null;
}
