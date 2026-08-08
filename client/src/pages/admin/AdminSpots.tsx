import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import AdminDataTable from "@/components/admin/AdminDataTable";
import ImportButton from "@/components/admin/ImportButton";
import {
  AdminSpotListItem,
  ExcelImportAction,
  ExcelImportHistoryItem,
  ExcelImportPreviewResponse,
  ListingsPage,
  AdminTableColumn,
  ColumnFilterValue,
  AdminFilterOption,
} from "@/lib/types";
import { countryNameForCode, ISO2_TO_COUNTRY } from "@shared/locations";
import { Plus, CheckCircle2, PencilLine, Circle, BadgeInfo, ChevronDown, Download, SendHorizontal, RefreshCw, ArrowRight, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useCrossPageSelection } from "@/hooks/useCrossPageSelection";

function StatusPill({ published, hasDraft }: { published: boolean; hasDraft: boolean }) {
  if (published && !hasDraft) return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Published</span>;
  if (published && hasDraft) return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><PencilLine className="h-3.5 w-3.5" /> Draft edits</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-500"><Circle className="h-3.5 w-3.5" /> Draft only</span>;
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

type SortKey = "name" | "updatedAt" | "lastPublishedAt";

interface SpotsTableState {
  q: string;
  countries: string[];
  contentStatus: string;
  dataStatus: string;
  updatedFrom: string;
  updatedTo: string;
  publishedFrom: string;
  publishedTo: string;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  page: number;
  perPage: number;
}

function parseUrlState(search: string): SpotsTableState {
  const p = new URLSearchParams(search);
  return {
    q: p.get("q") || "",
    countries: p.getAll("countries"),
    contentStatus: p.get("contentStatus") || "",
    dataStatus: p.get("dataStatus") || "",
    updatedFrom: p.get("updatedFrom") || "",
    updatedTo: p.get("updatedTo") || "",
    publishedFrom: p.get("publishedFrom") || "",
    publishedTo: p.get("publishedTo") || "",
    sortBy: (p.get("sortBy") as SortKey) || "updatedAt",
    sortDir: (p.get("sortDir") as "asc" | "desc") || "desc",
    page: Number(p.get("page") || "1"),
    perPage: Number(p.get("perPage") || "50"),
  };
}

const COUNTRY_OPTIONS: AdminFilterOption[] = Object.entries(ISO2_TO_COUNTRY)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

export default function AdminSpots() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [location] = useLocation();
  const { toast } = useToast();

  const [state, setState] = useState<SpotsTableState>(() => parseUrlState(window.location.search));
  const [data, setData] = useState<ListingsPage<AdminSpotListItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [preview, setPreview] = useState<ExcelImportPreviewResponse | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [history, setHistory] = useState<ExcelImportHistoryItem[]>([]);
  const [busy, setBusy] = useState<null | string | number>(null);

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);
  useEffect(() => { setState(parseUrlState(window.location.search)); }, [location]);

  const { data: usage } = useQuery<{ archiveRequests: number; marineRequests: number; failedRequests: number; totalRequests: number }>({
    queryKey: ["/api/admin/usage/open-meteo"], enabled: !!token,
  });

  const pushState = (next: SpotsTableState) => {
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    next.countries.forEach((c) => p.append("countries", c));
    if (next.contentStatus) p.set("contentStatus", next.contentStatus);
    if (next.dataStatus) p.set("dataStatus", next.dataStatus);
    if (next.updatedFrom) p.set("updatedFrom", next.updatedFrom);
    if (next.updatedTo) p.set("updatedTo", next.updatedTo);
    if (next.publishedFrom) p.set("publishedFrom", next.publishedFrom);
    if (next.publishedTo) p.set("publishedTo", next.publishedTo);
    p.set("sortBy", next.sortBy);
    p.set("sortDir", next.sortDir);
    p.set("page", String(next.page));
    p.set("perPage", String(next.perPage));
    window.history.replaceState({}, "", `${window.location.pathname}?${p.toString()}`);
    setState(next);
  };

  const filters = useMemo(
    () => ({
      name: state.q || undefined,
      country: state.countries,
      content: state.contentStatus || undefined,
      data: state.dataStatus || undefined,
      updatedAt: { from: state.updatedFrom || undefined, to: state.updatedTo || undefined },
      publishedAt: { from: state.publishedFrom || undefined, to: state.publishedTo || undefined },
    }),
    [state.q, state.countries, state.contentStatus, state.dataStatus, state.updatedFrom, state.updatedTo, state.publishedFrom, state.publishedTo],
  );

  const filtersActive = state.q.length > 0 || state.countries.length > 0 || !!state.contentStatus || !!state.dataStatus || !!state.updatedFrom || !!state.updatedTo || !!state.publishedFrom || !!state.publishedTo;

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const p = new URLSearchParams();
    if (state.q) p.set("search", state.q);
    state.countries.forEach((c) => p.append("countries", c));
    if (state.contentStatus) p.set("contentStatus", state.contentStatus);
    if (state.dataStatus) p.set("dataStatus", state.dataStatus);
    if (state.updatedFrom) p.set("updatedFrom", state.updatedFrom);
    if (state.updatedTo) p.set("updatedTo", state.updatedTo);
    if (state.publishedFrom) p.set("publishedFrom", state.publishedFrom);
    if (state.publishedTo) p.set("publishedTo", state.publishedTo);
    p.set("sortBy", state.sortBy);
    p.set("sortDir", state.sortDir);
    p.set("page", String(state.page));
    p.set("perPage", String(state.perPage));
    api<ListingsPage<AdminSpotListItem>>("GET", `/api/admin/listings/spots?${p.toString()}`)
      .then(setData)
      .catch(() => toast({ title: "Failed to load", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [state, token, toast]);

  const loadHistory = async () => setHistory(await api<ExcelImportHistoryItem[]>("GET", "/api/admin/excel/import/spots/history"));
  useEffect(() => { if (token) void loadHistory(); }, [token]);
  useEffect(() => {
    if (!token || preview) return;
    api<ExcelImportPreviewResponse>("GET", "/api/admin/excel/import/spots/preview-current")
      .then(setPreview)
      .catch(() => {});
  }, [token, preview]);

  const filteredIds = (data?.items ?? []).map((s) => s.id);

  const exportRows = async (scope: "selected" | "filtered" | "all") => {
    try {
      const out = await api<{ fileName: string; fileBase64: string }>("POST", "/api/admin/excel/export/spots", {
        scope,
        selectedIds,
        filters: {
          search: state.q || undefined,
          countries: state.countries,
          contentStatus: state.contentStatus || undefined,
          dataStatus: state.dataStatus || undefined,
          updatedFrom: state.updatedFrom || undefined,
          updatedTo: state.updatedTo || undefined,
          publishedFrom: state.publishedFrom || undefined,
          publishedTo: state.publishedTo || undefined,
          sortBy: state.sortBy,
          sortDir: state.sortDir,
        },
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

  const fetchFilteredSpotIds = async (): Promise<number[]> => {
    const p = new URLSearchParams();
    if (state.q) p.set("search", state.q);
    state.countries.forEach((c) => p.append("countries", c));
    if (state.contentStatus) p.set("contentStatus", state.contentStatus);
    if (state.dataStatus) p.set("dataStatus", state.dataStatus);
    if (state.updatedFrom) p.set("updatedFrom", state.updatedFrom);
    if (state.updatedTo) p.set("updatedTo", state.updatedTo);
    if (state.publishedFrom) p.set("publishedFrom", state.publishedFrom);
    if (state.publishedTo) p.set("publishedTo", state.publishedTo);
    const res = await api<{ ids: number[] }>("GET", `/api/admin/listings/spots/ids?${p.toString()}`);
    return res.ids;
  };

  const filterSignature = JSON.stringify({
    q: state.q, countries: state.countries, contentStatus: state.contentStatus, dataStatus: state.dataStatus,
    updatedFrom: state.updatedFrom, updatedTo: state.updatedTo, publishedFrom: state.publishedFrom, publishedTo: state.publishedTo,
  });
  const { allSelected, toggleSelectAll } = useCrossPageSelection({
    filterSignature,
    fetchFilteredIds: fetchFilteredSpotIds,
    selectedIds,
    setSelectedIds,
    onError: (message) => toast({ title: message, variant: "destructive" }),
  });

  type PublishScope = "selected" | "filtered" | "all";
  const publishPrimaryScope: PublishScope = selectedIds.length > 0 ? "selected" : (filtersActive ? "filtered" : "all");
  const publishPrimaryLabel =
    publishPrimaryScope === "selected" ? `Publish selected (${selectedIds.length})`
      : publishPrimaryScope === "filtered" ? "Publish filtered"
        : "Publish all";

  const publishBulk = async (mode: "content" | "weather" | "content-weather", scope: PublishScope) => {
    setBusy("publish");
    try {
      const out = await api<{ targetSpots: number; contentPublished: number; weatherPublished: number; recalculatedRows: number }>(
        "POST",
        scope === "all" ? "/api/admin/spots/publish-all" : "/api/admin/spots/publish-bulk",
        scope === "all" ? {} : { mode, spotIds: scope === "selected" ? selectedIds : await fetchFilteredSpotIds() },
      );
      const modeLabel = mode === "content" ? "Content" : mode === "weather" ? "Weather" : "Content + weather";
      toast({
        title: `${modeLabel} publish finished`,
        description: `${out.targetSpots} spots, ${out.contentPublished} content updates, ${out.weatherPublished} weather rows, ${out.recalculatedRows} score rows recalculated`,
      });
      pushState({ ...state });
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
      pushState({ ...state });
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
      pushState({ ...state });
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
      pushState({ ...state });
    } catch (e: any) {
      toast({ title: "Score recalculation failed", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const onSortChange = (key: string) => {
    const k = key as SortKey;
    if (state.sortBy === k) {
      pushState({ ...state, sortDir: state.sortDir === "asc" ? "desc" : "asc", page: 1 });
    } else {
      pushState({ ...state, sortBy: k, sortDir: k === "name" ? "asc" : "desc", page: 1 });
    }
  };

  const onFilterChange = (key: string, value: ColumnFilterValue) => {
    const next: SpotsTableState = { ...state, page: 1 };
    switch (key) {
      case "name":
        next.q = typeof value === "string" ? value : "";
        break;
      case "country":
        next.countries = Array.isArray(value) ? value as string[] : [];
        break;
      case "content":
        next.contentStatus = typeof value === "string" ? value : "";
        break;
      case "data":
        next.dataStatus = typeof value === "string" ? value : "";
        break;
      case "updatedAt": {
        const r = (value && typeof value === "object" ? value : {}) as { from?: string; to?: string };
        next.updatedFrom = r.from ?? "";
        next.updatedTo = r.to ?? "";
        break;
      }
      case "publishedAt": {
        const r = (value && typeof value === "object" ? value : {}) as { from?: string; to?: string };
        next.publishedFrom = r.from ?? "";
        next.publishedTo = r.to ?? "";
        break;
      }
    }
    pushState(next);
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
      await loadHistory();
      pushState({ ...state });
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

  const columns: AdminTableColumn<AdminSpotListItem>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      filterable: true,
      filterType: "text",
      renderCell: (s) => <span className="font-medium text-foreground">{s.name}</span>,
    },
    {
      key: "country",
      header: "Country",
      sortable: true,
      filterable: true,
      filterType: "multiselect",
      filterOptions: COUNTRY_OPTIONS,
      renderCell: (s) => <span className="text-muted-foreground">{countryNameForCode(s.country) || "—"}</span>,
    },
    {
      key: "content",
      header: "Content",
      filterable: true,
      filterType: "select",
      filterOptions: [
        { value: "published", label: "Published" },
        { value: "published-draft", label: "Draft edits" },
        { value: "unpublished", label: "Draft only" },
      ],
      renderCell: (s) => <StatusPill published={s.published} hasDraft={s.hasDraft} />,
    },
    {
      key: "data",
      header: "Data",
      filterable: true,
      filterType: "select",
      filterOptions: [
        { value: "fresh", label: "Fresh" },
        { value: "dirty", label: "Dirty" },
        { value: "missing", label: "Missing" },
      ],
      renderCell: (s) => <DataPill status={s.dataStatus} />,
    },
    {
      key: "updatedAt",
      header: "Last updated",
      sortable: true,
      filterable: true,
      filterType: "dateRange",
      renderCell: (s) => <span className="text-xs text-muted-foreground">{s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—"}</span>,
    },
    {
      key: "lastPublishedAt",
      header: "Last published",
      sortable: true,
      filterable: true,
      filterType: "dateRange",
      renderCell: (s) => <span className="text-xs text-muted-foreground">{s.publishedAt ? new Date(s.publishedAt).toLocaleString() : "—"}</span>,
    },
  ];

  return (
    <AdminLayout>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Spots</h1>
          <p className="text-sm text-muted-foreground">{data?.total ?? 0} total</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/admin/scoring")} data-testid="button-configure-scoring">
            <ArrowRight className="mr-2 h-4 w-4" />
            Configure scoring
          </Button>
          <Link href="/admin/spots/new"><Button className="gap-2" data-testid="button-new-spot"><Plus className="h-4 w-4" /> New spot</Button></Link>
        </div>
      </div>

      <AdminDataTable
        columns={columns}
        rows={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        perPage={state.perPage}
        sortBy={state.sortBy}
        sortDir={state.sortDir}
        filters={filters}
        selectedIds={selectedIds}
        loading={loading}
        emptyMessage="No spots found."
        toolbar={
          <div>
            {usage && (
              <div className="mb-3 rounded-xl border border-card-border bg-background p-3 text-sm text-muted-foreground">
                Open-Meteo requests this server process: {usage.totalRequests} total, {usage.archiveRequests} archive, {usage.marineRequests} marine, {usage.failedRequests} failed.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
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
                <Button size="sm" disabled={running} onClick={() => void publishBulk("content-weather", publishPrimaryScope)} className="rounded-r-none">
                  <SendHorizontal className="mr-2 h-4 w-4" />
                  {publishPrimaryLabel}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" disabled={running} className="rounded-l-none border-l-0 px-2">
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => void publishBulk("content", publishPrimaryScope)}>Publish content</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void publishBulk("weather", publishPrimaryScope)}>Publish weather data</DropdownMenuItem>
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
                    <DropdownMenuItem onClick={() => refreshScope("filtered", filteredIds)} disabled={!filteredIds.length}>Refresh filtered weather ({filteredIds.length})</DropdownMenuItem>
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
                    <DropdownMenuItem onClick={() => recalculateScores(selectedIds.length ? selectedIds : filteredIds)} disabled={!filteredIds.length}>Recalculate scores for scope</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => recalculateScores([])}>Recalculate scores for all spots</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <ImportButton accept=".json,application/json" disabled={importBusy} onFile={(f) => void onUpload(f)} />
            </div>
            {preview && (
              <div className="mt-3 rounded border border-border p-3 text-sm">
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
        }
        onSortChange={onSortChange}
        onFilterChange={onFilterChange}
        onPageChange={(page) => pushState({ ...state, page })}
        onPerPageChange={(perPage) => pushState({ ...state, perPage, page: 1 })}
        onSelect={(id, checked) =>
          setSelectedIds((prev) => {
            const n = typeof id === "number" ? id : Number(id);
            return checked ? (prev.includes(n) ? prev : [...prev, n]) : prev.filter((x) => x !== n);
          })
        }
        allSelected={allSelected}
        onSelectAllToggle={(checked) => void toggleSelectAll(checked)}
        onRowClick={(s) => navigate(`/admin/spots/${s.id}`)}
      />

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
