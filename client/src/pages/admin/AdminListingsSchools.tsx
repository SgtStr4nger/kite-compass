import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { School, ListingsPage, SCHOOL_SPORTS, AdminSpotListItem } from "@/lib/types";
import { Plus, ChevronUp, ChevronDown, Check, X, Globe, Map } from "lucide-react";

type SchoolRow = School & { assignedSpotsCount: number };

const PER_PAGE_OPTIONS = [25, 50, 100];

function parseUrlState(search: string) {
  const p = new URLSearchParams(search);
  return {
    q: p.get("q") || "",
    published: p.get("published") || "",
    spotId: p.get("spotId") || "",
    missingWebsite: p.get("missingWebsite") === "true",
    missingMap: p.get("missingMap") === "true",
    offersLessons: p.get("offersLessons") || "",
    offersRental: p.get("offersRental") || "",
    sports: p.getAll("sports"),
    sortBy: p.get("sortBy") || "updatedAt",
    sortDir: p.get("sortDir") || "desc",
    page: Number(p.get("page") || "1"),
    perPage: Number(p.get("perPage") || "50"),
  };
}

export default function AdminListingsSchools() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [location] = useLocation();

  const [state, setState] = useState(() => parseUrlState(window.location.search));
  const [data, setData] = useState<ListingsPage<SchoolRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [spots, setSpots] = useState<AdminSpotListItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);

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
    if (next.offersLessons) p.set("offersLessons", next.offersLessons);
    if (next.offersRental) p.set("offersRental", next.offersRental);
    next.sports.forEach(s => p.append("sports", s));
    p.set("sortBy", next.sortBy);
    p.set("sortDir", next.sortDir);
    p.set("page", String(next.page));
    p.set("perPage", String(next.perPage));
    window.history.replaceState({}, "", `${window.location.pathname}?${p.toString()}`);
    setState(next);
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
    if (state.offersLessons) p.set("offersLessons", state.offersLessons);
    if (state.offersRental) p.set("offersRental", state.offersRental);
    state.sports.forEach(s => p.append("sports", s));
    p.set("sortBy", state.sortBy);
    p.set("sortDir", state.sortDir);
    p.set("page", String(state.page));
    p.set("perPage", String(state.perPage));
    api<ListingsPage<SchoolRow>>("GET", `/api/admin/listings/schools?${p.toString()}`)
      .then(setData)
      .catch(() => toast({ title: "Failed to load", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [state, token]);

  useEffect(() => {
    if (!token) return;
    api<AdminSpotListItem[]>("GET", "/api/admin/spots")
      .then(setSpots)
      .catch(() => toast({ title: "Failed to load spots", variant: "destructive" }));
  }, [token]);

  const setSortBy = (col: string) => {
    pushState({
      ...state,
      sortBy: col,
      sortDir: state.sortBy === col && state.sortDir === "asc" ? "desc" : "asc",
      page: 1,
    });
  };

  const createSchool = async () => {
    if (!newName.trim()) return;
    try {
      await api("POST", "/api/admin/listings/schools", { name: newName.trim() });
      setNewName(""); setShowCreate(false);
      pushState({ ...state, page: 1 });
      toast({ title: "School created" });
    } catch (e: any) {
      toast({ title: "Failed", description: String(e.message || e), variant: "destructive" });
    }
  };

  const publishSchool = async (id: number) => {
    await api("POST", `/api/admin/listings/schools/${id}/publish`);
    pushState({ ...state });
    toast({ title: "Published" });
  };

  const SortHeader = ({ col, label }: { col: string; label: string }) => (
    <button onClick={() => setSortBy(col)} className="inline-flex items-center gap-1 hover:text-foreground">
      {label}
      {state.sortBy === col ? (state.sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : null}
    </button>
  );

  const totalPages = data ? Math.ceil(data.total / data.perPage) : 1;

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Kite Schools</h1>
          {data && <p className="text-sm text-muted-foreground">{data.total} school{data.total !== 1 ? "s" : ""}</p>}
        </div>
        <Button onClick={() => setShowCreate(v => !v)} className="gap-2">
          <Plus className="h-4 w-4" /> New school
        </Button>
      </div>

      {showCreate && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card p-4">
          <Input placeholder="School name" value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") createSchool(); }} className="flex-1" autoFocus />
          <Button onClick={createSchool} disabled={!newName.trim()}>Create</Button>
          <Button variant="ghost" onClick={() => { setShowCreate(false); setNewName(""); }}>Cancel</Button>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Search by name…" value={state.q}
          onChange={e => pushState({ ...state, q: e.target.value, page: 1 })}
          className="w-64" />
        <select value={state.published} onChange={e => pushState({ ...state, published: e.target.value, page: 1 })}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">All statuses</option>
          <option value="true">Published</option>
          <option value="false">Unpublished</option>
        </select>
        <select value={state.spotId} onChange={e => pushState({ ...state, spotId: e.target.value, page: 1 })}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">All assigned spots</option>
          {spots.map(spot => <option key={spot.id} value={String(spot.id)}>{spot.name}</option>)}
        </select>
        <select value={state.offersLessons} onChange={e => pushState({ ...state, offersLessons: e.target.value, page: 1 })}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">Lessons: any</option>
          <option value="true">Lessons: yes</option>
          <option value="false">Lessons: no</option>
        </select>
        <select value={state.offersRental} onChange={e => pushState({ ...state, offersRental: e.target.value, page: 1 })}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">Rental: any</option>
          <option value="true">Rental: yes</option>
          <option value="false">Rental: no</option>
        </select>
        <div className="flex flex-wrap gap-1">
          {SCHOOL_SPORTS.map(s => (
            <button key={s} type="button"
              onClick={() => {
                const next = state.sports.includes(s) ? state.sports.filter(x => x !== s) : [...state.sports, s];
                pushState({ ...state, sports: next, page: 1 });
              }}
              className={`rounded-full border px-2.5 py-1 text-xs ${state.sports.includes(s) ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}>
              {s}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={state.missingWebsite} onChange={e => pushState({ ...state, missingWebsite: e.target.checked, page: 1 })} />
          Missing website
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={state.missingMap} onChange={e => pushState({ ...state, missingMap: e.target.checked, page: 1 })} />
          Missing Maps
        </label>
      </div>

      <div className="rounded-2xl border border-card-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-left">
              <th className="px-4 py-3 font-medium"><SortHeader col="name" label="Name" /></th>
              <th className="px-4 py-3 font-medium">Published</th>
              <th className="px-4 py-3 font-medium">Spots</th>
              <th className="px-4 py-3 font-medium">Sports</th>
              <th className="px-4 py-3 font-medium">Lessons</th>
              <th className="px-4 py-3 font-medium">Rental</th>
              <th className="px-4 py-3 font-medium">Website</th>
              <th className="px-4 py-3 font-medium">Maps</th>
              <th className="px-4 py-3 font-medium"><SortHeader col="updatedAt" label="Last updated" /></th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && (!data?.items?.length) && (
              <tr><td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">No schools found.</td></tr>
            )}
            {!loading && data?.items?.map(school => (
              <tr key={school.id} className="border-b border-border last:border-0 hover:bg-secondary/20">
                <td className="px-4 py-3 font-medium text-foreground">{school.name}</td>
                <td className="px-4 py-3">
                  {school.published ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-muted-foreground" />}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{school.assignedSpotsCount}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {(Array.isArray(school.sports) ? school.sports : []).join(", ") || "—"}
                </td>
                <td className="px-4 py-3">
                  {school.offersLessons ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-muted-foreground" />}
                </td>
                <td className="px-4 py-3">
                  {school.offersRental ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-muted-foreground" />}
                </td>
                <td className="px-4 py-3">
                  {school.websiteUrl ? <a href={school.websiteUrl} target="_blank" rel="noopener noreferrer"><Globe className="h-4 w-4 text-sky-600" /></a> : <X className="h-4 w-4 text-muted-foreground" />}
                </td>
                <td className="px-4 py-3">
                  {school.mapUrl ? <a href={school.mapUrl} target="_blank" rel="noopener noreferrer"><Map className="h-4 w-4 text-sky-600" /></a> : <X className="h-4 w-4 text-muted-foreground" />}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {school.updatedAt ? new Date(school.updatedAt).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {!school.published && (
                      <Button size="sm" variant="outline" onClick={() => publishSchool(school.id)}>Publish</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Per page:</span>
            {PER_PAGE_OPTIONS.map(n => (
              <button key={n} onClick={() => pushState({ ...state, perPage: n, page: 1 })}
                className={`rounded px-2 py-0.5 ${state.perPage === n ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
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
    </AdminLayout>
  );
}
