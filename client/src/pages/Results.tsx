import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/SiteChrome";
import { FilterPanel, FilterState } from "@/components/Filters";
import { filtersToParams, paramsToFilters, getHashSearch } from "@/lib/filterParams";
import { SpotCard } from "@/components/SpotCard";
import { SpotMap, MapPoint } from "@/components/SpotMap";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SpotListItem, FilterDef } from "@/lib/types";
import { SlidersHorizontal, MapIcon, List, Compass } from "lucide-react";

export default function Results() {
  const [, navigate] = useLocation();
  const [filters, setFilters] = useState<FilterState>(() => paramsToFilters(getHashSearch()));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // keep URL in sync (so it's shareable / reloadable)
  useEffect(() => {
    const qs = filtersToParams(filters).toString();
    const target = `/results${qs ? `?${qs}` : ""}`;
    if (getHashSearch().replace(/^\?/, "") !== qs) navigate(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const queryString = filtersToParams(filters).toString();
  const { data: defs = [] } = useQuery<FilterDef[]>({ queryKey: ["/api/filters"] });
  const { data: countries = [] } = useQuery<string[]>({ queryKey: ["/api/countries"] });
  const { data: spots, isLoading } = useQuery<SpotListItem[]>({
    queryKey: [`/api/spots?${queryString}`],
  });

  const points: MapPoint[] = useMemo(() =>
    (spots ?? [])
      .filter(s => s.latitude != null && s.longitude != null)
      .map(s => ({ id: s.id, slug: s.slug, name: s.name, lat: s.latitude!, lng: s.longitude!, score: s.score })),
  [spots]);

  // map marker click -> scroll list card into view + highlight
  const onMarkerSelect = (id: number) => {
    setSelectedId(id);
    const el = cardRefs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (mobileView === "map") setMobileView("list");
  };

  const activeCount =
    filters.spotType.length + filters.riderLevel.length + filters.vibe.length +
    (filters.country ? 1 : 0);

  const filterControls = <FilterPanel defs={defs} countries={countries} state={filters} onChange={setFilters} />;

  return (
    <SiteLayout>
      <div className="mx-auto max-w-7xl px-5 py-8 md:px-8">
        <div className="mb-6">
          <h1 className="font-serif text-3xl font-semibold text-foreground">
            {filters.query
              ? `Results for ${filters.query}`
              : filters.months.length
                ? `Best kitesurf spots for ${filters.months.join(", ")}`
                : "Explore kitesurf spots"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="text-result-count">
            {isLoading ? "Loading…" : `${spots?.length ?? 0} spot${(spots?.length ?? 0) === 1 ? "" : "s"} ${filters.months.length || filters.query ? "matched" : "available to browse"}`}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
          {/* ── Filters (desktop sidebar) ── */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl border border-card-border bg-card p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                <SlidersHorizontal className="h-4 w-4" /> Filters
              </div>
              {filterControls}
            </div>
          </aside>

          {/* ── List + Map ── */}
          <div>
            {/* mobile controls */}
            <div className="mb-4 flex items-center gap-2 lg:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" className="gap-2" data-testid="button-mobile-filters">
                    <SlidersHorizontal className="h-4 w-4" /> Filters{activeCount > 0 && ` (${activeCount})`}
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[85vw] overflow-y-auto sm:max-w-sm">
                  <SheetHeader><SheetTitle>Filters</SheetTitle></SheetHeader>
                  <div className="mt-6">{filterControls}</div>
                </SheetContent>
              </Sheet>
              <div className="ml-auto inline-flex rounded-lg border border-border p-0.5">
                <button onClick={() => setMobileView("list")} data-testid="button-view-list"
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${mobileView === "list" ? "bg-primary text-primary-foreground" : "text-foreground/70"}`}>
                  <List className="h-4 w-4" /> List
                </button>
                <button onClick={() => setMobileView("map")} data-testid="button-view-map"
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${mobileView === "map" ? "bg-primary text-primary-foreground" : "text-foreground/70"}`}>
                  <MapIcon className="h-4 w-4" /> Map
                </button>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
              {/* list */}
              <div className={`space-y-4 ${mobileView === "map" ? "hidden lg:block" : ""}`}>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-36 w-full rounded-2xl" />
                  ))
                ) : spots && spots.length > 0 ? (
                  spots.map(s => (
                    <div key={s.id} ref={(el) => { cardRefs.current[s.id] = el; }}>
                      <SpotCard
                        spot={s}
                        months={filters.months}
                        query={filters.query}
                        highlighted={selectedId === s.id}
                        onHover={() => setSelectedId(s.id)}
                        onLeave={() => setSelectedId(prev => (prev === s.id ? null : prev))}
                      />
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
                    <Compass className="mx-auto h-10 w-10 text-muted-foreground/50" />
                    <h3 className="mt-4 font-serif text-lg font-semibold text-foreground">No spots match those filters</h3>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                      Try removing a filter or choosing different months to widen your search.
                    </p>
                  </div>
                )}
              </div>

              {/* map */}
              <div className={`${mobileView === "list" ? "hidden lg:block" : ""}`}>
                <div className="sticky top-24 h-[70vh] overflow-hidden rounded-2xl border border-card-border lg:h-[calc(100vh-8rem)]">
                  <SpotMap
                    points={points}
                    selectedId={selectedId}
                    onSelect={onMarkerSelect}
                    className="h-full w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
