import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { setAuthToken, api } from "./api";

interface AuthState {
  token: string | null;
  email: string | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  setup: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthCtx = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Token lives in React state + module memory only (no storage — iframe blocks it).
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(true);

  useEffect(() => { setAuthToken(token); }, [token]);

  const login = useCallback(async (e: string, p: string) => {
    const r = await api<{ token: string; email: string }>("POST", "/api/auth/login", { email: e, password: p });
    setAuthToken(r.token); setToken(r.token); setEmail(r.email);
  }, []);

  const setup = useCallback(async (e: string, p: string) => {
    const r = await api<{ token: string; email: string }>("POST", "/api/auth/setup", { email: e, password: p });
    setAuthToken(r.token); setToken(r.token); setEmail(r.email);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null); setToken(null); setEmail(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ token, email, ready, login, setup, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() { return useContext(AuthCtx); }
