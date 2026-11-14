import { getToken } from "./auth";

/** One `data:` frame of an SSE stream parsed to its JSON payload, or `null`
 *  for keep-alive comments, other fields and malformed payloads. */
export function parseSseFrame(raw: string): unknown {
  const line = /^data: (.*)$/m.exec(raw.trim());
  if (!line) return null;
  try {
    return JSON.parse(line[1]);
  } catch {
    return null;
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * POST a JSON body and stream the SSE response frame by frame.
 *
 * `fetchImpl` is injectable so the frame parser can be tested without a network.
 * Frames are split on a blank line; a trailing partial frame is delivered by the
 * final read.
 */
export async function postSse(
  url: string,
  body: unknown,
  onEvent: (event: unknown) => void,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  if (res.status === 401) window.dispatchEvent(new Event("lava:unauthorized"));
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && typeof j.error === "string") msg = j.error;
    } catch {
      /* keep the status message */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const ev = parseSseFrame(raw);
      if (ev !== null) onEvent(ev);
    }
  }
  const tail = parseSseFrame(buf);
  if (tail !== null) onEvent(tail);
}
