import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Stay, ListingsPage, STAY_TYPES, ExcelImportAction, ExcelImportHistoryItem, ExcelImportPreviewResponse, AdminTableColumn, ColumnFilterValue, AdminFilterOption } from "@/lib/types";
import AdminDataTable from "@/components/admin/AdminDataTable";
import ImportButton from "@/components/admin/ImportButton";
import { Plus, Check, X, Globe, Map, Trash2, SendHorizontal, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCrossPageSelection } from "@/hooks/useCrossPageSelection";

type StayRow = Stay & { assignedSpotsCount: number };
const PER_PAGE_OPTIONS = [25, 50, 100];

const PUBLISHED_OPTIONS: AdminFilterOption[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
const MISSING_OPTIONS: AdminFilterOption[] = [{ value: "missing", label: "Missing" }];
const TYPE_OPTIONS: AdminFilterOption[] = STAY_TYPES.map((t) => ({ value: t, label: t }));

interface StaysTableState {
  q: string;
  published: string;
  type: string;
  missingWebsite: string;
  missingMap: string;
  updatedFrom: string;
  updatedTo: string;
  sortBy: "name" | "updatedAt";
  sortDir: "asc" | "desc";
  page: number;
  perPage: number;
}

function parseUrlState(search: string): StaysTableState {
  const p = new URLSearchParams(search);
  return {
    q: p.get("q") || "",
    published: p.get("published") || "",
    type: p.get("type") || "",
    missingWebsite: p.get("missingWebsite") || "",
    missingMap: p.get("missingMap") || "",
    updatedFrom: p.get("updatedFrom") || "",
    updatedTo: p.get("updatedTo") || "",
    sortBy: (p.get("sortBy") as "name" | "updatedAt") || "updatedAt",
    sortDir: (p.get("sortDir") as "asc" | "desc") || "desc",
    page: Number(p.get("page") || "1"),
    perPage: Number(p.get("perPage") || "50"),
  };
}

function downloadBase64(fileName: string, base64: string) {
  const link = document.createElement("a");
  link.href = `data:application/json;base64,${base64}`;
  link.download = fileName;
  link.click();
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export default function AdminListingsStays() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [location] = useLocation();
  const { toast } = useToast();

  const [state, setState] = useState<StaysTableState>(() => parseUrlState(window.location.search));
  const [data, setData] = useState<ListingsPage<StayRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [preview, setPreview] = useState<ExcelImportPreviewResponse | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [history, setHistory] = useState<ExcelImportHistoryItem[]>([]);
  const [busy, setBusy] = useState<null | string>(null);
  const running = busy !== null;

  useEffect(() => {
    if (!token) navigate("/admin");
  }, [token, navigate]);

  useEffect(() => {
    setState(parseUrlState(window.location.search));
  }, [location]);

  const pushState = (next: StaysTableState) => {
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.published) p.set("published", next.published);
    if (next.type) p.set("type", next.type);
    if (next.missingWebsite) p.set("missingWebsite", next.missingWebsite);
    if (next.missingMap) p.set("missingMap", next.missingMap);
    if (next.updatedFrom) p.set("updatedFrom", next.updatedFrom);
    if (next.updatedTo) p.set("updatedTo", next.updatedTo);
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
      published: state.published || undefined,
      type: state.type || undefined,
      website: state.missingWebsite || undefined,
      maps: state.missingMap || undefined,
      updatedAt: { from: state.updatedFrom || undefined, to: state.updatedTo || undefined },
    }),
    [state.q, state.published, state.type, state.missingWebsite, state.missingMap, state.updatedFrom, state.updatedTo],
  );

  const filtersActive = state.q.trim().length > 0 || !!state.published || !!state.type || !!state.missingWebsite || !!state.missingMap || !!state.updatedFrom || !!state.updatedTo;

  const fetchFilteredStayIds = async (): Promise<number[]> => {
    const p = new URLSearchParams();
    if (state.q) p.set("search", state.q);
    if (state.published) p.set("published", state.published);
    if (state.type) p.set("type", state.type);
    if (state.missingWebsite) p.set("missingWebsite", "true");
    if (state.missingMap) p.set("missingMap", "true");
    if (state.updatedFrom) p.set("updatedFrom", state.updatedFrom);
    if (state.updatedTo) p.set("updatedTo", state.updatedTo);
    const res = await api<{ ids: number[] }>("GET", `/api/admin/listings/stays/ids?${p.toString()}`);
    return res.ids;
  };

  const filterSignature = JSON.stringify({
    q: state.q, published: state.published, type: state.type, missingWebsite: state.missingWebsite,
    missingMap: state.missingMap, updatedFrom: state.updatedFrom, updatedTo: state.updatedTo,
  });
  const { allSelected, toggleSelectAll } = useCrossPageSelection({
    filterSignature,
    fetchFilteredIds: fetchFilteredStayIds,
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

  const publishBulk = async (scope: PublishScope) => {
    setBusy("publish");
    try {
      let published = 0;
      let requested = 0;
      if (scope === "all") {
        const out = await api<{ published: number; requested: number }>("POST", "/api/admin/listings/stays/publish-all", {});
        published = out.published;
        requested = out.requested;
      } else {
        const targetIds = scope === "selected" ? selectedIds : await fetchFilteredStayIds();
        if (!targetIds.length) {
          toast({ title: "No stays to publish", description: "Selection/filter returned no rows.", variant: "destructive" });
          return;
        }
        const out = await api<{ published: number; requested: number }>("POST", "/api/admin/listings/stays/publish-bulk", { stayIds: targetIds });
        published = out.published;
        requested = out.requested;
      }
      toast({ title: "Publish finished", description: `${published} of ${requested} stay(s) published` });
      pushState({ ...state });
    } catch (e: any) {
      toast({ title: "Bulk publish failed", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const loadHistory = async () => {
    setHistory(await api<ExcelImportHistoryItem[]>("GET", "/api/admin/excel/import/stays/history"));
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const p = new URLSearchParams();
    if (state.q) p.set("search", state.q);
    if (state.published) p.set("published", state.published);
    if (state.type) p.set("type", state.type);
    if (state.missingWebsite) p.set("missingWebsite", "true");
    if (state.missingMap) p.set("missingMap", "true");
    if (state.updatedFrom) p.set("updatedFrom", state.updatedFrom);
    if (state.updatedTo) p.set("updatedTo", state.updatedTo);
    p.set("sortBy", state.sortBy);
    p.set("sortDir", state.sortDir);
    p.set("page", String(state.page));
    p.set("perPage", String(state.perPage));
    api<ListingsPage<StayRow>>("GET", `/api/admin/listings/stays?${p.toString()}`)
      .then(setData)
      .catch(() => toast({ title: "Failed to load", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [state, token, toast]);

  useEffect(() => {
    if (!token) return;
    void loadHistory();
  }, [token, toast]);
  useEffect(() => {
    if (!token || preview) return;
    api<ExcelImportPreviewResponse>("GET", "/api/admin/excel/import/stays/preview-current")
      .then(setPreview)
      .catch(() => {});
  }, [token, preview]);

  const createStay = async () => {
    if (!newName.trim()) return;
    await api("POST", "/api/admin/listings/stays", { name: newName.trim() });
    setNewName("");
    setShowCreate(false);
    pushState({ ...state });
  };

  const exportRows = async (scope: "selected" | "filtered" | "all") => {
    const out = await api<{ fileName: string; fileBase64: string }>("POST", "/api/admin/excel/export/stays", {
      scope,
      selectedIds,
      filters: {
        search: state.q || undefined,
        published: state.published || undefined,
        missingWebsite: state.missingWebsite ? true : undefined,
        missingMap: state.missingMap ? true : undefined,
        type: state.type || undefined,
        sortBy: state.sortBy,
        sortDir: state.sortDir,
      },
    });
    downloadBase64(out.fileName, out.fileBase64);
  };

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setImportBusy(true);
    try {
      const fileBase64 = toBase64(new Uint8Array(await file.arrayBuffer()));
      setPreview(await api<ExcelImportPreviewResponse>("POST", "/api/admin/excel/import/stays/preview", { fileName: file.name, fileBase64 }));
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
      await api("POST", "/api/admin/excel/import/stays/commit", { previewId: preview.previewId, action });
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
    await api("POST", "/api/admin/excel/import/stays/cancel", { previewId: preview.previewId });
    setPreview(null);
    await loadHistory();
  };

  const deleteStay = async (id: number, name: string) => {
    if (!window.confirm(`Move "${name}" to Trash? It will be permanently deleted after 30 days.`)) return;
    try {
      await api("DELETE", `/api/admin/listings/stays/${id}`);
      toast({ title: "Stay moved to Trash" });
      pushState({ ...state });
    } catch (e: any) {
      toast({ title: "Delete failed", description: String(e.message || e), variant: "destructive" });
    }
  };

  const onSortChange = (key: string) => {
    const k = key as "name" | "updatedAt";
    if (state.sortBy === k) {
      pushState({ ...state, sortDir: state.sortDir === "asc" ? "desc" : "asc", page: 1 });
    } else {
      pushState({ ...state, sortBy: k, sortDir: k === "name" ? "asc" : "desc", page: 1 });
    }
  };

  const onFilterChange = (key: string, value: ColumnFilterValue) => {
    const next: StaysTableState = { ...state, page: 1 };
    switch (key) {
      case "name":
        next.q = typeof value === "string" ? value : "";
        break;
      case "published":
        next.published = typeof value === "string" ? value : "";
        break;
      case "type":
        next.type = typeof value === "string" ? value : "";
        break;
      case "website":
        next.missingWebsite = typeof value === "string" ? value : "";
        break;
      case "maps":
        next.missingMap = typeof value === "string" ? value : "";
        break;
      case "updatedAt": {
        const r = (value && typeof value === "object" ? value : {}) as { from?: string; to?: string };
        next.updatedFrom = r.from ?? "";
        next.updatedTo = r.to ?? "";
        break;
      }
    }
    pushState(next);
  };

  const columns: AdminTableColumn<StayRow>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      filterable: true,
      filterType: "text",
      renderCell: (s) => <span className="font-medium text-foreground">{s.name}</span>,
    },
    {
      key: "published",
      header: "Published",
      filterable: true,
      filterType: "select",
      filterOptions: PUBLISHED_OPTIONS,
      renderCell: (s) => (s.published ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-muted-foreground" />),
    },
    {
      key: "spots",
      header: "Spots",
      renderCell: (s) => <span className="text-muted-foreground">{s.assignedSpotsCount}</span>,
    },
    {
      key: "type",
      header: "Type",
      filterable: true,
      filterType: "select",
      filterOptions: TYPE_OPTIONS,
      renderCell: (s) => <span className="text-muted-foreground">{s.type || "—"}</span>,
    },
    {
      key: "website",
      header: "Website",
      filterable: true,
      filterType: "select",
      filterOptions: MISSING_OPTIONS,
      renderCell: (s) => (s.websiteUrl ? <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer"><Globe className="h-4 w-4 text-sky-600" /></a> : <X className="h-4 w-4 text-muted-foreground" />),
    },
    {
      key: "maps",
      header: "Maps",
      filterable: true,
      filterType: "select",
      filterOptions: MISSING_OPTIONS,
      renderCell: (s) => (s.mapUrl ? <a href={s.mapUrl} target="_blank" rel="noopener noreferrer"><Map className="h-4 w-4 text-sky-600" /></a> : <X className="h-4 w-4 text-muted-foreground" />),
    },
    {
      key: "updatedAt",
      header: "Last updated",
      sortable: true,
      filterable: true,
      filterType: "dateRange",
      renderCell: (s) => <span className="text-xs text-muted-foreground">{s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : "—"}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      renderCell: (s) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => void deleteStay(s.id, s.name)} title="Move to Trash" className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Stays</h1>
          {data && <p className="text-sm text-muted-foreground">{data.total} stay{data.total !== 1 ? "s" : ""}</p>}
        </div>
        <Button onClick={() => setShowCreate((v) => !v)} className="gap-2">
          <Plus className="h-4 w-4" /> New stay
        </Button>
      </div>

      {showCreate && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card p-4">
          <Input
            placeholder="Stay name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void createStay(); }}
            className="flex-1"
            autoFocus
          />
          <Button onClick={() => void createStay()} disabled={!newName.trim()}>Create</Button>
          <Button variant="ghost" onClick={() => { setShowCreate(false); setNewName(""); }}>Cancel</Button>
        </div>
      )}

      <AdminDataTable
        columns={columns}
        rows={data?.items ?? []}
        total={data?.total ?? 0}
        page={state.page}
        perPage={state.perPage}
        perPageOptions={PER_PAGE_OPTIONS}
        sortBy={state.sortBy}
        sortDir={state.sortDir}
        filters={filters}
        selectedIds={selectedIds}
        loading={loading}
        emptyMessage="No stays found."
        toolbar={
          <div>
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex">
                <Button size="sm" disabled={running} onClick={() => void publishBulk(publishPrimaryScope)} className="rounded-r-none">
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
                    <DropdownMenuItem onClick={() => void publishBulk(publishPrimaryScope)}>Publish content</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button size="sm" variant="outline" disabled={!selectedIds.length} onClick={() => void exportRows("selected")}>Export selected</Button>
              <Button size="sm" variant="outline" onClick={() => void exportRows("filtered")}>Export filtered</Button>
              <Button size="sm" variant="outline" onClick={() => void exportRows("all")}>Export all</Button>
              <ImportButton accept=".json" disabled={importBusy} onFile={(f) => void onUpload(f)} />
            </div>
            {preview && (
              <div className="mt-3 rounded border p-3 text-sm">
                New {preview.summary.newCount} · Update {preview.summary.updateCount} · Error ID not found {preview.summary.errorIdNotFoundCount} · Error invalid data {preview.summary.errorInvalidDataCount}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => downloadBase64(preview.files.updatesFileName, preview.files.updatesFileBase64)}>{preview.files.updatesFileName}</Button>
                  <Button size="sm" variant="outline" onClick={() => downloadBase64(preview.files.errorsFileName, preview.files.errorsFileBase64)}>{preview.files.errorsFileName}</Button>
                  <Button size="sm" onClick={() => void commitImport("create_update")}>Create new & update existing</Button>
                  <Button size="sm" variant="outline" onClick={() => void commitImport("create_only")}>Create new only</Button>
                  <Button size="sm" variant="ghost" onClick={() => void cancelImport()}>Cancel import</Button>
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
      />

      {history.length > 0 && (
        <div className="mt-6 rounded-xl border p-3 text-xs">
          <div className="mb-2 font-medium">Import history (stays)</div>
          {history.slice(0, 8).map((item) => (
            <div key={item.id}>
              {item.created_at ? new Date(item.created_at).toLocaleString() : "—"} · {item.file_name} · {item.status} · created {item.created_count}, updated {item.updated_count}, skipped {item.skipped_count}, errors {item.error_count}
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
