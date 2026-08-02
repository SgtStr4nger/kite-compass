import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminSpotListItem } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, AlertTriangle, Clock3, ArrowRight, ChevronDown, Search, CheckCircle2, Database } from "lucide-react";

function DataPill({ status }: { status?: "fresh" | "dirty" | "missing" }) {
  if (status === "fresh") return <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Fresh</Badge>;
  if (status === "dirty") return <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Dirty</Badge>;
  return <Badge className="bg-rose-100 text-rose-900 hover:bg-rose-100">Missing</Badge>;
}

export default function AdminData() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState<null | string | number>(null);
  const [view, setView] = useState<"all" | "dirty" | "missing" | "fresh">("all");
  const [q, setQ] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<"name" | "updatedAt">("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
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
  const rank = (status: "fresh" | "dirty" | "missing") => status === "dirty" ? 0 : status === "missing" ? 1 : 2;
  const visibleRows = dataRows
    .filter(s => view === "all" ? true : s.dataStatus === view)
    .filter(s => {
      const haystack = `${s.name} ${s.country || ""}`.toLowerCase();
      return haystack.includes(q.trim().toLowerCase());
    })
    .sort((a, b) => {
      const statusCmp = rank(a.dataStatus || "missing") - rank(b.dataStatus || "missing");
      if (statusCmp !== 0) return statusCmp;
      let cmp = 0;
      if (sortBy === "name") cmp = a.name.localeCompare(b.name);
      else cmp = (a.updatedAt || "").localeCompare(b.updatedAt || "");
      return sortDir === "asc" ? cmp : -cmp;
    });
  const visibleIds = visibleRows.map(s => s.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));
  const selectedVisibleCount = visibleRows.filter(s => selectedIds.includes(s.id)).length;

  useEffect(() => {
    const existingIds = new Set(dataRows.map(row => row.id));
    setSelectedIds(prev => prev.filter(id => existingIds.has(id)));
  }, [dataRows]);

  const refreshScope = async (scope: "all" | "missing" | "filtered" | "selected", spotIds: number[] = []) => {
    const key = `refresh-${scope}`;
    setBusy(key);
    try {
      const out = await api<{ updated: number; skipped: number; failed: number }>("POST", "/api/admin/data/refresh", { scope, spotIds });
      toast({ title: `Refreshed ${out.updated} spots`, description: `${out.skipped} skipped, ${out.failed} failed` });
      await refetch();
    } catch (e: any) {
      toast({ title: "Refresh failed", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const publishWeather = async (scope: "all" | "filtered" | "selected", spotIds: number[] = []) => {
    const key = `publish-${scope}`;
    setBusy(key);
    try {
      const out = await api<{ published: number; skipped: number; alreadyPublished: number; noMonthlyData: number }>("POST", "/api/admin/data/publish", { scope, spotIds });
      toast({
        title: `Published ${out.published} weather record(s)`,
        description: `${out.skipped} skipped (${out.alreadyPublished} already published, ${out.noMonthlyData} with no monthly rows)`,
      });
      await refetch();
    } catch (e: any) {
      toast({ title: "Could not publish weather data", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const recalculateScores = async (spotIds: number[]) => {
    setBusy("scores");
    try {
      const out = await api<{ updated: number }>("POST", "/api/admin/scores/recalculate", spotIds.length ? { spotIds } : {});
      toast({ title: "Scores recalculated", description: `${out.updated} monthly rows updated` });
      await refetch();
    } catch (e: any) {
      toast({ title: "Score recalculation failed", description: String(e.message || e), variant: "destructive" });
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

  const primaryPublishScope = selectedIds.length > 0 ? "selected" : "filtered";
  const primaryPublishIds = selectedIds.length > 0 ? selectedIds : visibleIds;
  const primaryPublishLabel = selectedIds.length > 0
    ? `Publish selected weather (${selectedIds.length})`
    : `Publish filtered weather (${visibleRows.length})`;

  return (
    <AdminLayout>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Data</h1>
          <p className="text-sm text-muted-foreground">Weather refreshes and stale-data tracking.</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/admin/data/scoring")} data-testid="button-configure-scoring">
          <ArrowRight className="mr-2 h-4 w-4" />
          Configure scoring
        </Button>
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-64 max-w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search spot or country…"
                  className="pl-9"
                />
              </div>
              {(["all", "dirty", "missing", "fresh"] as const).map(status => (
                <Button key={status} variant={view === status ? "default" : "outline"} size="sm" onClick={() => setView(status)}>
                  {status[0].toUpperCase() + status.slice(1)}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {selectedIds.length} selected ({selectedVisibleCount} visible)
              </span>
              <div className="inline-flex">
                <Button
                  disabled={busy !== null || !primaryPublishIds.length}
                  className="rounded-r-none"
                  onClick={() => publishWeather(primaryPublishScope, primaryPublishIds)}
                  data-testid="button-weather-actions-primary"
                >
                  {String(busy ?? "").startsWith("refresh-") || String(busy ?? "").startsWith("publish-") || busy === "scores"
                    ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    : <Database className="mr-2 h-4 w-4" />}
                  {primaryPublishLabel}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" disabled={busy !== null} className="rounded-l-none border-l-0 px-2" data-testid="button-weather-actions-menu">
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {selectedIds.length > 0 && (
                    <>
                      <DropdownMenuItem onClick={() => refreshScope("selected", selectedIds)}>Refresh selected weather ({selectedIds.length})</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => publishWeather("selected", selectedIds)}>Publish selected weather ({selectedIds.length})</DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem onClick={() => refreshScope("filtered", visibleIds)} disabled={!visibleRows.length}>Refresh filtered weather ({visibleRows.length})</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => publishWeather("filtered", visibleIds)} disabled={!visibleRows.length}>Publish filtered weather ({visibleRows.length})</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => refreshScope("missing")}>Refresh missing weather</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => refreshScope("all")}>Refresh all spots</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => publishWeather("all")}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Publish all weather data
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => recalculateScores(selectedIds.length ? selectedIds : visibleIds)} disabled={!visibleRows.length}>
                    Recalculate scores for scope
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => recalculateScores([])}>Recalculate scores for all spots</DropdownMenuItem>
                </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(e) => setSelectedIds(e.target.checked
                      ? Array.from(new Set([...selectedIds, ...visibleIds]))
                      : selectedIds.filter(id => !visibleIds.includes(id)))}
                  />
                </th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      if (sortBy === "name") setSortDir(sortDir === "asc" ? "desc" : "asc");
                      else { setSortBy("name"); setSortDir("asc"); }
                    }}
                    className="inline-flex items-center gap-1"
                  >
                    Spot
                    {sortBy === "name" ? (sortDir === "asc" ? "▲" : "▼") : null}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last refreshed</th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      if (sortBy === "updatedAt") setSortDir(sortDir === "asc" ? "desc" : "asc");
                      else { setSortBy("updatedAt"); setSortDir("desc"); }
                    }}
                    className="inline-flex items-center gap-1"
                  >
                    Last edited
                    {sortBy === "updatedAt" ? (sortDir === "asc" ? "▲" : "▼") : null}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(s => (
                <tr key={s.id} className="border-t border-border hover-elevate">
                  <td className="px-2 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(s.id)}
                      onChange={(e) => setSelectedIds(prev => e.target.checked
                        ? Array.from(new Set([...prev, s.id]))
                        : prev.filter(id => id !== s.id))}
                    />
                  </td>
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
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No spots found for this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
