import { useCallback, useEffect, useState } from "react";

import { apiGet } from "./api";
import { fmt } from "./format";

/** Loads JSON from `path` once (and again whenever `path` changes). Returns the
 *  data, a loading flag, an error message, and a `reload` for retrying. Every
 *  page uses this so a failed fetch renders a message instead of a blank panel. */
export function useApi<T>(path: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<T>(path)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}

export interface CorpusStats {
  documents?: unknown;
  chunks?: unknown;
  experiments?: unknown;
  embeddings?: unknown;
  findings?: unknown;
  corpus_words?: unknown;
}

/** Live corpus counts from /api/health, shared by the Chat research panel and
 *  the dashboard. Cached for the tab's lifetime. */
let cachedStats: CorpusStats | null = null;
let inflight: Promise<CorpusStats> | null = null;

export function loadCorpusStats(): Promise<CorpusStats> {
  if (cachedStats) return Promise.resolve(cachedStats);
  if (!inflight) {
    inflight = apiGet<{ stats?: CorpusStats }>("/api/health")
      .then((h) => {
        cachedStats = h.stats || {};
        return cachedStats;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useCorpusStats(): CorpusStats | null {
  const [stats, setStats] = useState<CorpusStats | null>(cachedStats);
  useEffect(() => {
    let alive = true;
    loadCorpusStats()
      .then((s) => alive && setStats(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return stats;
}

/** A shared one-line corpus summary, e.g. "352 documents · 10,066 passages". */
export function corpusSummary(s: CorpusStats | null): string {
  if (!s) return "Connecting to the corpus...";
  return `${fmt(s.documents)} documents · ${fmt(s.chunks)} passages · ${fmt(s.experiments)} experiments`;
}
