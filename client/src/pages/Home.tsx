import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/SiteChrome";
import { MonthSelect } from "@/components/Filters";
import { FilterState, emptyFilters } from "@/components/Filters";
import { filtersToParams } from "@/lib/filterParams";
import { SpotMap, MapPoint } from "@/components/SpotMap";
import { Button } from "@/components/ui/button";
import { Search, Wind, Compass, Waves } from "lucide-react";
import heroImg from "@/assets/hero.jpg";
import { SpotListItem, MONTHS, tagLabel } from "@/lib/types";

const QUICK_TYPES = ["flat-water", "waves", "freestyle", "foil"];

export default function Home() {
  const [, navigate] = useLocation();
  const [month, setMonth] = useState<string | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [beginner, setBeginner] = useState(false);
  const [err, setErr] = useState(false);

  const { data: allSpots } = useQuery<SpotListItem[]>({ queryKey: ["/api/spots"] });

  const mapPoints: MapPoint[] = useMemo(() =>
    (allSpots ?? [])
      .filter(s => s.latitude != null && s.longitude != null)
      .map(s => ({ id: s.id, slug: s.slug, name: s.name, lat: s.latitude!, lng: s.longitude!, score: null })),
  [allSpots]);

  const search = () => {
    if (!month) { setErr(true); return; }
    const f: FilterState = { ...emptyFilters, month, spotType: types, beginner };
    navigate(`/results?${filtersToParams(f).toString()}`);
  };

  const toggleType = (t: string) =>
    setTypes(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);

  return (
    <SiteLayout>
      {/* ─── Hero ─── */}
      <section className="relative">
        <div className="absolute inset-0">
          <img src={heroImg} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-primary/70 via-primary/45 to-primary/75" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
        </div>

        <div className="relative mx-auto max-w-5xl px-5 pb-16 pt-24 text-center md:pb-24 md:pt-32">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-sm font-medium text-white backdrop-blur">
            <Compass className="h-4 w-4" /> Kitesurf destination discovery
          </div>
          <h1 className="font-serif text-4xl font-semibold leading-[1.05] tracking-tight text-white md:text-6xl">
            Find your perfect<br />kitesurf month
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-white/85">
            Pick a month and we'll rank the world's best kiteboarding spots by
            wind, conditions and travel vibe — so you're on the water when it counts.
          </p>

          {/* Search card */}
          <div className="mx-auto mt-9 max-w-3xl rounded-2xl border border-white/40 bg-background/95 p-4 text-left shadow-2xl backdrop-blur md:p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex-1">
                <label htmlFor="hero-month" className="mb-1.5 block text-sm font-medium text-foreground">
                  When do you want to go? <span className="text-accent">*</span>
                </label>
                <MonthSelect id="hero-month" value={month} required onChange={(m) => { setMonth(m); setErr(false); }} />
                {err && <p className="mt-1.5 text-sm text-destructive" data-testid="text-month-error">Please choose a month to start your search.</p>}
              </div>
              <Button size="lg" onClick={search} className="h-11 gap-2 md:w-auto" data-testid="button-hero-search">
                <Search className="h-4 w-4" /> Find spots
              </Button>
            </div>

            {/* optional quick filters */}
            <div className="mt-4 border-t border-border pt-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Refine (optional)</div>
              <div className="flex flex-wrap items-center gap-2">
                {QUICK_TYPES.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    data-testid={`quick-type-${t}`}
                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                      types.includes(t) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground/80 hover-elevate"
                    }`}
                  >
                    {tagLabel(t)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setBeginner(b => !b)}
                  data-testid="quick-beginner"
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    beginner ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground/80 hover-elevate"
                  }`}
                >
                  Beginner friendly
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Value props ─── */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:px-8">
        <div className="grid gap-8 md:grid-cols-3">
          {[
            { icon: Wind, title: "Wind you can trust", body: "Every spot carries average and gust wind ranges plus typical wind-day counts for each month of the year." },
            { icon: Waves, title: "Conditions that fit you", body: "Filter by flat water, waves, chop or foil-friendly lagoons, and by whether a spot suits beginners or advanced riders." },
            { icon: Compass, title: "The right time to travel", body: "A single Kite Compass score per month makes it easy to compare destinations and time your trip perfectly." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-card-border bg-card p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-serif text-xl font-semibold text-foreground">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Teaser map ─── */}
      <section className="mx-auto max-w-6xl px-5 pb-4 md:px-8">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h2 className="font-serif text-2xl font-semibold text-foreground">Spots around the world</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mapPoints.length} destinations mapped. Pick a month above to rank them.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/results")} data-testid="button-browse-all" className="hidden sm:inline-flex">
            Browse all spots
          </Button>
        </div>
        <SpotMap points={mapPoints} className="h-[420px] overflow-hidden rounded-2xl border border-card-border" onSelect={(id) => {
          const s = (allSpots ?? []).find(x => x.id === id);
          if (s) navigate(`/spots/${s.slug}`);
        }} />
      </section>
    </SiteLayout>
  );
}
