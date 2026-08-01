import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from "react";
import { setAuthToken, setAuthCallbacks, api } from "./api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AdminUser {
  id: number;
  email: string;
  role: "main" | "standard";
  mustChangePassword: boolean;
}

interface AuthState {
  token: string | null;
  user: AdminUser | null;
  email: string | null;
  ready: boolean;
  role: "main" | "standard" | null;
  mustChangePassword: boolean;
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  setup: (email: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  staySignedIn: () => Promise<void>;
  logout: () => void;
}

const AuthCtx = createContext<AuthState>(null as any);
const WARNING_MS = 55 * 60 * 1000;
const EXPIRE_MS = 60 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [ready] = useState(true);
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthBusy, setReauthBusy] = useState(false);

  useEffect(() => { setAuthToken(token); }, [token]);

  useEffect(() => {
    setAuthCallbacks({
      onTokenRefresh: (nextToken) => {
        setToken(nextToken);
        setLastActivityAt(Date.now());
      },
      onSessionExpired: () => {
        setSessionExpired(true);
        setShowTimeoutWarning(false);
      },
    });
    return () => setAuthCallbacks({});
  }, []);

  const onAuthed = useCallback((nextToken: string, nextUser: AdminUser) => {
    setAuthToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setLastActivityAt(Date.now());
    setShowTimeoutWarning(false);
    setSessionExpired(false);
    setReauthPassword("");
    setReauthError(null);
  }, []);

  const login = useCallback(async (e: string, p: string) => {
    const r = await api<{ token: string; user: AdminUser }>("POST", "/api/auth/login", { email: e, password: p });
    onAuthed(r.token, r.user);
  }, [onAuthed]);

  const setup = useCallback(async (e: string, p: string) => {
    const r = await api<{ token: string; user: AdminUser }>("POST", "/api/auth/setup", { email: e, password: p });
    onAuthed(r.token, r.user);
  }, [onAuthed]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const r = await api<{ user: AdminUser }>("POST", "/api/auth/change-password", { currentPassword, newPassword });
    setUser(r.user);
    setLastActivityAt(Date.now());
  }, []);

  const staySignedIn = useCallback(async () => {
    const r = await api<{ token: string; user: AdminUser }>("POST", "/api/auth/refresh");
    onAuthed(r.token, r.user);
  }, [onAuthed]);

  const logout = useCallback(() => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setLastActivityAt(null);
    setShowTimeoutWarning(false);
    setSessionExpired(false);
    setReauthPassword("");
    setReauthError(null);
  }, []);

  useEffect(() => {
    if (!token || sessionExpired) return;
    const markActivity = () => setLastActivityAt(Date.now());
    const events: Array<keyof WindowEventMap> = ["click", "keydown", "mousemove", "scroll", "touchstart"];
    for (const eventName of events) window.addEventListener(eventName, markActivity, { passive: true });
    return () => {
      for (const eventName of events) window.removeEventListener(eventName, markActivity);
    };
  }, [token, sessionExpired]);

  useEffect(() => {
    if (!token || !lastActivityAt || sessionExpired) return;
    const interval = window.setInterval(() => {
      const inactiveMs = Date.now() - lastActivityAt;
      if (inactiveMs >= EXPIRE_MS) {
        setSessionExpired(true);
        setShowTimeoutWarning(false);
        return;
      }
      if (inactiveMs >= WARNING_MS) setShowTimeoutWarning(true);
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [token, lastActivityAt, sessionExpired]);

  const submitReauth = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;
    setReauthBusy(true);
    setReauthError(null);
    try {
      await login(user.email, reauthPassword);
    } catch {
      setReauthError("Invalid password.");
    } finally {
      setReauthBusy(false);
    }
  }, [user?.email, reauthPassword, login]);

  const value = useMemo<AuthState>(() => ({
    token,
    user,
    email: user?.email ?? null,
    ready,
    role: user?.role ?? null,
    mustChangePassword: !!user?.mustChangePassword,
    sessionExpired,
    login,
    setup,
    changePassword,
    staySignedIn,
    logout,
  }), [token, user, ready, sessionExpired, login, setup, changePassword, staySignedIn, logout]);

  return (
    <AuthCtx.Provider value={value}>
      {children}
      <Dialog open={showTimeoutWarning && !sessionExpired}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Session expires soon</DialogTitle>
            <DialogDescription>Your admin session will expire after 60 minutes of inactivity.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button onClick={() => { void staySignedIn(); }} data-testid="button-session-stay-signed-in">Stay signed in</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={sessionExpired}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Session expired</DialogTitle>
            <DialogDescription>Sign in again to continue. Unsaved values remain in this tab.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitReauth} className="space-y-3">
            <div>
              <Label htmlFor="reauth-email">Email</Label>
              <Input id="reauth-email" value={user?.email ?? ""} disabled className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="reauth-password">Password</Label>
              <Input
                id="reauth-password"
                type="password"
                value={reauthPassword}
                onChange={(e) => setReauthPassword(e.target.value)}
                required
                className="mt-1.5"
              />
            </div>
            {reauthError ? <p className="text-sm text-destructive">{reauthError}</p> : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={reauthBusy}>{reauthBusy ? "Signing in…" : "Sign in"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AuthCtx.Provider>
  );
}

export function useAuth() { return useContext(AuthCtx); }
