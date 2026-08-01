import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { AdminError } from "@/lib/types";

type StatusFilter = "All" | "Open" | "Resolved" | "Dismissed";

const STATUS_BADGE: Record<string, string> = {
  Open: "bg-red-100 text-red-800",
  Resolved: "bg-emerald-100 text-emerald-800",
  Dismissed: "bg-stone-100 text-stone-600",
};

function formatTs(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function AdminErrors() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [filter, setFilter] = useState<StatusFilter>("All");
  const [errors, setErrors] = useState<AdminError[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = filter !== "All" ? `?status=${filter}` : "";
      const rows = await api<AdminError[]>("GET", `/api/admin/errors${params}`);
      setErrors(rows);
      const countRes = await api<{ open: number }>("GET", "/api/admin/errors/count");
      setOpenCount(countRes.open);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  };

  // Initial load + auto-refresh
  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timerId: number | null = null;

    const scheduleNext = (ms: number) => {
      if (!alive) return;
      timerId = window.setTimeout(() => { void poll(); }, ms);
    };

    const poll = async () => {
      try {
        const params = filter !== "All" ? `?status=${filter}` : "";
        const rows = await api<AdminError[]>("GET", `/api/admin/errors${params}`);
        if (!alive) return;
        setErrors(rows);
        const hasOpen = rows.some(r => r.status === "Open");
        scheduleNext(hasOpen ? 5000 : 30_000);
      } catch {
        if (alive) scheduleNext(30_000);
      }
    };

    void poll();
    return () => { alive = false; if (timerId !== null) window.clearTimeout(timerId); };
  }, [token, filter]);

  // Also fetch count separately for subtitle
  useEffect(() => {
    if (!token) return;
    api<{ open: number }>("GET", "/api/admin/errors/count")
      .then(r => setOpenCount(r.open))
      .catch(() => {});
  }, [token, errors]);

  const dismiss = async (id: number) => {
    try {
      await api("POST", `/api/admin/errors/${id}/dismiss`);
      setErrors(prev => prev.map(e => e.id === id ? { ...e, status: "Dismissed" as const } : e));
      setOpenCount(c => Math.max(0, c - 1));
      toast({ title: "Error dismissed" });
    } catch {
      toast({ title: "Failed to dismiss", variant: "destructive" });
    }
  };

  const FILTERS: StatusFilter[] = ["All", "Open", "Resolved", "Dismissed"];

  const displayed = filter === "All" ? errors : errors.filter(e => e.status === filter);

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Errors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {openCount > 0
            ? `${openCount} open error${openCount !== 1 ? "s" : ""} require attention`
            : "No open errors"}
        </p>
      </div>

      <div className="mb-4 flex gap-2">
        {FILTERS.map(f => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f}
          </Button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && displayed.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {filter === "All" ? "No errors recorded." : `No ${filter.toLowerCase()} errors.`}
        </div>
      )}

      {!loading && displayed.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Timestamp</th>
                <th className="px-4 py-3 font-medium">Area</th>
                <th className="px-4 py-3 font-medium">Record</th>
                <th className="px-4 py-3 font-medium">Summary</th>
                <th className="px-4 py-3 font-medium">Error ID</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {displayed.map(e => (
                <tr key={e.id} className="hover:bg-muted/30">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatTs(e.createdAt)}</td>
                  <td className="px-4 py-3 font-medium">{e.area}</td>
                  <td className="px-4 py-3 text-muted-foreground">{e.recordId ?? "—"}</td>
                  <td className="px-4 py-3">{e.summary}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{e.errorId.slice(0, 8)}…</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[e.status] ?? ""}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {e.status === "Open" && (
                      <Button size="sm" variant="outline" onClick={() => dismiss(e.id)}>
                        Dismiss
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
