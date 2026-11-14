/**
 * Conversation persistence and cross-session memory.
 *
 * Two stores: `conversation`/`message`/`agent_run` hold the transcript the
 * dashboard lists, and `short_term_memory`/`long_term_memory` hold recalled
 * findings, written only for claims that verified against their source passage.
 */
import type { Env } from "./db";
import { db } from "./db";
import { embedSafe, toPgVector } from "./retrieval";

const SESSION_TOOLS = ["memory_recall", "hybrid_retrieve", "grade_evidence", "synthesize", "verify",
  "search_corpus", "compare_experiments", "build_chart", "final_answer", "act", "final", "visualize"];

/** Terms for the lexical fallback recall, deduped 3+ char alphanumeric words. */
function toTsQuery(text: string): string {
  const words2 = (text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(0, 16);
  return Array.from(new Set(words2)).join(" | ");
}

export async function persistSession(env: Env, conversationId: string, question: string, result: any,
                                     userId?: string | null): Promise<void> {
  const sql = db(env);
  const runId = String(result.run_id);
  await sql`INSERT INTO ignis.conversation (id, title, mode, user_id)
            VALUES (${conversationId}::uuid, ${question.slice(0, 120)}, 'agent', ${userId ?? null})
            ON CONFLICT (id) DO UPDATE SET updated_at = now(),
              user_id = COALESCE(ignis.conversation.user_id, EXCLUDED.user_id)`;
  await sql`INSERT INTO ignis.message (conversation_id, role, content)
            VALUES (${conversationId}::uuid, 'user', ${question})`;
  await sql`INSERT INTO ignis.message (conversation_id, role, content, token_count, latency_ms)
            VALUES (${conversationId}::uuid, 'assistant', ${String(result.answer ?? "")},
                    ${Number(result.total_tokens ?? 0) || null}, ${Number(result.latency_ms ?? 0)})`;
  await sql`INSERT INTO ignis.agent_run (id, conversation_id, question, plan, iterations, status, answer,
                                         answer_confidence, latency_ms, finished_at)
            VALUES (${runId}::uuid, ${conversationId}::uuid, ${question},
                    ${JSON.stringify({ sub_questions: result.sub_questions ?? [] })}::jsonb,
                    1, 'completed', ${String(result.answer ?? "")},
                    ${Number(result.confidence ?? 0)}, ${Number(result.latency_ms ?? 0)}, now())
            ON CONFLICT (id) DO NOTHING`;
  const steps: any[] = Array.isArray(result.trace) ? result.trace : [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await sql`INSERT INTO ignis.agent_step (run_id, step_index, node, thought, tool, tool_input, latency_ms)
              VALUES (${runId}::uuid, ${i}, ${String(s.node ?? "step")},
                      ${s.verdict ? String(s.verdict) : null},
                      ${SESSION_TOOLS.includes(String(s.node)) ? String(s.node) : null},
                      ${JSON.stringify(s)}::jsonb, ${Number(s.t_ms ?? 0)})`;
  }
  await sql`UPDATE ignis.conversation SET updated_at = now() WHERE id = ${conversationId}::uuid`;
}

/** List conversations that actually hold a transcript, scoped to the owner. */
export async function listSessions(env: Env, userId?: string | null): Promise<any[]> {
  const sql = db(env);
  const scope = userId ? sql`c.user_id = ${userId}` : sql`c.user_id IS NULL`;
  return await sql`
    SELECT c.id, c.title, c.mode, c.created_at, c.updated_at,
           (SELECT count(*)::int FROM ignis.message m WHERE m.conversation_id = c.id) AS turns,
           (SELECT count(*)::int FROM ignis.agent_run r WHERE r.conversation_id = c.id) AS runs,
           (SELECT left(m.content, 160) FROM ignis.message m
             WHERE m.conversation_id = c.id AND m.role = 'assistant'
             ORDER BY m.id DESC LIMIT 1) AS last_answer
      FROM ignis.conversation c
     WHERE ${scope} AND EXISTS (SELECT 1 FROM ignis.message m WHERE m.conversation_id = c.id)
     ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
     LIMIT 50`;
}

/** Full transcript for one conversation: turns plus the steps behind each run. */
export async function getSession(env: Env, id: string, userId?: string | null): Promise<any | null> {
  const sql = db(env);
  const convo: any[] = await sql`SELECT id, title, mode, created_at, updated_at
                                   FROM ignis.conversation
                                  WHERE id = ${id}::uuid
                                    AND (${userId ?? null}::text IS NULL OR user_id = ${userId ?? null}::text OR user_id IS NULL)`;
  if (!convo.length) return null;
  const messages: any[] = await sql`SELECT id, role, content, created_at
                                      FROM ignis.message WHERE conversation_id = ${id}::uuid
                                      ORDER BY id`;
  const runs: any[] = await sql`SELECT id, question, answer, answer_confidence, latency_ms, status, created_at
                                  FROM ignis.agent_run WHERE conversation_id = ${id}::uuid
                                  ORDER BY created_at`;
  const runIds = runs.map((r) => r.id);
  const steps: any[] = runIds.length
    ? await sql`SELECT run_id, step_index, node, thought, tool, latency_ms
                  FROM ignis.agent_step WHERE run_id = ANY(${runIds}::uuid[])
                  ORDER BY run_id, step_index`
    : [];
  return { conversation: convo[0], messages, runs, steps };
}

/** Vector / lexical recall across the session store and the durable long-term
 *  store, scoped to the owner and reinforced by each run that uses it.
 *  Returns nothing when embeddings are unavailable rather than failing the
 *  caller's run - recall is an enhancement, not a requirement. */
export async function memoryRecall(env: Env, query: string, topK: number,
                                   conversationId?: string,
                                   userId?: string | null,
                                   runId?: string): Promise<{ id: number; kind: string; content: string; score: number }[]> {
  const sql = db(env);
  const qvec = await embedSafe(env, query);
  const vec = qvec ? toPgVector(qvec) : null;
  const tsq = toTsQuery(query);
  const longRows: any[] = vec
    ? await sql`SELECT * FROM ignis.recall_long_term(${vec}::text, ${userId ?? null}::text, ${topK}, 0.45)`
    : await sql`SELECT * FROM ignis.recall_long_term_lexical(${tsq}, ${userId ?? null}::text, ${topK})`;
  let sessionRows: any[] = [];
  if (conversationId) {
    sessionRows = vec
      ? await sql`SELECT * FROM ignis.recall_short_term(${vec}::text, ${conversationId}::uuid, ${topK}, 0.45)`
      : await sql`SELECT * FROM ignis.recall_short_term_lexical(${tsq}, ${conversationId}::uuid, ${topK})`;
  }
  try {
    const ltIds = longRows.map((r) => r.id).filter((id) => Number.isFinite(Number(id)));
    if (ltIds.length) await sql`SELECT ignis.reinforce_long_term(${ltIds}::bigint[])`;
    if (runId) {
      for (const r of longRows) {
        await sql`SELECT ignis.record_memory_signal('long_term', ${r.id}::bigint, ${runId}::uuid, 'recalled', ${Number(r.score) || null}::real)`;
      }
      for (const r of sessionRows) {
        await sql`SELECT ignis.record_memory_signal('short_term', ${r.id}::bigint, ${runId}::uuid, 'recalled', ${Number(r.score) || null}::real)`;
      }
    }
  } catch {
    // reinforcement and signalling are best-effort; a failure must not fail recall
  }
  return [...sessionRows, ...longRows].map((h) => ({
    id: Number(h.id),
    kind: h.kind,
    content: h.content,
    score: Number(h.score),
  }));
}

/**
 * Persist verified claims as durable findings, scoped to the owner and traced
 * to the run that produced them. Only claims that are both verified and
 * specific enough are kept, so the store does not fill with noise.
 */
export async function memoryWrite(env: Env, claims: any[],
                                  conversationId?: string,
                                  userId?: string | null,
                                  runId?: string): Promise<number> {
  const keep = (claims ?? [])
    .filter((c) => c?.verified !== false && typeof c?.claim === "string" && c.claim.length >= 40)
    .slice(0, 5);
  if (!keep.length) return 0;
  const sql = db(env);
  let n = 0;
  for (const c of keep) {
    const content = String(c.claim).slice(0, 2000);
    // A memory write needs an embedding; when the provider is unavailable the
    // claim is simply not persisted rather than failing the whole run.
    const qvec = await embedSafe(env, content);
    const vec = qvec ? toPgVector(qvec) : null;
    const importance = Math.max(0.5, Math.min(0.95, Number(c.support_score ?? 0.7)));
    const chunkId = Number.isFinite(Number(c.chunk_id)) ? Number(c.chunk_id) : null;
    if (conversationId) {
      await sql`INSERT INTO ignis.short_term_memory (conversation_id, kind, content, embedding, importance, user_id, source_run_id)
                VALUES (${conversationId}::uuid, 'finding', ${content}, ${vec}::vector, ${importance}, ${userId ?? null},
                        (SELECT id FROM ignis.agent_run WHERE id = ${runId ?? null}::uuid))`;
    }
    const inserted: any[] = await sql`INSERT INTO ignis.long_term_memory
              (kind, content, embedding, importance, user_id, source_run_id, source_chunk_id, confidence)
              VALUES ('finding', ${content}, ${vec}::vector, ${importance}, ${userId ?? null},
                      (SELECT id FROM ignis.agent_run WHERE id = ${runId ?? null}::uuid),
                      ${chunkId}::bigint, ${importance})
              RETURNING id`;
    if (runId && inserted[0]?.id) {
      try {
        await sql`SELECT ignis.record_memory_signal('long_term', ${inserted[0].id}::bigint, ${runId}::uuid, 'written', null::real)`;
      } catch {
        // signal recording is best-effort
      }
    }
    n++;
  }
  return n;
}