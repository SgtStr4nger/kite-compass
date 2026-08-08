import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import AdminDataTable from "@/components/admin/AdminDataTable";
import {
  School,
  ListingsPage,
  SCHOOL_SPORTS,
  ExcelImportAction,
  ExcelImportHistoryItem,
  ExcelImportPreviewResponse,
  AdminTableColumn,
  ColumnFilterValue,
  AdminFilterOption,
} from "@/lib/types";
import { Plus, Check, X, Globe, Map, Trash2 } from "lucide-react";

type SchoolRow = School & { assignedSpotsCount: number };
const PER_PAGE_OPTIONS = [25, 50, 100];

const PUBLISHED_OPTIONS: AdminFilterOption[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
const BOOLEAN_OPTIONS: AdminFilterOption[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
const MISSING_OPTIONS: AdminFilterOption[] = [{ value: "missing", label: "Missing" }];
const SPORTS_OPTIONS: AdminFilterOption[] = SCHOOL_SPORTS.map((s) => ({ value: s, label: s }));

interface SchoolsTableState {
  q: string;
  published: string;
  offersLessons: string;
  offersRental: string;
  sports: string[];
  missingWebsite: string;
  missingMap: string;
  updatedFrom: string;
  updatedTo: string;
  sortBy: "name" | "updatedAt";
  sortDir: "asc" | "desc";
  page: number;
  perPage: number;
}

function parseUrlState(search: string): SchoolsTableState {
  const p = new URLSearchParams(search);
  return {
    q: p.get("q") || "",
    published: p.get("published") || "",
    offersLessons: p.get("offersLessons") || "",
    offersRental: p.get("offersRental") || "",
    sports: p.getAll("sports"),
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

export default function AdminListingsSchools() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [location] = useLocation();
  const { toast } = useToast();

  const [state, setState] = useState<SchoolsTableState>(() => parseUrlState(window.location.search));
  const [data, setData] = useState<ListingsPage<SchoolRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [preview, setPreview] = useState<ExcelImportPreviewResponse | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [history, setHistory] = useState<ExcelImportHistoryItem[]>([]);

  useEffect(() => {
    if (!token) navigate("/admin");
  }, [token, navigate]);

  useEffect(() => {
    setState(parseUrlState(window.location.search));
  }, [location]);

  const pushState = (next: SchoolsTableState) => {
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.published) p.set("published", next.published);
    if (next.offersLessons) p.set("offersLessons", next.offersLessons);
    if (next.offersRental) p.set("offersRental", next.offersRental);
    next.sports.forEach((s) => p.append("sports", s));
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
      sports: state.sports,
      lessons: state.offersLessons || undefined,
      rental: state.offersRental || undefined,
      website: state.missingWebsite || undefined,
      maps: state.missingMap || undefined,
      updatedAt: { from: state.updatedFrom || undefined, to: state.updatedTo || undefined },
    }),
    [state.q, state.published, state.sports, state.offersLessons, state.offersRental, state.missingWebsite, state.missingMap, state.updatedFrom, state.updatedTo],
  );

  const loadHistory = async () => {
    setHistory(await api<ExcelImportHistoryItem[]>("GET", "/api/admin/excel/import/schools/history"));
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const p = new URLSearchParams();
    if (state.q) p.set("search", state.q);
    if (state.published) p.set("published", state.published);
    if (state.missingWebsite) p.set("missingWebsite", "true");
    if (state.missingMap) p.set("missingMap", "true");
    if (state.offersLessons) p.set("offersLessons", state.offersLessons);
    if (state.offersRental) p.set("offersRental", state.offersRental);
    state.sports.forEach((s) => p.append("sports", s));
    if (state.updatedFrom) p.set("updatedFrom", state.updatedFrom);
    if (state.updatedTo) p.set("updatedTo", state.updatedTo);
    p.set("sortBy", state.sortBy);
    p.set("sortDir", state.sortDir);
    p.set("page", String(state.page));
    p.set("perPage", String(state.perPage));
    api<ListingsPage<SchoolRow>>("GET", `/api/admin/listings/schools?${p.toString()}`)
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
    api<ExcelImportPreviewResponse>("GET", "/api/admin/excel/import/schools/preview-current")
      .then(setPreview)
      .catch(() => {});
  }, [token, preview]);

  useEffect(() => {
    const existingIds = new Set((data?.items ?? []).map((i) => i.id));
    setSelectedIds((prev) => prev.filter((id) => existingIds.has(id)));
  }, [data?.items]);

  const createSchool = async () => {
    if (!newName.trim()) return;
    await api("POST", "/api/admin/listings/schools", { name: newName.trim() });
    setNewName("");
    setShowCreate(false);
    pushState({ ...state });
    toast({ title: "School created" });
  };

  const publishSchool = async (id: number) => {
    await api("POST", `/api/admin/listings/schools/${id}/publish`);
    pushState({ ...state });
    toast({ title: "Published" });
  };

  const exportRows = async (scope: "selected" | "filtered" | "all") => {
    const filtersPayload = {
      search: state.q || undefined,
      published: state.published || undefined,
      missingWebsite: state.missingWebsite ? true : undefined,
      missingMap: state.missingMap ? true : undefined,
      offersLessons: state.offersLessons || undefined,
      offersRental: state.offersRental || undefined,
      sports: state.sports,
      sortBy: state.sortBy,
      sortDir: state.sortDir,
    };
    const out = await api<{ fileName: string; fileBase64: string }>("POST", "/api/admin/excel/export/schools", {
      scope,
      selectedIds,
      filters: filtersPayload,
    });
    downloadBase64(out.fileName, out.fileBase64);
  };

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setImportBusy(true);
    try {
      const fileBase64 = toBase64(new Uint8Array(await file.arrayBuffer()));
      setPreview(await api<ExcelImportPreviewResponse>("POST", "/api/admin/excel/import/schools/preview", { fileName: file.name, fileBase64 }));
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
      await api("POST", "/api/admin/excel/import/schools/commit", { previewId: preview.previewId, action });
      setPreview(null);
      await Promise.all([loadHistory(), api<ListingsPage<SchoolRow>>("GET", "/api/admin/listings/schools").then(setData)]);
      toast({ title: "Import completed" });
    } catch (e: any) {
      toast({ title: "Import failed", description: String(e.message || e), variant: "destructive" });
    } finally {
      setImportBusy(false);
    }
  };

  const cancelImport = async () => {
    if (!preview) return;
    await api("POST", "/api/admin/excel/import/schools/cancel", { previewId: preview.previewId });
    setPreview(null);
    await loadHistory();
  };

  const deleteSchool = async (id: number, name: string) => {
    if (!window.confirm(`Move "${name}" to Trash? It will be permanently deleted after 30 days.`)) return;
    try {
      await api("DELETE", `/api/admin/listings/schools/${id}`);
      toast({ title: "School moved to Trash" });
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
    const next: SchoolsTableState = { ...state, page: 1 };
    switch (key) {
      case "name":
        next.q = typeof value === "string" ? value : "";
        break;
      case "published":
        next.published = typeof value === "string" ? value : "";
        break;
      case "sports":
        next.sports = Array.isArray(value) ? value as string[] : [];
        break;
      case "lessons":
        next.offersLessons = typeof value === "string" ? value : "";
        break;
      case "rental":
        next.offersRental = typeof value === "string" ? value : "";
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

  const columns: AdminTableColumn<SchoolRow>[] = [
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
      key: "sports",
      header: "Sports",
      filterable: true,
      filterType: "multiselect",
      filterOptions: SPORTS_OPTIONS,
      renderCell: (s) => <span className="text-xs text-muted-foreground">{(Array.isArray(s.sports) ? s.sports : []).join(", ") || "—"}</span>,
    },
    {
      key: "lessons",
      header: "Lessons",
      filterable: true,
      filterType: "select",
      filterOptions: BOOLEAN_OPTIONS,
      renderCell: (s) => (s.offersLessons ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-muted-foreground" />),
    },
    {
      key: "rental",
      header: "Rental",
      filterable: true,
      filterType: "select",
      filterOptions: BOOLEAN_OPTIONS,
      renderCell: (s) => (s.offersRental ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-muted-foreground" />),
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
          {!s.published && <Button size="sm" variant="outline" onClick={() => void publishSchool(s.id)}>Publish</Button>}
          <Button size="sm" variant="ghost" onClick={() => void deleteSchool(s.id, s.name)} title="Move to Trash" className="text-muted-foreground hover:text-destructive">
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
          <h1 className="font-serif text-2xl font-semibold text-foreground">Kite Schools</h1>
          {data && <p className="text-sm text-muted-foreground">{data.total} school{data.total !== 1 ? "s" : ""}</p>}
        </div>
        <Button onClick={() => setShowCreate((v) => !v)} className="gap-2">
          <Plus className="h-4 w-4" /> New school
        </Button>
      </div>

      {showCreate && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card p-4">
          <Input
            placeholder="School name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createSchool();
            }}
            className="flex-1"
            autoFocus
          />
          <Button onClick={() => void createSchool()} disabled={!newName.trim()}>Create</Button>
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
        emptyMessage="No schools found."
        toolbar={
          <div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!selectedIds.length} onClick={() => void exportRows("selected")}>Export selected</Button>
              <Button size="sm" variant="outline" onClick={() => void exportRows("filtered")}>Export filtered</Button>
              <Button size="sm" variant="outline" onClick={() => void exportRows("all")}>Export all</Button>
              <Input type="file" accept=".json" className="max-w-xs" disabled={importBusy} onChange={(e) => void onUpload(e.target.files?.[0] ?? null)} />
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
        onSelectAll={(ids) =>
          setSelectedIds((prev) => {
            const numeric = ids.map((id) => (typeof id === "number" ? id : Number(id)));
            const next = new Set(prev);
            for (const n of numeric) next.add(n);
            return Array.from(next);
          })
        }
      />

      {history.length > 0 && (
        <div className="mt-6 rounded-xl border p-3 text-xs">
          <div className="mb-2 font-medium">Import history (schools)</div>
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
