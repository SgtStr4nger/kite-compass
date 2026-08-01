import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { CompassMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminChangePassword() {
  const [, navigate] = useLocation();
  const { token, mustChangePassword, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) navigate("/admin");
    if (token && !mustChangePassword) navigate("/admin/spots");
  }, [token, mustChangePassword, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      navigate("/admin/spots");
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary px-5">
      <div className="w-full max-w-md rounded-2xl bg-background p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-2.5">
          <CompassMark className="h-8 w-8 text-primary" />
          <span className="font-serif text-xl font-semibold text-foreground">Kite Compass</span>
        </div>
        <h1 className="font-serif text-2xl font-semibold text-foreground">Change temporary password</h1>
        <p className="mt-1 text-sm text-muted-foreground">Set a new password to continue.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="current-password">Current password</Label>
            <Input id="current-password" type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-1.5" />
            <p className="mt-1 text-xs text-muted-foreground">Minimum 12 chars, uppercase, lowercase, number, special.</p>
          </div>
          <div>
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input id="confirm-password" type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mt-1.5" />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save new password"}</Button>
        </form>
      </div>
    </div>
  );
}
