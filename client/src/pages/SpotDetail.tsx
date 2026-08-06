import { useMemo, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { SiteLayout } from "@/components/SiteChrome";
import { SpotMap } from "@/components/SpotMap";
import { ScoreBadge, SeasonBadge, Chip } from "@/components/Badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SpotDetail as SpotDetailT, MonthlyRecord, MONTHS, SEASON_META, tagLabel } from "@/lib/types";
import { getHashSearch } from "@/lib/filterParams";
import { Wind, Gauge, CalendarDays, MapPin, Plane, ExternalLink, ArrowLeft, Navigation, Waves } from "lucide-react";
import placeholderSpot from "@/assets/placeholder-spot.jpg";
import { resolveMonthlyScore } from "@shared/scoring";
import { applyPageMetadata } from "@/lib/metadata";

const PLACEHOLDER = placeholderSpot;

export default function SpotDetail() {
  const [, params] = useRoute("/spots/:slug");
  const slug = params?.slug;
  const preview = new URLSearchParams(getHashSearch()).get("preview") === "1";
  const selectedMonth = new URLSearchParams(getHashSearch()).get("month");

  const { data: spot, isLoading, error } = useQuery<SpotDetailT>({
    queryKey: [`/api/spots/slug/${slug}${preview ? "?preview=1" : ""}`],
    enabled: !!slug,
  });

  useEffect(() => {
    if (!slug) return;
    if (!spot) {
      if (!isLoading) {
        applyPageMetadata({
          title: "Spot not found | Kite Compass",
          description: "This destination is not published or does not exist.",
          robots: "noindex,nofollow",
          canonicalPath: "/results",
        });
      }
      return;
    }
    const country = spot.country || "Unknown location";
    const autoTitle = `${spot.name}, ${country} – Kitesurfing Guide | Kite Compass`;
    const autoDescription = `Explore kitesurfing conditions, seasonality and travel information for ${spot.name}, ${country}.`;
    const title = spot.seoTitleOverride?.trim() ? spot.seoTitleOverride.trim() : autoTitle;
    const description = spot.seoDescriptionOverride?.trim() ? spot.seoDescriptionOverride.trim() : autoDescription;
    applyPageMetadata({
      title,
      description,
      robots: preview ? "noindex,nofollow" : "index,follow",
      canonicalPath: `/spots/${spot.publishedSlug || spot.slug}`,
      ogImage: spot.heroImageUrl || PLACEHOLDER,
    });
  }, [slug, spot, isLoading, preview]);

  const activeRec = useMemo(() => {
    if (!spot) return null;
    if (selectedMonth) return spot.monthly.find(m => m.month === selectedMonth) ?? null;
    // otherwise the best weather-scoring month
    const scored = [...spot.monthly].sort((a, b) => {
      return (resolveMonthlyScore(b, spot.rankingMode) ?? -1) - (resolveMonthlyScore(a, spot.rankingMode) ?? -1);
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
  const activeScore = activeRec ? resolveMonthlyScore(activeRec, spot.rankingMode) : null;

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

            {(spot.schools.length > 0 || spot.stays.length > 0) && (
              <section className="grid gap-6 md:grid-cols-2">
                {spot.schools.length > 0 && (
                  <LinkedGroup title="Schools" items={spot.schools.map(s => ({
                    name: s.name,
                    note: [s.offersLessons ? "Lessons" : null, s.offersRental ? "Rental" : null].filter(Boolean).join(" · "),
                    href: s.websiteUrl || s.mapUrl || undefined,
                  }))} />
                )}
                {spot.stays.length > 0 && (
                  <LinkedGroup title="Stays" items={spot.stays.map(s => ({
                    name: s.name,
                    note: [s.type || null, s.notes || null].filter(Boolean).join(" · "),
                    href: s.websiteUrl || s.mapUrl || undefined,
                  }))} />
                )}
              </section>
            )}

            {/* When it works best */}
            <WhenItWorksBest monthly={monthlySorted} selectedMonth={selectedMonth} rankingMode={spot.rankingMode} />
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
                  {(() => {
                    const avgWind = activeRec.avgKiteableWind10mKnots ?? activeRec.averageBaseWind;
                    const windyDays = activeRec.kiteableDaysCount ?? activeRec.windDays;
                    const kiteHours = activeRec.avgKiteableHoursPerDay;
                    return (
                      <>
                        <Metric icon={Wind} label="Average kiteable wind" value={avgWind != null ? `${avgWind} kn` : "—"} />
                        <Metric icon={CalendarDays} label="Kiteable days" value={windyDays != null ? `${windyDays} / month` : "—"} />
                        <Metric icon={Gauge} label="Kiteable hours/day" value={kiteHours != null ? `${kiteHours} h` : "—"} />
                        {activeRec.avgWaveHeightM != null && (
                          <Metric icon={Waves} label="Avg wave" value={`${activeRec.avgWaveHeightM} m`} />
                        )}
                      </>
                    );
                  })()}
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

function LinkedGroup({ title, items }: { title: string; items: { name: string; note: string; href?: string }[] }) {
  return (
    <div className="rounded-2xl border border-card-border bg-card p-5">
      <h2 className="font-serif text-2xl font-semibold text-foreground">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.map(item => (
          <div key={item.name} className="rounded-xl border border-border p-4">
            <div className="font-medium text-foreground">{item.name}</div>
            {item.note && <div className="mt-1 text-sm text-muted-foreground">{item.note}</div>}
            {item.href && (
              <a href={item.href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-medium text-primary no-underline">Open</a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── "When it works best" — season strip + two charts + 12-month table ──
function WhenItWorksBest({
  monthly, selectedMonth, rankingMode,
}: {
  monthly: MonthlyRecord[];
  selectedMonth: string | null;
  rankingMode: string;
}) {
  const byMonth = new Map(monthly.map(m => [m.month, m]));
  const rows = MONTHS.map(m => byMonth.get(m) ?? null);
  const hasAny = monthly.length > 0;

  const hasWindType = monthly.some(m => (m as any).primaryWindType != null);
  const hasWaves    = monthly.some(m => m.avgWaveHeightM != null);
  const hasWavePeriod = monthly.some(m => m.avgWavePeriodS != null);

  if (!hasAny) {
    return (
      <section>
        <h2 className="font-serif text-2xl font-semibold text-foreground">When it works best</h2>
        <p className="mt-3 text-muted-foreground">No monthly data yet.</p>
      </section>
    );
  }

  return (
    <section data-testid="section-when-it-works">
      <h2 className="font-serif text-2xl font-semibold text-foreground">When it works best</h2>

      {/* Season strip */}
      <div className="mt-4">
        <div className="flex gap-1" data-testid="season-strip">
          {MONTHS.map((m, i) => {
            const rec = rows[i];
            const meta = rec ? SEASON_META[rec.seasonLabel] : undefined;
            const on = selectedMonth === m;
            return (
              <div key={m} className="flex-1 text-center" title={rec ? `${m} · ${meta?.label ?? rec.seasonLabel}` : m}>
                <div className={`h-8 rounded-md ${meta ? meta.dot : "bg-stone-200"} ${on ? "ring-2 ring-offset-1 ring-foreground/60" : ""}`} />
                <div className="mt-1 text-[10px] font-medium uppercase text-muted-foreground">{m.slice(0, 1)}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {(["peak", "side", "off"] as const).map(k => (
            <span key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-2.5 w-2.5 rounded-sm ${SEASON_META[k].dot}`} /> {SEASON_META[k].label}
            </span>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <MonthlyChart
          title="Average wind"
          unit="kn"
          data={rows.map((r, i) => ({
            month: MONTHS[i].slice(0, 3),
            value: r ? (r.avgKiteableWind10mKnots ?? r.averageBaseWind ?? null) : null,
            selected: selectedMonth === MONTHS[i],
          }))}
          yTicks={[0, 10, 20, 30, 40]}
          yDomain={[0, "auto"]}
        />
        <MonthlyChart
          title="Kiteable days"
          unit="days"
          data={rows.map((r, i) => ({
            month: MONTHS[i].slice(0, 3),
            value: r ? (r.kiteableDaysCount ?? r.windDays ?? null) : null,
            selected: selectedMonth === MONTHS[i],
          }))}
          yTicks={[0, 10, 20]}
          yDomain={[0, 31]}
        />
      </div>

      {/* Monthly table */}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-card-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-secondary/60 px-4 py-3 font-medium">Month</th>
              <th className="px-4 py-3 text-right font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Season</th>
              <th className="px-4 py-3 text-right font-medium">Kiteable days</th>
              <th className="px-4 py-3 text-right font-medium">Hours/day</th>
              <th className="px-4 py-3 text-right font-medium">Avg wind</th>
              {hasWindType && <th className="px-4 py-3 font-medium">Wind type</th>}
              {hasWaves    && <th className="px-4 py-3 text-right font-medium">Wave height</th>}
              {hasWavePeriod && <th className="px-4 py-3 text-right font-medium">Wave period</th>}
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m, i) => {
              const r = rows[i];
              const on = selectedMonth === m;
              const totalCols = 6 + (hasWindType ? 1 : 0) + (hasWaves ? 1 : 0) + (hasWavePeriod ? 1 : 0);
              if (!r) {
                return (
                  <tr key={m} className="border-t border-border text-muted-foreground/70">
                    <td className={`sticky left-0 z-10 px-4 py-3 font-medium ${on ? "border-l-2 border-primary bg-accent/10" : "bg-card"}`}>{m}</td>
                    <td className="px-4 py-3" colSpan={totalCols - 1}>—</td>
                  </tr>
                );
              }
              const score = resolveMonthlyScore(r, rankingMode);
              const avgWind = r.avgKiteableWind10mKnots ?? r.averageBaseWind;
              const windyDays = r.kiteableDaysCount ?? r.windDays;
              const kiteHours = r.avgKiteableHoursPerDay;
              const hasValidScore = score != null;
              const primaryWT = (r as any).primaryWindType as string | null ?? null;
              const secondaryWT = (r as any).secondaryWindType as string | null ?? null;
              const windTypeLabel = primaryWT
                ? secondaryWT ? `${primaryWT} / ${secondaryWT}` : primaryWT
                : "—";
              return (
                <tr
                  key={m}
                  className={`border-t border-border ${on ? "bg-accent/10" : ""}`}
                  data-testid={`row-month-${m}`}
                >
                  <td className={`sticky left-0 z-10 px-4 py-3 font-medium text-foreground ${on ? "border-l-2 border-primary bg-accent/10" : "bg-card"}`}>{m}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{score != null ? score.toFixed(1) : "—"}</td>
                  <td className="px-4 py-3">{hasValidScore ? <SeasonBadge label={r.seasonLabel} /> : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{windyDays != null ? (windyDays === 0 ? "0.0" : windyDays) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{kiteHours != null ? (kiteHours === 0 ? "0.0" : `${kiteHours} h`) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{avgWind != null ? (avgWind === 0 ? "0.0 kn" : `${avgWind} kn`) : "—"}</td>
                  {hasWindType && <td className="px-4 py-3 text-muted-foreground">{windTypeLabel}</td>}
                  {hasWaves    && <td className="px-4 py-3 text-right tabular-nums">{r.avgWaveHeightM != null ? (r.avgWaveHeightM === 0 ? "0.0 m" : `${r.avgWaveHeightM} m`) : "—"}</td>}
                  {hasWavePeriod && <td className="px-4 py-3 text-right tabular-nums">{r.avgWavePeriodS != null ? (r.avgWavePeriodS === 0 ? "0.0 s" : `${r.avgWavePeriodS} s`) : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Wind in knots (10 m), wave height in metres. Monthly averages from Open-Meteo (2015–2024).</p>
    </section>
  );
}

// ── Monthly chart (area + axes, spec §10.2) ──────────────────────────────────
type ChartDataPoint = { month: string; value: number | null; selected: boolean };

function MonthlyChart({
  title, unit, data, yTicks, yDomain,
}: {
  title: string;
  unit: string;
  data: ChartDataPoint[];
  yTicks: number[];
  yDomain: [number | string, number | string];
}) {
  const xLabels = new Set(["Jan", "Apr", "Jul", "Oct"]);
  // Selected month indices for reference lines.
  const selectedMonths = data.map((d, i) => (d.selected ? i : -1)).filter(i => i >= 0);

  return (
    <div className="rounded-2xl border border-card-border bg-card p-4">
      <div className="mb-2 text-sm font-medium text-foreground">{title}</div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2d8290" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#2d8290" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          {/* Selected-month highlight bands */}
          {selectedMonths.map(idx => (
            <ReferenceLine
              key={idx}
              x={data[idx].month}
              stroke="hsl(var(--primary))"
              strokeOpacity={0.15}
              strokeWidth={20}
            />
          ))}
          <XAxis
            dataKey="month"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => xLabels.has(v) ? v : ""}
          />
          <YAxis
            domain={yDomain}
            ticks={yTicks}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => v === 0 ? "0" : `${v}`}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="hsl(var(--primary))"
            strokeWidth={1.75}
            fill={`url(#grad-${title})`}
            connectNulls={false}
            dot={(props: any) => {
              const { cx, cy, payload } = props;
              if (payload?.value == null) return <g key={`dot-${props.index}`} />;
              const r = payload.selected ? 4 : 2;
              return <circle key={`dot-${props.index}`} cx={cx} cy={cy} r={r} fill="hsl(var(--primary))" stroke="none" />;
            }}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
