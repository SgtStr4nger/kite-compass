import { useMemo } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/SiteChrome";
import { SpotMap } from "@/components/SpotMap";
import { ScoreBadge, SeasonBadge, Chip } from "@/components/Badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SpotDetail as SpotDetailT, MONTHS, tagLabel } from "@/lib/types";
import { getHashSearch } from "@/lib/filterParams";
import { Wind, Gauge, CalendarDays, MapPin, Plane, ExternalLink, ArrowLeft, Navigation } from "lucide-react";

const PLACEHOLDER = "/img/placeholder-spot.jpg";

function scoreFor(spot: SpotDetailT, month: string) {
  const rec = spot.monthly.find(m => m.month === month);
  if (!rec) return null;
  return spot.rankingMode === "auto" ? rec.automaticWindScore : rec.manualScore;
}

export default function SpotDetail() {
  const [, params] = useRoute("/spots/:slug");
  const slug = params?.slug;
  const preview = new URLSearchParams(getHashSearch()).get("preview") === "1";
  const selectedMonth = new URLSearchParams(getHashSearch()).get("month");

  const { data: spot, isLoading, error } = useQuery<SpotDetailT>({
    queryKey: [`/api/spots/slug/${slug}${preview ? "?preview=1" : ""}`],
    enabled: !!slug,
  });

  const activeRec = useMemo(() => {
    if (!spot) return null;
    if (selectedMonth) return spot.monthly.find(m => m.month === selectedMonth) ?? null;
    // otherwise the best-scoring month
    const scored = [...spot.monthly].sort((a, b) => {
      const sa = spot.rankingMode === "auto" ? a.automaticWindScore : a.manualScore;
      const sb = spot.rankingMode === "auto" ? b.automaticWindScore : b.manualScore;
      return (sb ?? -1) - (sa ?? -1);
    });
    return scored[0] ?? null;
  }, [spot, selectedMonth]);

  if (isLoading) {
    return <SiteLayout><div className="mx-auto max-w-5xl px-5 py-10"><Skeleton className="h-80 w-full rounded-2xl" /><Skeleton className="mt-6 h-8 w-1/2" /><Skeleton className="mt-3 h-40 w-full" /></div></SiteLayout>;
  }
  if (error || !spot) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-3xl px-5 py-24 text-center">
          <h1 className="font-serif text-2xl font-semibold text-foreground">Spot not found</h1>
          <p className="mt-2 text-muted-foreground">This destination may not be published yet.</p>
          <Link href="/results"><Button className="mt-6">Back to spots</Button></Link>
        </div>
      </SiteLayout>
    );
  }

  const monthlySorted = MONTHS
    .map(m => spot.monthly.find(r => r.month === m))
    .filter(Boolean) as SpotDetailT["monthly"];
  const activeScore = activeRec
    ? (spot.rankingMode === "auto" ? activeRec.automaticWindScore : activeRec.manualScore)
    : null;

  return (
    <SiteLayout>
      {/* Hero */}
      <div className="relative h-[46vh] min-h-[340px] w-full overflow-hidden">
        <img src={spot.heroImageUrl || PLACEHOLDER} alt={spot.name}
          className="h-full w-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).src = PLACEHOLDER; }} />
        <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/30 to-primary/20" />
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-5 pb-8 md:px-8">
            {preview && (
              <span className="mb-3 inline-block rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground" data-testid="badge-preview">
                Preview — draft data
              </span>
            )}
            <Link href="/results" className="mb-3 inline-flex items-center gap-1.5 text-sm text-white/80 no-underline hover:text-white" data-testid="link-back-results">
              <ArrowLeft className="h-4 w-4" /> All spots
            </Link>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-serif text-4xl font-semibold text-white md:text-5xl" data-testid="text-spot-name">{spot.name}</h1>
                <div className="mt-2 flex items-center gap-1.5 text-white/85">
                  <MapPin className="h-4 w-4" />
                  {[spot.region, spot.country].filter(Boolean).join(", ") || "—"}
                </div>
              </div>
              {activeScore != null && (
                <div className="flex items-center gap-3 rounded-xl bg-white/10 p-3 backdrop-blur">
                  <ScoreBadge score={activeScore} size="lg" />
                  <div className="text-white">
                    <div className="text-xs uppercase tracking-wide text-white/70">Kite Compass score</div>
                    <div className="text-sm">{selectedMonth ? `in ${selectedMonth}` : "best month"}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">
        <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
          {/* main */}
          <div className="space-y-10">
            {spot.destinationSummary && (
              <p className="font-serif text-xl leading-relaxed text-foreground/90" data-testid="text-summary">{spot.destinationSummary}</p>
            )}

            {/* tags */}
            <div className="flex flex-wrap gap-2">
              {spot.spotTypes.map(t => <Chip key={t}>{tagLabel(t)}</Chip>)}
              {spot.riderLevels.map(t => <Chip key={t}>{tagLabel(t)}</Chip>)}
              {spot.vibeTags.map(t => <Chip key={t}>{tagLabel(t)}</Chip>)}
              {spot.beginnerFriendly && <Chip>Beginner friendly</Chip>}
            </div>

            {spot.destinationDescription && (
              <section>
                <h2 className="font-serif text-2xl font-semibold text-foreground">About the destination</h2>
                <p className="mt-3 whitespace-pre-line leading-relaxed text-foreground/80">{spot.destinationDescription}</p>
              </section>
            )}

            {spot.kiteContextDescription && (
              <section>
                <h2 className="font-serif text-2xl font-semibold text-foreground">Kiting conditions</h2>
                <p className="mt-3 whitespace-pre-line leading-relaxed text-foreground/80">{spot.kiteContextDescription}</p>
              </section>
            )}

            {/* monthly overview */}
            <section>
              <h2 className="font-serif text-2xl font-semibold text-foreground">Month by month</h2>
              <div className="mt-4 overflow-hidden rounded-2xl border border-card-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Month</th>
                      <th className="px-4 py-3 font-medium">Season</th>
                      <th className="px-4 py-3 text-right font-medium">Avg wind</th>
                      <th className="px-4 py-3 text-right font-medium">Gusts</th>
                      <th className="px-4 py-3 text-right font-medium">Wind days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlySorted.map(r => {
                      const on = selectedMonth === r.month;
                      return (
                        <tr key={r.id} className={`border-t border-border ${on ? "bg-accent/10" : ""}`} data-testid={`row-month-${r.month}`}>
                          <td className="px-4 py-3 font-medium text-foreground">{r.month}</td>
                          <td className="px-4 py-3"><SeasonBadge label={r.seasonLabel} /></td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.averageBaseWind != null ? `${r.averageBaseWind} kn` : "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.gusts != null ? `${r.gusts} kn` : "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.windDays != null ? r.windDays : "—"}</td>
                        </tr>
                      );
                    })}
                    {monthlySorted.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No monthly data yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">All wind speeds in knots.</p>
            </section>
          </div>

          {/* sidebar */}
          <aside className="space-y-6">
            {/* current month metrics */}
            {activeRec && (
              <div className="rounded-2xl border border-card-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-serif text-lg font-semibold text-foreground">{activeRec.month}</h3>
                  <SeasonBadge label={activeRec.seasonLabel} />
                </div>
                <dl className="space-y-3 text-sm">
                  <Metric icon={Wind} label="Average wind" value={activeRec.averageBaseWind != null ? `${activeRec.averageBaseWind} kn` : "—"} />
                  <Metric icon={Gauge} label="Gusts" value={activeRec.gusts != null ? `${activeRec.gusts} kn` : "—"} />
                  <Metric icon={CalendarDays} label="Wind days" value={activeRec.windDays != null ? `${activeRec.windDays} / month` : "—"} />
                </dl>
              </div>
            )}

            {/* travel */}
            {(spot.nearestAirportName || spot.airportTransferTime || spot.transportNote) && (
              <div className="rounded-2xl border border-card-border bg-card p-5">
                <h3 className="mb-3 flex items-center gap-2 font-serif text-lg font-semibold text-foreground">
                  <Plane className="h-4 w-4 text-primary" /> Getting there
                </h3>
                <dl className="space-y-2 text-sm">
                  {spot.nearestAirportName && <div><dt className="text-muted-foreground">Nearest airport</dt><dd className="font-medium text-foreground">{spot.nearestAirportName}{spot.nearestAirportCode ? ` (${spot.nearestAirportCode})` : ""}</dd></div>}
                  {spot.airportTransferTime && <div><dt className="text-muted-foreground">Transfer time</dt><dd className="font-medium text-foreground">{spot.airportTransferTime}</dd></div>}
                  {spot.transportNote && <p className="text-foreground/75">{spot.transportNote}</p>}
                </dl>
              </div>
            )}

            {/* map */}
            {spot.latitude != null && spot.longitude != null && (
              <div className="overflow-hidden rounded-2xl border border-card-border">
                <SpotMap
                  points={[{ id: spot.id, slug: spot.slug, name: spot.name, lat: spot.latitude, lng: spot.longitude, score: activeScore }]}
                  selectedId={spot.id}
                  interactive={false}
                  className="h-56 w-full"
                />
                {spot.googleMapsUrl && (
                  <a href={spot.googleMapsUrl} target="_blank" rel="noopener noreferrer"
                     className="flex items-center justify-center gap-1.5 border-t border-border bg-card px-4 py-2.5 text-sm font-medium text-primary no-underline hover-elevate"
                     data-testid="link-google-maps">
                    <Navigation className="h-4 w-4" /> Open in Google Maps
                  </a>
                )}
              </div>
            )}

            {/* external forecast links — only when a URL exists */}
            {(spot.windyUrl || spot.windfinderUrl) && (
              <div className="rounded-2xl border border-card-border bg-card p-5">
                <h3 className="mb-3 font-serif text-lg font-semibold text-foreground">Live forecast</h3>
                <div className="space-y-2">
                  {spot.windyUrl && (
                    <a href={spot.windyUrl} target="_blank" rel="noopener noreferrer"
                       className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground no-underline hover-elevate"
                       data-testid="link-windy">
                      Windy <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </a>
                  )}
                  {spot.windfinderUrl && (
                    <a href={spot.windfinderUrl} target="_blank" rel="noopener noreferrer"
                       className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground no-underline hover-elevate"
                       data-testid="link-windfinder">
                      Windfinder <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </a>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </SiteLayout>
  );
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="flex items-center gap-2 text-muted-foreground"><Icon className="h-4 w-4 text-primary" />{label}</dt>
      <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
