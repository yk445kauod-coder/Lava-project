import { getToken } from "./auth";

/** Fetch JSON, throwing an Error whose message is the server's `error` field
 *  when the response is not OK. Returns null for 204. Attaches the bearer
 *  token when signed in and broadcasts a 401 so the session can be cleared. */
export async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const headers = new Headers(opts?.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event("lava:unauthorized"));
    }
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j && typeof j.error === "string") msg = j.error;
    } catch {
      /* keep the status message */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? (null as T) : ((await res.json()) as T);
}

export const apiGet = <T = unknown>(path: string) => api<T>(path);

export const apiPost = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
