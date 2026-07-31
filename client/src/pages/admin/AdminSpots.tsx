import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminSpotListItem } from "@/lib/types";
import { useState } from "react";
import { Plus, Search, Circle, CheckCircle2, PencilLine, BadgeInfo } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

function StatusPill({ published, hasDraft }: { published: boolean; hasDraft: boolean }) {
  if (published && !hasDraft)
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Published</span>;
  if (published && hasDraft)
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><PencilLine className="h-3.5 w-3.5" /> Published · draft edits</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-500"><Circle className="h-3.5 w-3.5" /> Draft</span>;
}

function DataPill({ status }: { status?: "fresh" | "dirty" | "missing" }) {
  if (status === "fresh") return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Fresh</span>;
  if (status === "dirty") return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><BadgeInfo className="h-3.5 w-3.5" /> Dirty</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700"><Circle className="h-3.5 w-3.5" /> Missing</span>;
}

export default function AdminSpots() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);

  const { data: spots, isLoading } = useQuery<AdminSpotListItem[]>({
    queryKey: ["/api/admin/spots"], enabled: !!token,
  });
  const filtered = (spots ?? []).filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) ||
    (s.country || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <AdminLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Spots</h1>
          <p className="text-sm text-muted-foreground">{spots?.length ?? 0} total</p>
        </div>
        <Link href="/admin/spots/new"><Button className="gap-2" data-testid="button-new-spot"><Plus className="h-4 w-4" /> New spot</Button></Link>
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
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Country</th>
                <th className="px-4 py-3 text-center font-medium">Months</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id}
                  className="cursor-pointer border-t border-border hover-elevate"
                  onClick={() => navigate(`/admin/spots/${s.id}`)}
                  data-testid={`row-admin-spot-${s.slug}`}>
                  <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.country || "—"}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">{s.monthlyCount}</td>
                  <td className="px-4 py-3"><StatusPill published={s.published} hasDraft={s.hasDraft} /></td>
                  <td className="px-4 py-3"><DataPill status={s.dataStatus as any} /></td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No spots found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
