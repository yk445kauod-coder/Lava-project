import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { apiGet, apiPost } from "./api";
import { getJSON, setJSON } from "./storage";

const TOKEN_KEY = "lava.token";
const USER_KEY = "lava.user";

export type User = { id: string; email: string; name: string | null };

export function getToken(): string | null {
  return getJSON<string | null>(TOKEN_KEY, null);
}
export function setToken(token: string | null): void {
  setJSON(TOKEN_KEY, token);
}

interface AuthValue {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getJSON<User | null>(USER_KEY, null));
  const [ready, setReady] = useState(false);

  // Validate any stored token on load; a stale one is dropped rather than shown.
  useEffect(() => {
    let alive = true;
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }
    apiGet<{ user: User }>("/api/auth/me")
      .then((r) => alive && setUser(r.user))
      .catch(() => alive && (setToken(null), setJSON(USER_KEY, null), setUser(null)))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // A 401 from any request (expired/revoked token) drops the session globally.
  useEffect(() => {
    const onUnauthorized = () => {
      setToken(null);
      setJSON(USER_KEY, null);
      setUser(null);
    };
    window.addEventListener("lava:unauthorized", onUnauthorized);
    return () => window.removeEventListener("lava:unauthorized", onUnauthorized);
  }, []);

  const persist = useCallback((token: string, u: User) => {
    setToken(token);
    setJSON(USER_KEY, u);
    setUser(u);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await apiPost<{ token: string; user: User }>("/api/auth/login", { email, password });
      persist(r.token, r.user);
    },
    [persist],
  );

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      const r = await apiPost<{ token: string; user: User }>("/api/auth/register", { email, password, name });
      persist(r.token, r.user);
    },
    [persist],
  );

  const logout = useCallback(async () => {
    try {
      await apiPost("/api/auth/logout");
    } catch {
      /* the local session is cleared regardless */
    }
    setToken(null);
    setJSON(USER_KEY, null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, register, logout }), [user, ready, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Gate a route on a signed-in session, preserving the intended destination. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
