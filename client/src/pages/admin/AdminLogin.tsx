import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { CompassMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminLogin() {
  const [, navigate] = useLocation();
  const { login, setup, mustChangePassword, token } = useAuth();
  const { data: status, isLoading } = useQuery<{ needsSetup: boolean }>({ queryKey: ["/api/auth/status"] });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsSetup = status?.needsSetup;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsSetup && password !== confirm) { setError("Passwords do not match."); return; }
    if (needsSetup && password.length < 12) { setError("Password must be at least 12 characters."); return; }
    setBusy(true);
    try {
      if (needsSetup) await setup(email, password);
      else await login(email, password);
      navigate(mustChangePassword ? "/admin/change-password" : "/admin/spots");
    } catch (err: any) {
      setError(needsSetup ? "Could not create the admin account." : "Invalid email or password.");
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!token) return;
    navigate(mustChangePassword ? "/admin/change-password" : "/admin/spots");
  }, [token, mustChangePassword, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary px-5">
      <div className="w-full max-w-md rounded-2xl bg-background p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-2.5">
          <CompassMark className="h-8 w-8 text-primary" />
          <span className="font-serif text-xl font-semibold text-foreground">Kite Compass</span>
        </div>
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <h1 className="font-serif text-2xl font-semibold text-foreground">
              {needsSetup ? "Create your admin account" : "Admin sign in"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {needsSetup
                ? "No admin exists yet. Set up the first account to manage spots."
                : "Sign in to manage spots and publish changes."}
            </p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} data-testid="input-email" className="mt-1.5" autoComplete="username" />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required value={password} onChange={e => setPassword(e.target.value)} data-testid="input-password" className="mt-1.5" autoComplete={needsSetup ? "new-password" : "current-password"} />
                {needsSetup ? <p className="mt-1 text-xs text-muted-foreground">Minimum 12 chars, uppercase, lowercase, number, special.</p> : null}
              </div>
              {needsSetup && (
                <div>
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input id="confirm" type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} data-testid="input-confirm" className="mt-1.5" autoComplete="new-password" />
                </div>
              )}
              {error && <p className="text-sm text-destructive" data-testid="text-auth-error">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy} data-testid="button-submit-auth">
                {busy ? "Please wait…" : needsSetup ? "Create account" : "Sign in"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
