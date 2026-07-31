import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminSpotListItem } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Database, AlertTriangle, CheckCircle2, Clock3, Sparkles } from "lucide-react";

function DataPill({ status }: { status?: "fresh" | "dirty" | "missing" }) {
  if (status === "fresh") return <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Fresh</Badge>;
  if (status === "dirty") return <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Dirty</Badge>;
  return <Badge className="bg-rose-100 text-rose-900 hover:bg-rose-100">Missing</Badge>;
}

export default function AdminData() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState<null | "all" | "missing" | "scores" | number>(null);
  const [view, setView] = useState<"all" | "dirty" | "missing" | "fresh">("all");
  const { toast } = useToast();

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);

  const { data: spots, isLoading, refetch } = useQuery<AdminSpotListItem[]>({
    queryKey: ["/api/admin/spots"], enabled: !!token,
  });
  const { data: usage } = useQuery<{ archiveRequests: number; marineRequests: number; failedRequests: number; totalRequests: number }>({
    queryKey: ["/api/admin/usage/open-meteo"], enabled: !!token,
  });

  const dataRows = useMemo(() => (spots ?? []).map(s => ({
    ...s,
    dataStatus: s.dataStatus || (s.dataLastRefreshedAt ? "fresh" : "missing") as "fresh" | "dirty" | "missing",
  })), [spots]);
  const fresh = dataRows.filter(s => s.dataStatus === "fresh");
  const dirty = dataRows.filter(s => s.dataStatus === "dirty");
  const missing = dataRows.filter(s => s.dataStatus === "missing");
  const rank = (status: "fresh" | "dirty" | "missing") => status === "dirty" ? 0 : status === "missing" ? 1 : 2;
  const visibleRows = dataRows
    .filter(s => view === "all" ? true : s.dataStatus === view)
    .sort((a, b) => rank(a.dataStatus || "missing") - rank(b.dataStatus || "missing") || (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.name.localeCompare(b.name));

  const run = async (scope: "all" | "missing") => {
    setBusy(scope);
    try {
      const out = await api<{ updated: number; skipped: number; failed: number }>("POST", "/api/admin/data/refresh", { scope });
      toast({ title: scope === "all" ? `Refreshed ${out.updated} spots` : `Filled ${out.updated} new spots`, description: `${out.skipped} skipped, ${out.failed} failed` });
      await refetch();
    } catch (e: any) {
      toast({ title: "Refresh failed", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const recalc = async () => {
    setBusy("scores");
    try {
      const out = await api<{ updated: number }>("POST", "/api/admin/scores/recalculate");
      toast({ title: `Recalculated ${out.updated} monthly scores` });
      await refetch();
    } catch (e: any) {
      toast({ title: "Could not recalculate scores", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const publishAllWeather = async () => {
    setBusy("all");
    try {
      const out = await api<{ published: number }>("POST", "/api/admin/data/publish");
      toast({ title: `Published ${out.published} weather records` });
      await refetch();
    } catch (e: any) {
      toast({ title: "Could not publish weather data", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const refreshSpot = async (id: number) => {
    setBusy(id);
    try {
      await api("POST", `/api/admin/spots/${id}/enrich`);
      toast({ title: "Spot refreshed" });
      await refetch();
    } catch (e: any) {
      toast({ title: "Refresh failed", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Data</h1>
          <p className="text-sm text-muted-foreground">Weather refreshes, score recomputation, and stale-data tracking.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={recalc} disabled={busy !== null} data-testid="button-recalculate-scores-data">
            {busy === "scores" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Recalculate scores
          </Button>
          <Button variant="outline" onClick={() => run("missing")} disabled={busy !== null} data-testid="button-refresh-missing-data">
            {busy === "missing" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
            Refresh missing only
          </Button>
          <Button onClick={() => run("all")} disabled={busy !== null} data-testid="button-refresh-all-data">
            {busy === "all" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh all spots
          </Button>
          <Button variant="outline" onClick={publishAllWeather} disabled={busy !== null} data-testid="button-publish-all-weather">
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Publish all weather data
          </Button>
        </div>
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-4">
        <Card className="cursor-pointer" onClick={() => setView("all")}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total spots</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{spots?.length ?? 0}</CardContent></Card>
        <Card className="cursor-pointer" onClick={() => setView("fresh")}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Fresh</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-emerald-700">{fresh.length}</CardContent></Card>
        <Card className="cursor-pointer" onClick={() => setView("dirty")}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Dirty</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-amber-700">{dirty.length}</CardContent></Card>
        <Card className="cursor-pointer" onClick={() => setView("missing")}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Missing</CardTitle></CardHeader><CardContent className="text-2xl font-semibold text-rose-700">{missing.length}</CardContent></Card>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", "dirty", "missing", "fresh"] as const).map(status => (
          <Button key={status} variant={view === status ? "default" : "outline"} size="sm" onClick={() => setView(status)}>
            {status[0].toUpperCase() + status.slice(1)}
          </Button>
        ))}
      </div>

      {usage && (
        <div className="mb-4 rounded-2xl border border-card-border bg-card p-4 text-sm text-muted-foreground">
          Open-Meteo requests this server process: {usage.totalRequests} total, {usage.archiveRequests} archive, {usage.marineRequests} marine, {usage.failedRequests} failed.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-card-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Spot</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last refreshed</th>
                <th className="px-4 py-3 font-medium">Last edited</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(s => (
                <tr key={s.id} className="border-t border-border hover-elevate">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.country || "—"}</div>
                  </td>
                  <td className="px-4 py-3"><DataPill status={s.dataStatus as any} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{s.dataLastRefreshedAt ? new Date(s.dataLastRefreshedAt).toLocaleString() : <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Never</span>}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="outline" onClick={() => refreshSpot(s.id)} disabled={busy !== null}>
                      {busy === s.id ? <Clock3 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Refresh spot
                    </Button>
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