/**
 * Session transcript and memory endpoints.
 *
 * GET/DELETE /sessions[/:id] read and prune conversation history;
 * GET/POST /memory expose and write the recalled-findings store, scoped to the
 * signed-in owner.
 */
import type { Env } from "../db";
import { db } from "../db";
import { badRequest, json, notFound, readJson } from "../http";
import { embedSafe, toPgVector } from "../retrieval";
import { getSession, listSessions } from "../memory";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function handleSessionRoutes(request: Request, url: URL, env: Env): Promise<Response | null> {
  const { pathname } = url;
  const sessMatch = pathname.match(/^\/sessions\/([0-9a-fA-F-]{36})$/);

  if (request.method === "GET" && pathname === "/sessions") {
    return json({ sessions: await listSessions(env, (request as any).user?.id ?? null) });
  }

  if (request.method === "GET" && sessMatch) {
    const session = await getSession(env, sessMatch[1], (request as any).user?.id ?? null);
    if (!session) throw notFound("session not found");
    return json(session);
  }

  if (request.method === "DELETE" && sessMatch) {
    const sql = db(env);
    await sql`DELETE FROM ignis.conversation WHERE id = ${sessMatch[1]}::uuid`;
    return json({ deleted: sessMatch[1] });
  }

  if (request.method === "GET" && pathname === "/memory") {
    const sql = db(env);
    const uid = (request as any).user?.id ?? null;
    const query = (url.searchParams.get("query") || "").trim();
    const conversationId = url.searchParams.get("conversation_id") || null;
    // Recall, recent lists and counts are all scoped to the owner (or public rows
    // owned by nobody, so shared memory stays visible).
    const scope = uid ? sql`(user_id = ${uid}::text OR user_id IS NULL)` : sql`user_id IS NULL`;
    let recalled: any[] = [];
    if (query) {
      const qvec = await embedSafe(env, query);
      const vec = qvec ? toPgVector(qvec) : null;
      const tsq = (query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(0, 16).filter((w, i, a) => a.indexOf(w) === i).join(" | ");
      const rows: any[] = conversationId
        ? vec
          ? await sql`SELECT * FROM ignis.recall_short_term(${vec}::text, ${conversationId}::uuid, 8, 0.35)`
          : await sql`SELECT * FROM ignis.recall_short_term_lexical(${tsq}, ${conversationId}::uuid, 8)`
        : [];
      const longRows: any[] = vec
        ? await sql`SELECT * FROM ignis.recall_long_term(${vec}::text, ${uid}::text, 8, 0.35)`
        : await sql`SELECT * FROM ignis.recall_long_term_lexical(${tsq}, ${uid}::text, 8)`;
      recalled = [
        ...rows.map((h) => ({ id: h.id, kind: h.kind, content: h.content, importance: h.importance, score: Math.round(Number(h.score) * 10000) / 10000, created_at: String(h.created_at) })),
        ...longRows.map((h) => ({ id: h.id, kind: h.kind, content: h.content, importance: h.importance, score: Math.round(Number(h.score) * 10000) / 10000, created_at: String(h.created_at) })),
      ];
    }
    const recent: any[] = await sql`SELECT id, kind, content, importance, confidence, hit_count, created_at FROM ignis.long_term_memory WHERE ${scope} ORDER BY (importance * ln(hit_count + 1)) DESC, last_hit_at DESC LIMIT 30`;
    const session: any[] = conversationId
      ? await sql`SELECT id, kind, content, importance, created_at FROM ignis.short_term_memory WHERE conversation_id = ${conversationId}::uuid AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 30`
      : [];
    const lt: any[] = await sql`SELECT count(*) AS n FROM ignis.long_term_memory WHERE ${scope}`;
    const st: any[] = await sql`SELECT count(*) AS n FROM ignis.short_term_memory WHERE ${scope}`;
    return json({ recalled, recent, session, stats: { long_term: Number(lt[0]?.n ?? 0), short_term: Number(st[0]?.n ?? 0) } });
  }

  if (request.method === "POST" && pathname === "/memory") {
    const body = await readJson<{ content?: string; kind?: string; importance?: number; conversation_id?: string }>(request);
    const content = String(body.content ?? "").trim();
    if (!content) throw badRequest("content is required");
    const conversationId = body.conversation_id ? String(body.conversation_id) : null;
    if (conversationId && !UUID_RE.test(conversationId)) {
      throw badRequest("conversation_id must be a UUID");
    }
    const sql = db(env);
    const uid = (request as any).user?.id ?? null;
    const qvec = await embedSafe(env, content);
    const vec = qvec ? toPgVector(qvec) : null;
    const kind = String(body.kind ?? "fact");
    const importance = Number(body.importance ?? 0.6);
    let id: number | null = null;
    if (conversationId) {
      const rows: any[] = await sql`INSERT INTO ignis.short_term_memory (conversation_id, kind, content, embedding, importance, user_id) VALUES (${conversationId}::uuid, ${kind}, ${content.slice(0, 4000)}, ${vec}::vector, ${importance}, ${uid}) RETURNING id`;
      id = rows[0]?.id ?? null;
    } else {
      const rows: any[] = await sql`INSERT INTO ignis.long_term_memory (kind, content, embedding, importance, user_id) VALUES (${kind}, ${content.slice(0, 4000)}, ${vec}::vector, ${importance}, ${uid}) RETURNING id`;
      id = rows[0]?.id ?? null;
    }
    return json({ id, stored: id !== null });
  }

  return null;
}