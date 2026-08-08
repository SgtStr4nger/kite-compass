import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminSpotListItem, ExcelImportAction, ExcelImportHistoryItem, ExcelImportPreviewResponse } from "@/lib/types";
import { countryNameForCode } from "@shared/locations";
import { Plus, Search, Circle, CheckCircle2, PencilLine, BadgeInfo, ChevronDown, Download, SendHorizontal, RefreshCw, AlertTriangle, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

function StatusPill({ published, hasDraft }: { published: boolean; hasDraft: boolean }) {
  if (published && !hasDraft) return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Published</span>;
  if (published && hasDraft) return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><PencilLine className="h-3.5 w-3.5" /> Published · draft edits</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-500"><Circle className="h-3.5 w-3.5" /> Draft</span>;
}
function DataPill({ status }: { status?: "fresh" | "dirty" | "missing" }) {
  if (status === "fresh") return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Fresh</span>;
  if (status === "dirty") return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><BadgeInfo className="h-3.5 w-3.5" /> Dirty</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700"><Circle className="h-3.5 w-3.5" /> Missing</span>;
}
function toDataUrl(fileName: string, base64: string) {
  const lower = fileName.toLowerCase();
  const mime = lower.endsWith(".json") ? "application/json" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return `data:${mime};base64,${base64}`;
}
function downloadBase64(fileName: string, base64: string) {
  const link = document.createElement("a");
  link.href = toDataUrl(fileName, base64);
  link.download = fileName;
  link.click();
}
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

type DataView = "all" | "dirty" | "missing" | "fresh";
type SortKey = "name" | "updatedAt" | "publishedAt";

export default function AdminSpots() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [view, setView] = useState<DataView>("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [preview, setPreview] = useState<ExcelImportPreviewResponse | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [history, setHistory] = useState<ExcelImportHistoryItem[]>([]);
  const [busy, setBusy] = useState<null | string | number>(null);
  const { toast } = useToast();

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);
  const { data: spots, isLoading, refetch } = useQuery<AdminSpotListItem[]>({ queryKey: ["/api/admin/spots"], enabled: !!token });
  const { data: usage } = useQuery<{ archiveRequests: number; marineRequests: number; failedRequests: number; totalRequests: number }>({
    queryKey: ["/api/admin/usage/open-meteo"], enabled: !!token,
  });

  const dataRows = useMemo(() => (spots ?? []).map(s => ({
    ...s,
    dataStatus: s.dataStatus || (s.dataLastRefreshedAt ? "fresh" : "missing") as "fresh" | "dirty" | "missing",
  })), [spots]);

  const filtered = useMemo(() => {
    const haystack = (s: AdminSpotListItem) => `${s.name} ${s.country || ""} ${countryNameForCode(s.country)}`.toLowerCase();
    const base = dataRows.filter(s => view === "all" ? true : s.dataStatus === view).filter(s => haystack(s).includes(q.trim().toLowerCase()));
    return base.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") cmp = a.name.localeCompare(b.name);
      else if (sortBy === "publishedAt") cmp = (a.publishedAt || "").localeCompare(b.publishedAt || "");
      else cmp = (a.updatedAt || "").localeCompare(b.updatedAt || "");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [dataRows, q, view, sortBy, sortDir]);
  const filteredIds = filtered.map(s => s.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.includes(id));
  const filtersActive = q.trim().length > 0 || view !== "all";
  const selectedVisibleCount = filtered.filter(s => selectedIds.includes(s.id)).length;

  // Prune stale selections when the underlying list changes (e.g. after refresh).
  useEffect(() => {
    const existingIds = new Set(dataRows.map(row => row.id));
    setSelectedIds(prev => prev.filter(id => existingIds.has(id)));
  }, [dataRows]);

  const loadHistory = async () => setHistory(await api<ExcelImportHistoryItem[]>("GET", "/api/admin/excel/import/spots/history"));
  useEffect(() => { if (token) void loadHistory(); }, [token]);
  useEffect(() => {
    if (!token || preview) return;
    api<ExcelImportPreviewResponse>("GET", "/api/admin/excel/import/spots/preview-current")
      .then(setPreview)
      .catch(() => {});
  }, [token, preview]);

  const exportRows = async (scope: "selected" | "filtered" | "all") => {
    try {
      const out = await api<{ fileName: string; fileBase64: string }>("POST", "/api/admin/excel/export/spots", {
        scope,
        selectedIds,
        filters: { q },
      });
      downloadBase64(out.fileName, out.fileBase64);
    } catch (e: any) {
      toast({ title: "Export failed", description: String(e.message || e), variant: "destructive" });
    }
  };

  const exportPrimaryScope: "all" | "filtered" | "selected" =
    selectedIds.length > 0 ? "selected" : (filtersActive ? "filtered" : "all");
  const exportPrimaryLabel =
    exportPrimaryScope === "selected" ? "Export selected JSON"
      : exportPrimaryScope === "filtered" ? "Export filtered JSON"
        : "Export all JSON";

  const publishBulk = async (mode: "content" | "weather" | "content-weather") => {
    const targetIds = selectedIds.length ? selectedIds : filteredIds;
    if (!targetIds.length) {
      toast({ title: "No spots to publish", description: "Selection/filter returned no rows.", variant: "destructive" });
      return;
    }
    setBusy("publish");
    try {
      const out = await api<{ targetSpots: number; contentPublished: number; weatherPublished: number; recalculatedRows: number }>(
        "POST",
        "/api/admin/spots/publish-bulk",
        { mode, spotIds: targetIds },
      );
      const modeLabel = mode === "content" ? "Content" : mode === "weather" ? "Weather" : "Content + weather";
      toast({
        title: `${modeLabel} publish finished`,
        description: `${out.targetSpots} spots, ${out.contentPublished} content updates, ${out.weatherPublished} weather rows, ${out.recalculatedRows} score rows recalculated`,
      });
      await refetch();
    } catch (e: any) {
      toast({ title: "Bulk publish failed", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

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

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir(key === "name" ? "asc" : "desc"); }
  };

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setImportBusy(true);
    try {
      const fileBase64 = toBase64(new Uint8Array(await file.arrayBuffer()));
      const out = await api<ExcelImportPreviewResponse>("POST", "/api/admin/excel/import/spots/preview", { fileName: file.name, fileBase64 });
      setPreview(out);
      await loadHistory();
    } catch (e: any) {
      toast({ title: "Import preview failed", description: String(e.message || e), variant: "destructive" });
    } finally {
      setImportBusy(false);
    }
  };

  const commitImport = async (action: ExcelImportAction) => {
    if (!preview) return;
    setImportBusy(true);
    try {
      await api("POST", "/api/admin/excel/import/spots/commit", { previewId: preview.previewId, action });
      setPreview(null);
      await Promise.all([loadHistory(), refetch()]);
      toast({ title: "Import completed" });
    } catch (e: any) {
      toast({ title: "Import failed", description: String(e.message || e), variant: "destructive" });
    } finally {
      setImportBusy(false);
    }
  };
  const cancelImport = async () => {
    if (!preview) return;
    setImportBusy(true);
    try {
      await api("POST", "/api/admin/excel/import/spots/cancel", { previewId: preview.previewId });
      setPreview(null);
      await loadHistory();
    } finally {
      setImportBusy(false);
    }
  };

  const running = busy !== null;

  return (
    <AdminLayout>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Spots</h1>
          <p className="text-sm text-muted-foreground">{spots?.length ?? 0} total</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/admin/scoring")} data-testid="button-configure-scoring">
            <ArrowRight className="mr-2 h-4 w-4" />
            Configure scoring
          </Button>
          <Link href="/admin/spots/new"><Button className="gap-2" data-testid="button-new-spot"><Plus className="h-4 w-4" /> New spot</Button></Link>
        </div>
      </div>

      {usage && (
        <div className="mb-4 rounded-2xl border border-card-border bg-card p-4 text-sm text-muted-foreground">
          Open-Meteo requests this server process: {usage.totalRequests} total, {usage.archiveRequests} archive, {usage.marineRequests} marine, {usage.failedRequests} failed.
        </div>
      )}

      <div className="mb-4 rounded-xl border border-border p-3">
        <div className="mb-2 flex flex-wrap gap-2">
          <div className="inline-flex">
            <Button size="sm" variant="outline" onClick={() => exportRows(exportPrimaryScope)} className="rounded-r-none">
              <Download className="mr-2 h-4 w-4" />
              {exportPrimaryLabel}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="rounded-l-none border-l-0 px-2">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {selectedIds.length > 0 && <DropdownMenuItem onClick={() => exportRows("selected")}>Export selected</DropdownMenuItem>}
                {filtersActive && <DropdownMenuItem onClick={() => exportRows("filtered")}>Export filtered</DropdownMenuItem>}
                <DropdownMenuItem onClick={() => exportRows("all")}>Export all</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="inline-flex">
            <Button size="sm" disabled={running} onClick={() => void publishBulk("content-weather")} className="rounded-r-none">
              <SendHorizontal className="mr-2 h-4 w-4" />
              Publish all
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={running} className="rounded-l-none border-l-0 px-2">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => void publishBulk("content")}>Publish content</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void publishBulk("weather")}>Publish weather data</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void publishBulk("content-weather")}>Publish all</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="inline-flex">
            <Button size="sm" variant="outline" disabled={running} onClick={() => refreshScope(selectedIds.length ? "selected" : "filtered", selectedIds.length ? selectedIds : filteredIds)} className="rounded-r-none">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh weather
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={running} className="rounded-l-none border-l-0 px-2">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {selectedIds.length > 0 && <DropdownMenuItem onClick={() => refreshScope("selected", selectedIds)}>Refresh selected weather ({selectedIds.length})</DropdownMenuItem>}
                <DropdownMenuItem onClick={() => refreshScope("filtered", filteredIds)} disabled={!filtered.length}>Refresh filtered weather ({filtered.length})</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => refreshScope("missing")}>Refresh missing weather</DropdownMenuItem>
                <DropdownMenuItem onClick={() => refreshScope("all")}>Refresh all spots</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="inline-flex">
            <Button size="sm" variant="outline" disabled={running} onClick={() => recalculateScores(selectedIds.length ? selectedIds : filteredIds)} className="rounded-r-none">
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Recalculate scores
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={running} className="rounded-l-none border-l-0 px-2">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => recalculateScores(selectedIds.length ? selectedIds : filteredIds)} disabled={!filtered.length}>Recalculate scores for scope</DropdownMenuItem>
                <DropdownMenuItem onClick={() => recalculateScores([])}>Recalculate scores for all spots</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Input type="file" accept=".json,application/json" className="max-w-xs" disabled={importBusy} onChange={e => void onUpload(e.target.files?.[0] ?? null)} />
        </div>
        {preview && (
          <div className="rounded border border-border p-3 text-sm">
            <div className="mb-2">Preview — New: {preview.summary.newCount}, Update: {preview.summary.updateCount}, Error ID not found: {preview.summary.errorIdNotFoundCount}, Error invalid data: {preview.summary.errorInvalidDataCount}</div>
            <div className="mb-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => downloadBase64(preview.files.updatesFileName, preview.files.updatesFileBase64)}>{preview.files.updatesFileName}</Button>
              <Button size="sm" variant="outline" onClick={() => downloadBase64(preview.files.errorsFileName, preview.files.errorsFileBase64)}>{preview.files.errorsFileName}</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={importBusy} onClick={() => void commitImport("create_update")}>Create new & update existing</Button>
              <Button size="sm" variant="outline" disabled={importBusy} onClick={() => void commitImport("create_only")}>Create new only</Button>
              <Button size="sm" variant="ghost" disabled={importBusy} onClick={() => void cancelImport()}>Cancel import</Button>
            </div>
          </div>
        )}
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search spots…" value={q} onChange={e => setQ(e.target.value)} className="pl-9" data-testid="input-search-spots" />
        <div className="mt-2 flex flex-wrap gap-2">
          {(["all", "dirty", "missing", "fresh"] as const).map(status => (
            <Button key={status} variant={view === status ? "default" : "outline"} size="sm" onClick={() => setView(status)} data-testid={`tab-data-${status}`}>
              {status[0].toUpperCase() + status.slice(1)}
            </Button>
          ))}
          <span className="ml-auto self-center text-sm text-muted-foreground">
            {selectedIds.length} selected ({selectedVisibleCount} visible)
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-card-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-3"><input type="checkbox" checked={allFilteredSelected} onChange={(e) => setSelectedIds(e.target.checked ? Array.from(new Set([...selectedIds, ...filteredIds])) : selectedIds.filter(id => !filteredIds.includes(id)))} /></th>
                <th className="px-4 py-3 font-medium">
                  <button type="button" onClick={() => toggleSort("name")} className="inline-flex items-center gap-1">
                    Name
                    {sortBy === "name" ? (sortDir === "asc" ? "▲" : "▼") : null}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Country</th>
                <th className="px-4 py-3 font-medium">Content</th>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Last refreshed</th>
                <th className="px-4 py-3 font-medium">
                  <button type="button" onClick={() => toggleSort("updatedAt")} className="inline-flex items-center gap-1">
                    Last updated
                    {sortBy === "updatedAt" ? (sortDir === "asc" ? "▲" : "▼") : null}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">
                  <button type="button" onClick={() => toggleSort("publishedAt")} className="inline-flex items-center gap-1">
                    Last published
                    {sortBy === "publishedAt" ? (sortDir === "asc" ? "▲" : "▼") : null}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="cursor-pointer border-t border-border hover-elevate" onClick={() => navigate(`/admin/spots/${s.id}`)} data-testid={`row-admin-spot-${s.slug}`}>
                  <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.includes(s.id)} onChange={(e) => setSelectedIds(prev => e.target.checked ? Array.from(new Set([...prev, s.id])) : prev.filter(id => id !== s.id))} />
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{countryNameForCode(s.country) || "—"}</td>
                  <td className="px-4 py-3"><StatusPill published={s.published} hasDraft={s.hasDraft} /></td>
                  <td className="px-4 py-3"><DataPill status={s.dataStatus as any} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{s.dataLastRefreshedAt ? new Date(s.dataLastRefreshedAt).toLocaleString() : <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Never</span>}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.publishedAt ? new Date(s.publishedAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No spots found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6 rounded-xl border border-border p-3 text-xs">
          <div className="mb-2 font-medium">Import history (spots)</div>
          <div className="space-y-1">
            {history.slice(0, 8).map(item => (
              <div key={item.id}>
                {item.created_at ? new Date(item.created_at).toLocaleString() : "—"} · {item.file_name} · {item.status} · created {item.created_count}, updated {item.updated_count}, skipped {item.skipped_count}, errors {item.error_count}
              </div>
            ))}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
