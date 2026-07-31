import { useMemo } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/SiteChrome";
import { SpotMap } from "@/components/SpotMap";
import { ScoreBadge, SeasonBadge, Chip } from "@/components/Badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SpotDetail as SpotDetailT, MonthlyRecord, MONTHS, SEASON_META, tagLabel } from "@/lib/types";
import { getHashSearch } from "@/lib/filterParams";
import { Wind, Gauge, CalendarDays, MapPin, Plane, ExternalLink, ArrowLeft, Navigation, Waves } from "lucide-react";
import placeholderSpot from "@/assets/placeholder-spot.jpg";

const PLACEHOLDER = placeholderSpot;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalize(value: number, min: number, max: number) {
  if (max <= min) return 0;
  return clamp01((value - min) / (max - min));
}

function weatherScore(rec: MonthlyRecord) {
  const wind = rec.avgKiteableWind10mKnots ?? rec.averageBaseWind;
  const days = rec.kiteableDaysCount ?? rec.windDays;
  const hours = rec.avgKiteableHoursPerDay;
  const parts: { value: number; weight: number }[] = [];
  if (wind != null && Number.isFinite(wind)) parts.push({ value: normalize(wind, 12, 25), weight: 0.5 });
  if (days != null && Number.isFinite(days)) parts.push({ value: normalize(days, 3, 20), weight: 0.3 });
  if (hours != null && Number.isFinite(hours)) parts.push({ value: normalize(hours, 1, 6), weight: 0.2 });
  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const weighted = parts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight;
  return Math.round(weighted * 100) / 10;
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
    // otherwise the best weather-scoring month
    const scored = [...spot.monthly].sort((a, b) => {
      return ((b.automaticWindScore ?? weatherScore(b)) ?? -1) - ((a.automaticWindScore ?? weatherScore(a)) ?? -1);
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
  const activeScore = activeRec ? (activeRec.automaticWindScore ?? weatherScore(activeRec)) : null;

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
            <WhenItWorksBest monthly={monthlySorted} selectedMonth={selectedMonth} />
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

// ── "When it works best" — season strip + two sparklines + 12-month table ──
function WhenItWorksBest({ monthly, selectedMonth }: { monthly: MonthlyRecord[]; selectedMonth: string | null }) {
  // Always render all 12 months in fixed Jan–Dec order; missing months show as gaps.
  const byMonth = new Map(monthly.map(m => [m.month, m]));
  const rows = MONTHS.map(m => byMonth.get(m) ?? null);
  const hasAny = monthly.length > 0;

  const windSeries = rows.map(r => (r?.avgKiteableWind10mKnots ?? r?.averageBaseWind ?? null));
  const windyDaySeries = rows.map(r => (r?.kiteableDaysCount ?? r?.windDays ?? null));
  const hasWaves = monthly.some(m => m.avgWaveHeightM != null);
  const hasWavePeriod = monthly.some(m => m.avgWavePeriodS != null);

  // Summary numbers for the sparkline labels.
  const windVals = windSeries.filter((v): v is number => v != null);
  const windyVals = windyDaySeries.filter((v): v is number => v != null);
  const peakWind = windVals.length ? Math.max(...windVals) : null;
  const peakWindyDays = windyVals.length ? Math.max(...windyVals) : null;

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

      {/* Season strip — Jan–Dec, colour-coded by season label */}
      <div className="mt-4">
        <div className="flex gap-1" data-testid="season-strip">
          {MONTHS.map((m, i) => {
            const rec = rows[i];
            const meta = rec ? SEASON_META[rec.seasonLabel] : undefined;
            const on = selectedMonth === m;
            return (
              <div key={m} className="flex-1 text-center" title={rec ? `${m} · ${meta?.label ?? rec.seasonLabel}` : m}>
                <div className={`h-8 rounded-md ${meta ? meta.dot : "bg-stone-200"} ${on ? "ring-2 ring-offset-1 ring-foreground/40" : ""}`} />
                <div className="mt-1 text-[10px] font-medium uppercase text-muted-foreground">{m.slice(0, 1)}</div>
              </div>
            );
          })}
        </div>
        {/* legend */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {(["peak", "side", "off"] as const).map(k => (
            <span key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-2.5 w-2.5 rounded-sm ${SEASON_META[k].dot}`} /> {SEASON_META[k].label}
            </span>
          ))}
        </div>
      </div>

      {/* Two sparklines — avg wind, windy days */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <SparkCard
          label="Average kiteable wind through the year"
          summary={peakWind != null ? `up to ${peakWind} kn` : "—"}
          series={windSeries}
          unit="kn"
        />
        <SparkCard
          label="Kiteable days through the year"
          summary={peakWindyDays != null ? `up to ${peakWindyDays} / mo` : "—"}
          series={windyDaySeries}
          unit="days"
        />
      </div>

      {/* Detailed 12-month table */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-card-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Month</th>
              <th className="px-4 py-3 font-medium">Season</th>
              <th className="px-4 py-3 text-right font-medium">Kiteable wind</th>
              <th className="px-4 py-3 text-right font-medium">Kiteable days</th>
              <th className="px-4 py-3 text-right font-medium">Hours/day</th>
              {hasWaves && <th className="px-4 py-3 text-right font-medium">Avg wave</th>}
              {hasWavePeriod && <th className="px-4 py-3 text-right font-medium">Wave period</th>}
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((m, i) => {
              const r = rows[i];
              const on = selectedMonth === m;
              const cols = 5 + (hasWaves ? 1 : 0) + (hasWavePeriod ? 1 : 0);
              if (!r) {
                return (
                  <tr key={m} className="border-t border-border text-muted-foreground/70">
                    <td className="px-4 py-3 font-medium">{m}</td>
                    <td className="px-4 py-3" colSpan={cols - 1}>—</td>
                  </tr>
                );
              }
              const avgWind = r.avgKiteableWind10mKnots ?? r.averageBaseWind;
              const windyDays = r.kiteableDaysCount ?? r.windDays;
              const kiteHours = r.avgKiteableHoursPerDay;
              return (
                <tr key={m} className={`border-t border-border ${on ? "bg-accent/10" : ""}`} data-testid={`row-month-${m}`}>
                  <td className="px-4 py-3 font-medium text-foreground">{m}</td>
                  <td className="px-4 py-3"><SeasonBadge label={r.seasonLabel} /></td>
                  <td className="px-4 py-3 text-right tabular-nums">{avgWind != null ? `${avgWind} kn` : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{windyDays != null ? windyDays : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{kiteHours != null ? `${kiteHours} h` : "—"}</td>
                  {hasWaves && <td className="px-4 py-3 text-right tabular-nums">{r.avgWaveHeightM != null ? `${r.avgWaveHeightM} m` : "—"}</td>}
                  {hasWavePeriod && <td className="px-4 py-3 text-right tabular-nums">{r.avgWavePeriodS != null ? `${r.avgWavePeriodS} s` : "—"}</td>}
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

// Compact, axis-less sparkline card. Supportive, not dominant.
function SparkCard({ label, summary, series, unit }: { label: string; summary: string; series: (number | null)[]; unit: string }) {
  const W = 240, H = 44, pad = 3;
  const vals = series.map(v => (v == null ? null : v));
  const nums = vals.filter((v): v is number => v != null);
  const min = nums.length ? Math.min(...nums) : 0;
  const max = nums.length ? Math.max(...nums) : 1;
  const range = max - min || 1;
  const n = series.length;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (v: number) => H - pad - ((v - min) / range) * (H - 2 * pad);
  // Build a path, breaking across null months.
  let d = ""; let started = false;
  vals.forEach((v, i) => {
    if (v == null) { started = false; return; }
    d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    started = true;
  });
  let peakIdx = -1;
  vals.forEach((v, i) => {
    if (v != null && (peakIdx < 0 || (vals[peakIdx] ?? -Infinity) < v)) peakIdx = i;
  });
  const peakVal = peakIdx >= 0 ? vals[peakIdx] : null;
  return (
    <div className="rounded-2xl border border-card-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{summary}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-11 w-full" preserveAspectRatio="none" aria-hidden="true">
        <path d={d} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
        {peakVal != null && (
          <circle cx={x(peakIdx)} cy={y(peakVal)} r={2.4} fill="hsl(var(--primary))" />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground/70">
        <span>Jan</span><span>Dec</span>
      </div>
    </div>
  );
}
