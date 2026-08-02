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
import { Plus, Search, Circle, CheckCircle2, PencilLine, BadgeInfo, ChevronDown, Download, SendHorizontal } from "lucide-react";
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
function toDataUrl(base64: string) { return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`; }
function downloadBase64(fileName: string, base64: string) {
  const link = document.createElement("a");
  link.href = toDataUrl(base64);
  link.download = fileName;
  link.click();
}
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export default function AdminSpots() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<"name" | "updatedAt">("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [preview, setPreview] = useState<ExcelImportPreviewResponse | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [history, setHistory] = useState<ExcelImportHistoryItem[]>([]);
  const { toast } = useToast();

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);
  const { data: spots, isLoading, refetch } = useQuery<AdminSpotListItem[]>({ queryKey: ["/api/admin/spots"], enabled: !!token });
  const filtered = useMemo(() => {
    const base = (spots ?? []).filter(s => s.name.toLowerCase().includes(q.toLowerCase()) || (s.country || "").toLowerCase().includes(q.toLowerCase()));
    return base.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") cmp = a.name.localeCompare(b.name);
      else cmp = (a.updatedAt || "").localeCompare(b.updatedAt || "");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [spots, q, sortBy, sortDir]);
  const filteredIds = filtered.map(s => s.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.includes(id));
  const filtersActive = q.trim().length > 0;

  const loadHistory = async () => setHistory(await api<ExcelImportHistoryItem[]>("GET", "/api/admin/excel/import/spots/history"));
  useEffect(() => { if (token) void loadHistory(); }, [token]);
  useEffect(() => {
    if (!token || preview) return;
    api<ExcelImportPreviewResponse>("GET", "/api/admin/excel/import/spots/preview-current")
      .then(setPreview)
      .catch(() => {});
  }, [token, preview]);

  const exportRows = async (scope: "selected" | "filtered" | "all" | "template") => {
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
    exportPrimaryScope === "selected" ? "Export selected"
      : exportPrimaryScope === "filtered" ? "Export filtered"
        : "Export all";

  const publishBulk = async (mode: "content" | "weather" | "content-weather") => {
    const targetIds = selectedIds.length ? selectedIds : filteredIds;
    if (!targetIds.length) {
      toast({ title: "No spots to publish", description: "Selection/filter returned no rows.", variant: "destructive" });
      return;
    }
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
    }
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

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Spots</h1>
          <p className="text-sm text-muted-foreground">{spots?.length ?? 0} total</p>
        </div>
        <Link href="/admin/spots/new"><Button className="gap-2" data-testid="button-new-spot"><Plus className="h-4 w-4" /> New spot</Button></Link>
      </div>

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
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => exportRows("template")}>Template</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="inline-flex">
            <Button size="sm" onClick={() => void publishBulk("content")} className="rounded-r-none">
              <SendHorizontal className="mr-2 h-4 w-4" />
              Publish content
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="rounded-l-none border-l-0 px-2">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => void publishBulk("content")}>Publish content</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void publishBulk("weather")}>Publish weather data</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void publishBulk("content-weather")}>Publish content + weather</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Input type="file" accept=".xlsx" className="max-w-xs" disabled={importBusy} onChange={e => void onUpload(e.target.files?.[0] ?? null)} />
        </div>
        {preview && (
          <div className="rounded border border-border p-3 text-sm">
            <div className="mb-2">Preview — New: {preview.summary.newCount}, Update: {preview.summary.updateCount}, Error ID not found: {preview.summary.errorIdNotFoundCount}, Error invalid data: {preview.summary.errorInvalidDataCount}</div>
            <div className="mb-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => downloadBase64(preview.files.updatesFileName, preview.files.updatesFileBase64)}>updates.xlsx</Button>
              <Button size="sm" variant="outline" onClick={() => downloadBase64(preview.files.errorsFileName, preview.files.errorsFileBase64)}>errors.xlsx</Button>
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
                  <button
                    type="button"
                    onClick={() => {
                      if (sortBy === "name") setSortDir(sortDir === "asc" ? "desc" : "asc");
                      else { setSortBy("name"); setSortDir("asc"); }
                    }}
                    className="inline-flex items-center gap-1"
                  >
                    Name
                    {sortBy === "name" ? (sortDir === "asc" ? "▲" : "▼") : null}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Country</th>
                <th className="px-4 py-3 text-center font-medium">Months</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      if (sortBy === "updatedAt") setSortDir(sortDir === "asc" ? "desc" : "asc");
                      else { setSortBy("updatedAt"); setSortDir("desc"); }
                    }}
                    className="inline-flex items-center gap-1"
                  >
                    Last updated
                    {sortBy === "updatedAt" ? (sortDir === "asc" ? "▲" : "▼") : null}
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
                  <td className="px-4 py-3 text-muted-foreground">{s.country || "—"}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">{s.monthlyCount}</td>
                  <td className="px-4 py-3"><StatusPill published={s.published} hasDraft={s.hasDraft} /></td>
                  <td className="px-4 py-3"><DataPill status={s.dataStatus as any} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No spots found.</td></tr>}
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
