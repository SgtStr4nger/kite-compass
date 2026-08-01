import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { Redirect } from "@/lib/types";
import { Plus } from "lucide-react";

type SpotOption = { id: number; name: string; slug: string };

function conflictMessage(reason: string): string {
  if (reason.includes("duplicate_source")) return "A redirect with this source path already exists.";
  if (reason.includes("self_redirect")) return "Source and target cannot be the same path.";
  if (reason.includes("redirect_loop")) return "This would create a redirect loop (A → B → A).";
  return "Conflict: " + reason;
}

function TargetField({
  targetType,
  toUrl,
  spotId,
  spots,
  onToUrl,
  onSpotId,
}: {
  targetType: "spot" | "manual";
  toUrl: string;
  spotId: number | null;
  spots: SpotOption[];
  onToUrl: (v: string) => void;
  onSpotId: (v: number | null) => void;
}) {
  if (targetType === "spot") {
    return (
      <select
        value={spotId ?? ""}
        onChange={e => onSpotId(Number(e.target.value) || null)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="">Select a spot…</option>
        {spots.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    );
  }
  return (
    <Input
      value={toUrl}
      onChange={e => onToUrl(e.target.value)}
      placeholder="https://example.com/page or /new-path"
    />
  );
}

export default function AdminRedirects() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [items, setItems] = useState<Redirect[]>([]);
  const [loading, setLoading] = useState(false);
  const [spots, setSpots] = useState<SpotOption[]>([]);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createFrom, setCreateFrom] = useState("");
  const [createTargetType, setCreateTargetType] = useState<"spot" | "manual">("manual");
  const [createToUrl, setCreateToUrl] = useState("");
  const [createSpotId, setCreateSpotId] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  // Edit state (one row at a time)
  const [editId, setEditId] = useState<number | null>(null);
  const [editFrom, setEditFrom] = useState("");
  const [editTargetType, setEditTargetType] = useState<"spot" | "manual">("manual");
  const [editToUrl, setEditToUrl] = useState("");
  const [editSpotId, setEditSpotId] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  useEffect(() => {
    if (!token) navigate("/admin");
  }, [token, navigate]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api<Redirect[]>("GET", "/api/admin/redirects");
      setItems(data);
    } catch {
      toast({ title: "Failed to load redirects", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    load();
    api<SpotOption[]>("GET", "/api/admin/spots")
      .then(data => setSpots(data.map(s => ({ id: s.id, name: s.name, slug: s.slug }))))
      .catch(() => {});
  }, [token]);

  function resolveToUrl(targetType: "spot" | "manual", toUrl: string, spotId: number | null): string {
    if (targetType === "spot" && spotId) {
      const spot = spots.find(s => s.id === spotId);
      return spot ? `/spots/${spot.slug}` : "";
    }
    return toUrl.trim();
  }

  const handleCreate = async () => {
    if (!createFrom.trim()) { setCreateError("From path is required"); return; }
    const toUrl = resolveToUrl(createTargetType, createToUrl, createSpotId);
    if (!toUrl) { setCreateError("Target is required"); return; }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const body: Record<string, unknown> = { fromPath: createFrom.trim(), toUrl, targetType: createTargetType };
      if (createTargetType === "spot") body.spotId = createSpotId;
      await api("POST", "/api/admin/redirects", body);
      setShowCreate(false);
      setCreateFrom("");
      setCreateToUrl("");
      setCreateSpotId(null);
      setCreateTargetType("manual");
      await load();
      toast({ title: "Redirect created" });
    } catch (e: any) {
      setCreateError(conflictMessage(String(e?.message ?? "Error creating redirect")));
    } finally {
      setCreateBusy(false);
    }
  };

  const startEdit = (item: Redirect) => {
    setEditId(item.id);
    setEditFrom(item.fromPath);
    setEditTargetType(item.targetType);
    setEditToUrl(item.toUrl);
    setEditSpotId(item.spotId);
    setEditError(null);
  };

  const handleEdit = async () => {
    if (!editFrom.trim()) { setEditError("From path is required"); return; }
    const toUrl = resolveToUrl(editTargetType, editToUrl, editSpotId);
    if (!toUrl) { setEditError("Target is required"); return; }
    setEditBusy(true);
    setEditError(null);
    try {
      const body: Record<string, unknown> = { fromPath: editFrom.trim(), toUrl, targetType: editTargetType };
      body.spotId = editTargetType === "spot" ? editSpotId : null;
      await api("PATCH", `/api/admin/redirects/${editId}`, body);
      setEditId(null);
      await load();
      toast({ title: "Redirect updated" });
    } catch (e: any) {
      setEditError(conflictMessage(String(e?.message ?? "Error updating redirect")));
    } finally {
      setEditBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this redirect?")) return;
    try {
      await api("DELETE", `/api/admin/redirects/${id}`);
      await load();
      toast({ title: "Redirect deleted" });
    } catch {
      toast({ title: "Failed to delete redirect", variant: "destructive" });
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Redirects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage URL redirects. Spot-linked redirects follow slug changes automatically.
            </p>
          </div>
          {!showCreate && (
            <Button size="sm" onClick={() => { setShowCreate(true); setCreateError(null); }}>
              <Plus className="mr-1 h-4 w-4" /> Add redirect
            </Button>
          )}
        </div>

        {showCreate && (
          <div className="rounded-lg border bg-card p-4 space-y-4">
            <h2 className="text-sm font-semibold">New redirect</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">From path</label>
                <Input
                  value={createFrom}
                  onChange={e => setCreateFrom(e.target.value)}
                  placeholder="/old-spot-name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Target type</label>
                <select
                  value={createTargetType}
                  onChange={e => {
                    setCreateTargetType(e.target.value as "spot" | "manual");
                    setCreateToUrl("");
                    setCreateSpotId(null);
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="manual">Manual URL</option>
                  <option value="spot">Spot (linked)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  {createTargetType === "spot" ? "Spot" : "To URL"}
                </label>
                <TargetField
                  targetType={createTargetType}
                  toUrl={createToUrl}
                  spotId={createSpotId}
                  spots={spots}
                  onToUrl={setCreateToUrl}
                  onSpotId={setCreateSpotId}
                />
              </div>
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={createBusy}>
                {createBusy ? "Creating…" : "Create"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowCreate(false); setCreateError(null); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No redirects configured yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">From</th>
                  <th className="px-4 py-2 text-left font-medium">To</th>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map(item =>
                  editId === item.id ? (
                    <tr key={item.id} className="bg-muted/20">
                      <td className="px-4 py-2">
                        <Input
                          value={editFrom}
                          onChange={e => setEditFrom(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <TargetField
                          targetType={editTargetType}
                          toUrl={editToUrl}
                          spotId={editSpotId}
                          spots={spots}
                          onToUrl={setEditToUrl}
                          onSpotId={setEditSpotId}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={editTargetType}
                          onChange={e => {
                            setEditTargetType(e.target.value as "spot" | "manual");
                            setEditToUrl("");
                            setEditSpotId(null);
                          }}
                          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                        >
                          <option value="manual">Manual</option>
                          <option value="spot">Spot</option>
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        {editError && <span className="text-xs text-destructive">{editError}</span>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={handleEdit}
                            disabled={editBusy}
                          >
                            {editBusy ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setEditId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={item.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono text-xs">{item.fromPath}</td>
                      <td className="px-4 py-2 text-xs">
                        {item.targetType === "spot" && item.spotName ? (
                          <span title={item.toUrl} className="font-medium">{item.spotName}</span>
                        ) : (
                          <span className="break-all font-mono">{item.toUrl}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                          {item.targetType === "spot" ? "Spot" : "Manual"}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {item.isBroken ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
                            Broken target
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => startEdit(item)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => handleDelete(item.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
