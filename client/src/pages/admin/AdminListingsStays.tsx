import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Stay, ListingsPage, STAY_TYPES, AdminSpotListItem, ExcelImportAction, ExcelImportHistoryItem, ExcelImportPreviewResponse } from "@/lib/types";
import { Plus, ChevronUp, ChevronDown, Check, X, Globe, Map } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type StayRow = Stay & { assignedSpotsCount: number };
const PER_PAGE_OPTIONS = [25, 50, 100];

function parseUrlState(search: string) {
  const p = new URLSearchParams(search);
  return {
    q: p.get("q") || "",
    published: p.get("published") || "",
    spotId: p.get("spotId") || "",
    missingWebsite: p.get("missingWebsite") === "true",
    missingMap: p.get("missingMap") === "true",
    type: p.get("type") || "",
    sortBy: p.get("sortBy") || "updatedAt",
    sortDir: p.get("sortDir") || "desc",
    page: Number(p.get("page") || "1"),
    perPage: Number(p.get("perPage") || "50"),
  };
}

function downloadBase64(fileName: string, base64: string) {
  const link = document.createElement("a");
  link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
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
  const { toast } = useToast();
  const [location] = useLocation();
  const [state, setState] = useState(() => parseUrlState(window.location.search));
  const [data, setData] = useState<ListingsPage<StayRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [spots, setSpots] = useState<AdminSpotListItem[]>([]);
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

  const pushState = (next: typeof state) => {
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.published) p.set("published", next.published);
    if (next.spotId) p.set("spotId", next.spotId);
    if (next.missingWebsite) p.set("missingWebsite", "true");
    if (next.missingMap) p.set("missingMap", "true");
    if (next.type) p.set("type", next.type);
    p.set("sortBy", next.sortBy);
    p.set("sortDir", next.sortDir);
    p.set("page", String(next.page));
    p.set("perPage", String(next.perPage));
    window.history.replaceState({}, "", `${window.location.pathname}?${p.toString()}`);
    setState(next);
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
    if (state.spotId) p.set("spotId", state.spotId);
    if (state.missingWebsite) p.set("missingWebsite", "true");
    if (state.missingMap) p.set("missingMap", "true");
    if (state.type) p.set("type", state.type);
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
    api<AdminSpotListItem[]>("GET", "/api/admin/spots")
      .then(setSpots)
      .catch(() => toast({ title: "Failed to load spots", variant: "destructive" }));
    void loadHistory();
  }, [token, toast]);

  const visibleIds = useMemo(() => data?.items.map((i) => i.id) ?? [], [data?.items]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const createStay = async () => {
    if (!newName.trim()) return;
    await api("POST", "/api/admin/listings/stays", { name: newName.trim() });
    setNewName("");
    setShowCreate(false);
    pushState({ ...state });
  };

  const publishStay = async (id: number) => {
    await api("POST", `/api/admin/listings/stays/${id}/publish`);
    pushState({ ...state });
  };

  const exportRows = async (scope: "selected" | "filtered" | "all" | "template") => {
    const out = await api<{ fileName: string; fileBase64: string }>("POST", "/api/admin/excel/export/stays", {
      scope,
      selectedIds,
      filters: {
        search: state.q || undefined,
        published: state.published || undefined,
        spotId: state.spotId || undefined,
        missingWebsite: state.missingWebsite || undefined,
        missingMap: state.missingMap || undefined,
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

  const SortHeader = ({ col, label }: { col: string; label: string }) => (
    <button
      onClick={() =>
        pushState({
          ...state,
          sortBy: col,
          sortDir: state.sortBy === col && state.sortDir === "asc" ? "desc" : "asc",
          page: 1,
        })
      }
      className="inline-flex items-center gap-1 hover:text-foreground"
    >
      {label}
      {state.sortBy === col ? (state.sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : null}
    </button>
  );

  const totalPages = data ? Math.ceil(data.total / data.perPage) : 1;

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

      <div className="mb-4 rounded-xl border border-border p-3">
        <div className="mb-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!selectedIds.length} onClick={() => void exportRows("selected")}>Export selected</Button>
          <Button size="sm" variant="outline" onClick={() => void exportRows("filtered")}>Export filtered</Button>
          <Button size="sm" variant="outline" onClick={() => void exportRows("all")}>Export all</Button>
          <Button size="sm" variant="outline" onClick={() => void exportRows("template")}>Template</Button>
          <Input type="file" accept=".xlsx" className="max-w-xs" disabled={importBusy} onChange={(e) => void onUpload(e.target.files?.[0] ?? null)} />
        </div>
        {preview && (
          <div className="rounded border p-3 text-sm">
            New {preview.summary.newCount} · Update {preview.summary.updateCount} · Error ID not found {preview.summary.errorIdNotFoundCount} · Error invalid data {preview.summary.errorInvalidDataCount}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => downloadBase64(preview.files.updatesFileName, preview.files.updatesFileBase64)}>updates.xlsx</Button>
              <Button size="sm" variant="outline" onClick={() => downloadBase64(preview.files.errorsFileName, preview.files.errorsFileBase64)}>errors.xlsx</Button>
              <Button size="sm" onClick={() => void commitImport("create_update")}>Create new & update existing</Button>
              <Button size="sm" variant="outline" onClick={() => void commitImport("create_only")}>Create new only</Button>
              <Button size="sm" variant="ghost" onClick={() => void cancelImport()}>Cancel import</Button>
            </div>
          </div>
        )}
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

      <div className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Search by name…" value={state.q} onChange={(e) => pushState({ ...state, q: e.target.value, page: 1 })} className="w-64" />
        <select value={state.published} onChange={(e) => pushState({ ...state, published: e.target.value, page: 1 })} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">All statuses</option>
          <option value="true">Published</option>
          <option value="false">Unpublished</option>
        </select>
        <select value={state.spotId} onChange={(e) => pushState({ ...state, spotId: e.target.value, page: 1 })} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">All assigned spots</option>
          {spots.map((spot) => <option key={spot.id} value={String(spot.id)}>{spot.name}</option>)}
        </select>
        <select value={state.type} onChange={(e) => pushState({ ...state, type: e.target.value, page: 1 })} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">All types</option>
          {STAY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={state.missingWebsite} onChange={(e) => pushState({ ...state, missingWebsite: e.target.checked, page: 1 })} />
          Missing website
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={state.missingMap} onChange={(e) => pushState({ ...state, missingMap: e.target.checked, page: 1 })} />
          Missing Maps
        </label>
      </div>

      <div className="rounded-2xl border border-card-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-left">
              <th className="px-2 py-3">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => setSelectedIds(e.target.checked ? Array.from(new Set([...selectedIds, ...visibleIds])) : selectedIds.filter((id) => !visibleIds.includes(id)))}
                />
              </th>
              <th className="px-4 py-3 font-medium"><SortHeader col="name" label="Name" /></th>
              <th className="px-4 py-3 font-medium">Published</th>
              <th className="px-4 py-3 font-medium">Spots</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Website</th>
              <th className="px-4 py-3 font-medium">Maps</th>
              <th className="px-4 py-3 font-medium"><SortHeader col="updatedAt" label="Last updated" /></th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && !data?.items?.length && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">No stays found.</td></tr>
            )}
            {!loading && data?.items?.map((stay) => (
              <tr key={stay.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                <td className="px-2 py-3">
                  <input type="checkbox" checked={selectedIds.includes(stay.id)} onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...prev, stay.id] : prev.filter((id) => id !== stay.id))} />
                </td>
                <td className="px-4 py-3 font-medium text-foreground">{stay.name}</td>
                <td className="px-4 py-3">
                  {stay.published ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-muted-foreground" />}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{stay.assignedSpotsCount}</td>
                <td className="px-4 py-3 text-muted-foreground">{stay.type || "—"}</td>
                <td className="px-4 py-3">
                  {stay.websiteUrl ? <a href={stay.websiteUrl} target="_blank" rel="noopener noreferrer"><Globe className="h-4 w-4 text-sky-600" /></a> : <X className="h-4 w-4 text-muted-foreground" />}
                </td>
                <td className="px-4 py-3">
                  {stay.mapUrl ? <a href={stay.mapUrl} target="_blank" rel="noopener noreferrer"><Map className="h-4 w-4 text-sky-600" /></a> : <X className="h-4 w-4 text-muted-foreground" />}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{stay.updatedAt ? new Date(stay.updatedAt).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-3">
                  {!stay.published && <Button size="sm" variant="outline" onClick={() => void publishStay(stay.id)}>Publish</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Per page:</span>
            {PER_PAGE_OPTIONS.map((n) => (
              <button key={n} onClick={() => pushState({ ...state, perPage: n, page: 1 })} className={`rounded px-2 py-0.5 ${state.perPage === n ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                {n}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span>Page {data.page} of {totalPages} · {data.total} total</span>
            <Button size="sm" variant="outline" disabled={data.page <= 1} onClick={() => pushState({ ...state, page: state.page - 1 })}>Prev</Button>
            <Button size="sm" variant="outline" disabled={data.page >= totalPages} onClick={() => pushState({ ...state, page: state.page + 1 })}>Next</Button>
          </div>
        </div>
      )}

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
