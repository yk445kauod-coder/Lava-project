import { useEffect, useState } from "react";

import { apiGet } from "./api";

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** GET-on-mount hook with loading/error state and a manual `reload`. */
export function useApi<T = unknown>(path: string | null) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: !!path });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    apiGet<T>(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e: unknown) => alive && setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false }));
    return () => {
      alive = false;
    };
  }, [path, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
