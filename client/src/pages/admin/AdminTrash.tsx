import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { TrashItem, RestoreInfo } from "@/lib/types";
import { Trash2, RotateCcw } from "lucide-react";

type GroupedTrash = { spots: TrashItem[]; schools: TrashItem[]; stays: TrashItem[] };

function daysRemaining(deletedAt: string): number {
  const deleted = new Date(deletedAt).getTime();
  const expiresAt = deleted + 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

function DaysBadge({ deletedAt }: { deletedAt: string }) {
  const days = daysRemaining(deletedAt);
  const urgent = days <= 3;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${urgent ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}>
      {days}d left
    </span>
  );
}

function RestoreModal({ item, onClose, onConfirm }: {
  item: TrashItem;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [info, setInfo] = useState<RestoreInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const { token } = useAuth();

  useEffect(() => {
    if (!token) return;
    api<RestoreInfo>("GET", `/api/admin/trash/${item.category}/${item.id}/restore-info`)
      .then((d) => setInfo(d))
      .catch(() => setInfo({ category: item.category, id: item.id, name: item.name, totalAssignments: 0, recoverableAssignments: 0, unrecoverableAssignments: 0, affectedItems: [] }))
      .finally(() => setLoading(false));
  }, [item.category, item.id, item.name, token]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 font-serif text-lg font-semibold">Restore "{item.name}"?</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          The item will be restored as <strong>unpublished</strong> and you can review it before publishing.
        </p>
        {loading && <p className="text-sm text-muted-foreground">Loading details…</p>}
        {!loading && info && info.affectedItems.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <p className="mb-1 font-medium">Prior spot assignments</p>
            <p>This item was assigned to {info.affectedItems.length} spot{info.affectedItems.length !== 1 ? "s" : ""}. Assignments are not restored — it will appear unassigned.</p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onConfirm} disabled={loading}>Restore</Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminTrash() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [grouped, setGrouped] = useState<GroupedTrash>({ spots: [], schools: [], stays: [] });
  const [loading, setLoading] = useState(true);
  const [restoreTarget, setRestoreTarget] = useState<TrashItem | null>(null);

  const loadTrash = async () => {
    setLoading(true);
    try {
      const items = await api<TrashItem[]>("GET", "/api/admin/trash");
      const g: GroupedTrash = { spots: [], schools: [], stays: [] };
      for (const item of items) {
        if (item.category === "spots") g.spots.push(item);
        else if (item.category === "schools") g.schools.push(item);
        else if (item.category === "stays") g.stays.push(item);
      }
      setGrouped(g);
    } catch (e: any) {
      toast({ title: "Failed to load trash", description: String(e.message || e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) void loadTrash();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const confirmRestore = async () => {
    if (!restoreTarget) return;
    try {
      await api("POST", `/api/admin/trash/${restoreTarget.category}/${restoreTarget.id}/restore`);
      toast({ title: `"${restoreTarget.name}" restored as unpublished` });
      setRestoreTarget(null);
      void loadTrash();
    } catch (e: any) {
      toast({ title: "Restore failed", description: String(e.message || e), variant: "destructive" });
    }
  };

  const permanentDelete = async (item: TrashItem) => {
    if (!window.confirm(`Permanently delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await api("DELETE", `/api/admin/trash/${item.category}/${item.id}`);
      toast({ title: `"${item.name}" permanently deleted` });
      void loadTrash();
    } catch (e: any) {
      toast({ title: "Delete failed", description: String(e.message || e), variant: "destructive" });
    }
  };

  const totalCount = grouped.spots.length + grouped.schools.length + grouped.stays.length;

  const renderSection = (label: string, items: TrashItem[]) => (
    <div className="mb-6">
      <h2 className="mb-3 font-medium text-foreground">{label}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deleted {label.toLowerCase()}.</p>
      ) : (
        <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Deleted</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                  <td className="px-4 py-3 font-medium text-foreground">{item.name}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(item.deletedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <DaysBadge deletedAt={item.deletedAt} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setRestoreTarget(item)} className="gap-1">
                        <RotateCcw className="h-3.5 w-3.5" /> Restore
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void permanentDelete(item)} className="text-muted-foreground hover:text-destructive" title="Delete permanently">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Trash</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : totalCount === 0 ? "Trash is empty" : `${totalCount} item${totalCount !== 1 ? "s" : ""} · permanently deleted after 30 days`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadTrash()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {renderSection("Spots", grouped.spots)}
      {renderSection("Kite Schools", grouped.schools)}
      {renderSection("Stays", grouped.stays)}

      {restoreTarget && (
        <RestoreModal
          item={restoreTarget}
          onClose={() => setRestoreTarget(null)}
          onConfirm={() => void confirmRestore()}
        />
      )}
    </AdminLayout>
  );
}
