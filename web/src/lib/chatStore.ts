import type { AskResult } from "./agentTypes";
import { getJSON, setJSON } from "./storage";

export interface UserMsg {
  role: "user";
  text: string;
}
export interface AiMsg {
  role: "ai";
  result: AskResult;
}
export type ChatMsg = UserMsg | AiMsg;

export interface Conversation {
  id: string;
  title: string;
  ts: number;
  messages: ChatMsg[];
}

const CONVS_KEY = "lava.convs";
const CID_KEY = "lava.conversation_id";

/** A stable per-browser conversation id so server-side session memory survives
 *  reloads. Must be a UUID: /api/ask and /api/memory reject anything else. */
export function conversationId(): string {
  const existing = getJSON<string>(CID_KEY, "");
  if (existing) return existing;
  const id = crypto.randomUUID();
  setJSON(CID_KEY, id);
  return id;
}

export function loadConversations(): Conversation[] {
  const raw = getJSON<Conversation[]>(CONVS_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

/** Drop the trace and long passages before persisting: localStorage is small
 *  and the reasoning trace is only useful for the session that produced it. */
function trim(c: Conversation): Conversation {
  return {
    ...c,
    messages: c.messages.map((m) =>
      m.role === "ai"
        ? {
            role: "ai",
            result: {
              ...m.result,
              trace: [],
              evidence: (m.result.evidence || []).map((e) => ({
                ...e,
                content: String(e.content || "").slice(0, 320),
              })),
            },
          }
        : m,
    ),
  };
}

export function saveConversations(convs: Conversation[]): void {
  setJSON(
    CONVS_KEY,
    convs.map(trim),
  );
}

/** Group conversations for the history list: Today / Yesterday / Previous 7 days. */
export function groupConversations(
  convs: Conversation[],
  query: string,
): { label: string; items: Conversation[] }[] {
  const q = query.trim().toLowerCase();
  const list = convs
    .filter((c) => c.messages.length && c.title.toLowerCase().includes(q))
    .sort((a, b) => b.ts - a.ts);
  const day = 864e5;
  const start = new Date().setHours(0, 0, 0, 0);
  const buckets: [string, (c: Conversation) => boolean][] = [
    ["Today", (c) => c.ts >= start],
    ["Yesterday", (c) => c.ts >= start - day && c.ts < start],
    ["Previous 7 days", (c) => c.ts < start - day],
  ];
  return buckets
    .map(([label, f]) => ({ label, items: list.filter(f) }))
    .filter((b) => b.items.length);
}
