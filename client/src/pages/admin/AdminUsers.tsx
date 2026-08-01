import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { AdminUser } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function AdminUsers() {
  const { token, role } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);

  const load = async () => {
    if (!token || role !== "main") return;
    setLoading(true);
    try { setUsers(await api<AdminUser[]>("GET", "/api/admin/users")); }
    catch (e: any) { toast({ title: "Could not load users", description: String(e.message || e), variant: "destructive" }); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [token, role]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("POST", "/api/admin/users", { email, temporaryPassword });
      setEmail("");
      setTemporaryPassword("");
      toast({ title: "Admin account created" });
      await load();
    } catch (err: any) {
      toast({ title: "Could not create admin user", description: String(err.message || err), variant: "destructive" });
    }
  };

  const action = async (title: string, request: () => Promise<void>) => {
    try {
      await request();
      toast({ title });
      await load();
    } catch (err: any) {
      toast({ title: "Action failed", description: String(err.message || err), variant: "destructive" });
    }
  };

  const [resetById, setResetById] = useState<Record<number, string>>({});
  const mainAdmin = useMemo(() => users.find(u => u.role === "main" && u.isActive), [users]);

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-semibold text-foreground">Admin users</h1>
        <p className="text-sm text-muted-foreground">Main Admin controls account creation, password reset, lock/unlock, deactivation, deletion, and ownership transfer.</p>
      </div>

      {role !== "main" ? (
        <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">Only the Main Admin can manage users.</div>
      ) : (
        <>
          <form onSubmit={createUser} className="mb-6 grid gap-3 rounded-xl border border-border p-4 md:grid-cols-3">
            <div>
              <Label htmlFor="new-admin-email">Email</Label>
              <Input id="new-admin-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="new-admin-temp-password">Temporary password</Label>
              <Input id="new-admin-temp-password" type="text" value={temporaryPassword} onChange={e => setTemporaryPassword(e.target.value)} required className="mt-1.5" />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full">Create Standard Admin</Button>
            </div>
          </form>

          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">{u.role === "main" ? "Main Admin" : "Standard Admin"}</td>
                    <td className="px-3 py-2">{u.isFullyLocked ? "Fully locked" : u.temporaryLockUntil ? "Temp locked" : u.isActive ? "Active" : "Inactive"}{u.mustChangePassword ? " · temp password" : ""}</td>
                    <td className="px-3 py-2">{u.failedLoginAttempts}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {u.role === "standard" ? (
                          <>
                            <Input
                              placeholder="Temp password"
                              value={resetById[u.id] ?? ""}
                              onChange={e => setResetById(prev => ({ ...prev, [u.id]: e.target.value }))}
                              className="h-8 w-44"
                            />
                            <Button size="sm" variant="outline" onClick={() => action("Password reset", () => api("POST", `/api/admin/users/${u.id}/reset-password`, { temporaryPassword: resetById[u.id] || "" }))}>Reset password</Button>
                            <Button size="sm" variant="outline" onClick={() => action("User unlocked", () => api("POST", `/api/admin/users/${u.id}/unlock`))}>Unlock</Button>
                            {u.isActive
                              ? <Button size="sm" variant="outline" onClick={() => action("User deactivated", () => api("POST", `/api/admin/users/${u.id}/deactivate`))}>Deactivate</Button>
                              : <Button size="sm" variant="outline" onClick={() => action("User activated", () => api("POST", `/api/admin/users/${u.id}/activate`))}>Activate</Button>}
                            <Button size="sm" variant="destructive" onClick={() => action("User deleted", () => api("DELETE", `/api/admin/users/${u.id}`))}>Delete</Button>
                            {mainAdmin && mainAdmin.id !== u.id ? (
                              <Button size="sm" onClick={() => action("Ownership transferred", () => api("POST", "/api/admin/users/transfer-main", { userId: u.id }))}>Make Main Admin</Button>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Main Admin recovery/unlock is server-side only.</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && users.length === 0 ? (
                  <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>No users.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminLayout>
  );
}
