import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/SiteChrome";
import { FilterPanel, FilterState, normalizeFilterState } from "@/components/Filters";
import { filtersToParams, paramsToFilters, getHashSearch } from "@/lib/filterParams";
import { SpotCard } from "@/components/SpotCard";
import { SpotMap, MapPoint } from "@/components/SpotMap";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { SpotListItem, FilterDef, SEASON_META, PublicSeoState, ScoringConfig } from "@/lib/types";
import { SlidersHorizontal, MapIcon, List, Compass, Info } from "lucide-react";
import { applyPageMetadata } from "@/lib/metadata";
import heroImg from "@/assets/hero.jpg";
import { DEFAULT_SCORING_CONFIG } from "@shared/scoring";

function SeasonHelp({ config }: { config: ScoringConfig }) {
  const peakPct = Math.round(config.seasonPeakThreshold * 100);
  const sidePct = Math.round(config.seasonSideThreshold * 100);
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Season</span>
      <Popover>
        <PopoverTrigger asChild>
          <button className="inline-flex items-center rounded-full p-0.5 hover:text-foreground focus:outline-none" aria-label="About season ratings">
            <Info className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 text-sm">
          <p className="mb-3 font-medium text-foreground">Season ratings</p>
          <div className="space-y-2">
            {(["peak", "side", "off"] as const).map((key) => (
              <div key={key} className="flex items-start gap-2">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-sm ${SEASON_META[key].dot}`} />
                <div className="lg:flex lg:flex-col lg:h-[calc(100vh-33rem)] xl:h-[calc(100vh-35.5rem)]">
                  <span className="font-medium text-foreground">{SEASON_META[key].label}</span>
                  <span className="text-muted-foreground">
                    {key === "peak"
                      ? ` — at least ${peakPct}% of this spot's best month score`
                      : key === "side"
                        ? ` — at least ${sidePct}% and below ${peakPct}%`
                        : ` — below ${sidePct}% (or no valid score)`}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <Link href="/methodology" className="mt-3 block text-xs text-primary hover:underline">
            Learn about our methodology
          </Link>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function Results() {
  const [, navigate] = useLocation();
  const [rawFilters, setRawFilters] = useState<FilterState>(() => normalizeFilterState(paramsToFilters(getHashSearch())));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const filters = useMemo(() => normalizeFilterState(rawFilters), [rawFilters]);
  const setFilters = (next: FilterState) => setRawFilters(normalizeFilterState(next));

  useEffect(() => {
    const qs = filtersToParams(filters).toString();
    const target = `/results${qs ? `?${qs}` : ""}`;
    if (getHashSearch().replace(/^\?/, "") !== qs) navigate(target, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const queryString = filtersToParams(filters).toString();
  const { data: defs = [] } = useQuery<FilterDef[]>({ queryKey: ["/api/filters"] });
  const { data: countries = [] } = useQuery<string[]>({ queryKey: ["/api/countries"] });
  const { data: seo } = useQuery<PublicSeoState>({ queryKey: ["/api/seo"] });
  const { data: scoring } = useQuery<ScoringConfig>({ queryKey: ["/api/scoring"] });
  const { data: spots, isLoading } = useQuery<SpotListItem[]>({
    queryKey: [`/api/spots?${queryString}`],
  });

  useEffect(() => {
    const isFiltered = queryString.length > 0;
    applyPageMetadata({
      title: seo?.exploreTitle ?? "Explore Kitesurf Spots by Month | Kite Compass",
      description: seo?.exploreDescription ?? "Browse and compare kitesurf spots worldwide. Filter by season, conditions and travel vibe to find your next trip.",
      robots: isFiltered ? "noindex,nofollow" : "index,follow",
      canonicalPath: "/results",
      ogImage: heroImg,
    });
  }, [queryString, seo]);

  const points: MapPoint[] = useMemo(() =>
    (spots ?? [])
      .filter((spot) => spot.latitude != null && spot.longitude != null)
      .map((spot) => ({ id: spot.id, slug: spot.slug, name: spot.name, lat: spot.latitude!, lng: spot.longitude!, score: spot.score })),
  [spots]);

  const onMarkerSelect = (id: number) => {
    setSelectedId(id);
    const element = cardRefs.current[id];
    if (element) element.scrollIntoView({ behavior: "smooth", block: "center" });
    if (mobileView === "map") setMobileView("list");
  };

  const onMobileMarkerNavigate = (slug: string) => {
    navigate(`/spots/${slug}`);
  };

  const activeCount =
    filters.continents.length +
    filters.countries.length +
    filters.spotType.length +
    filters.riderLevel.length +
    filters.vibe.length +
    filters.windType.length +
    (filters.windMin != null || filters.windMax != null ? 1 : 0);

  const count = spots?.length ?? 0;
  const resultCountLabel = isLoading ? "Loading…" : `${count} spot${count === 1 ? "" : "s"}`;
  const topSummary = isLoading
    ? "Loading…"
    : `${count} spot${count === 1 ? "" : "s"} ${filters.months.length || filters.query || activeCount > 0 ? "matched" : "available to browse"}`;
  const seasonConfig = scoring ?? DEFAULT_SCORING_CONFIG;

  const filterControls = <FilterPanel defs={defs} countries={countries} state={filters} onChange={setFilters} />;

  return (
    <SiteLayout>
      <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 lg:flex lg:h-[calc(100vh-4rem)] lg:flex-col lg:overflow-hidden">
        <div className="mb-6 shrink-0">
          <h1 className="font-serif text-3xl font-semibold text-foreground">
            {filters.query
              ? `Results for ${filters.query}`
              : filters.months.length
                ? `Best kitesurf spots for ${filters.months.join(", ")}`
                : "Explore kitesurf spots"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground lg:hidden">
            {topSummary}
          </p>
        </div>

        <div className="mb-8 hidden shrink-0 lg:block" data-testid="explore-map-band">
          <div className="h-[320px] overflow-hidden rounded-2xl border border-card-border xl:h-[360px]">
            <SpotMap
              points={points}
              selectedId={selectedId}
              onSelect={onMarkerSelect}
              className="h-full w-full"
            />
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(18rem,1fr)_minmax(0,2fr)]">
          <aside className="hidden lg:block">
            <div
              className="overflow-y-auto rounded-2xl border border-card-border bg-card p-5 lg:h-[calc(100vh-33rem)] xl:h-[calc(100vh-35.5rem)]"
              data-testid="explore-filter-rail"
            >
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                <SlidersHorizontal className="h-4 w-4" /> Filters
              </div>
              {filterControls}
            </div>
          </aside>

          <div className="lg:h-[calc(100vh-33rem)] xl:h-[calc(100vh-35.5rem)]">
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
                <button
                  onClick={() => setMobileView("list")}
                  data-testid="button-view-list"
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${mobileView === "list" ? "bg-primary text-primary-foreground" : "text-foreground/70"}`}
                >
                  <List className="h-4 w-4" /> List
                </button>
                <button
                  onClick={() => setMobileView("map")}
                  data-testid="button-view-map"
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${mobileView === "map" ? "bg-primary text-primary-foreground" : "text-foreground/70"}`}
                >
                  <MapIcon className="h-4 w-4" /> Map
                </button>
              </div>
            </div>

            <div
              className={`space-y-4 lg:flex lg:h-full lg:flex-col lg:overflow-y-auto lg:pr-1 ${mobileView === "map" ? "hidden lg:flex" : ""}`}
              data-testid="explore-results-scroll"
            >
              <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3 lg:sticky lg:top-0 lg:z-10 lg:bg-background lg:pt-1">
                <p className="text-sm font-medium text-foreground" data-testid="text-result-count">
                  {resultCountLabel}
                </p>
                <SeasonHelp config={seasonConfig} />
              </div>

              <div className="space-y-3 lg:pb-2">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-36 w-full rounded-2xl" />
                  ))
                ) : spots && spots.length > 0 ? (
                  spots.map((spot) => (
                    <div key={spot.id} ref={(element) => { cardRefs.current[spot.id] = element; }}>
                      <SpotCard
                        spot={spot}
                        months={filters.months}
                        highlighted={selectedId === spot.id}
                        onHover={() => setSelectedId(spot.id)}
                        onLeave={() => setSelectedId((prev) => (prev === spot.id ? null : prev))}
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
            </div>

            <div className={`${mobileView === "list" ? "hidden" : ""} lg:hidden`}>
              <div className="h-[70vh] overflow-hidden rounded-2xl border border-card-border">
                <SpotMap
                  points={points}
                  selectedId={selectedId}
                  onSelect={onMarkerSelect}
                  onNavigate={onMobileMarkerNavigate}
                  isMobile
                  className="h-full w-full"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
