import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminSpotListItem, ScoringAdminState, ScoringConfig, SpotDetail, MONTHS, SEASON_META } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { calculateAutoMonthlyScore, bestEvaluableScore, deriveSeasonLabelFromScore, resolveMonthlyScore } from "@shared/scoring";
import { ArrowLeft, Search, UploadCloud } from "lucide-react";
import { SeasonBadge } from "@/components/Badges";

const FIELD_GROUPS: Array<{ title: string; hint: string; fields: Array<{ key: keyof ScoringConfig; label: string; step?: string; min?: number; max?: number; helper?: string }> }> = [
  {
    title: "Score weights",
    hint: "Weights used by the monthly Travel Score formula.",
    fields: [
      { key: "kiteableDaysWeight", label: "Kiteable days weight", step: "0.01", min: 0, max: 1 },
      { key: "kiteableHoursWeight", label: "Kiteable hours/day weight", step: "0.01", min: 0, max: 1 },
      { key: "windStrengthWeight", label: "Average wind weight", step: "0.01", min: 0, max: 1 },
      { key: "gustinessWeight", label: "Gustiness weight", step: "0.01", min: 0, max: 1 },
    ],
  },
  {
    title: "Wind thresholds",
    hint: "Thresholds that shape the wind component before it is weighted.",
    fields: [
      { key: "kiteableHoursMax", label: "Max kiteable hours/day", step: "0.1", min: 0 },
      { key: "windMinKnots", label: "Minimum wind (knots)", step: "0.1", min: 0 },
      { key: "windBestStartKnots", label: "Best wind start (knots)", step: "0.1", min: 0 },
      { key: "windBestEndKnots", label: "Best wind end (knots)", step: "0.1", min: 0 },
      { key: "windCutoffKnots", label: "Wind cutoff (knots)", step: "0.1", min: 0 },
      { key: "gustMeanWeight", label: "Gust mean weight", step: "0.01", min: 0, max: 1 },
      { key: "gustGoodThresholdPct", label: "Good gust threshold (%)", step: "0.1", min: 0 },
      { key: "gustBadThresholdPct", label: "Bad gust threshold (%)", step: "0.1", min: 0 },
    ],
  },
  {
    title: "Season thresholds",
    hint: "Relative season tiers used everywhere Season is shown.",
    fields: [
      { key: "seasonPeakThreshold", label: "Peak threshold", step: "0.01", min: 0, max: 1, helper: "Share of the spot's best evaluable monthly score." },
      { key: "seasonSideThreshold", label: "Mid threshold", step: "0.01", min: 0, max: 1, helper: "Below Peak and above Off." },
    ],
  },
  {
    title: "Scoring period",
    hint: "Rolling average window for the kiteable-days component.",
    fields: [
      { key: "startYear", label: "Start year", step: "1", min: 2000, max: 2100 },
      { key: "endYear", label: "End year", step: "1", min: 2000, max: 2100 },
    ],
  },
];

export default function AdminScoring() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSpotId, setSelectedSpotId] = useState<number | null>(null);
  const [form, setForm] = useState<ScoringConfig | null>(null);

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);

  const { data: scoring, isLoading: scoringLoading, refetch: refetchScoring } = useQuery<ScoringAdminState>({
    queryKey: ["/api/admin/scoring"],
    enabled: !!token,
  });
  const { data: spots = [] } = useQuery<AdminSpotListItem[]>({
    queryKey: ["/api/admin/spots"],
    enabled: !!token,
  });
  const { data: selectedSpot, isLoading: selectedLoading } = useQuery<SpotDetail>({
    queryKey: [`/api/admin/spots/${selectedSpotId}`],
    enabled: !!token && selectedSpotId != null,
  });

  useEffect(() => {
    if (!scoring) return;
    setForm(scoring.draft);
  }, [scoring]);

  const filteredSpots = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return spots;
    return spots.filter((spot) => [spot.name, spot.country, spot.region].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [spots, search]);

  const previewRows = useMemo(() => {
    if (!selectedSpot || !form) return [];
    const mode = selectedSpot.rankingMode === "manual" ? "manual" : "auto";
    const scores = MONTHS.map((month) => {
      const row = selectedSpot.monthly.find((item) => item.month === month) ?? null;
      if (!row) return null;
      return mode === "auto" ? calculateAutoMonthlyScore(row, form) : resolveMonthlyScore(row, mode);
    });
    const bestScore = bestEvaluableScore(scores);
    return MONTHS.map((month, index) => {
      const row = selectedSpot.monthly.find((item) => item.month === month) ?? null;
      const score = scores[index];
      return {
        month,
        row,
        score,
        seasonLabel: deriveSeasonLabelFromScore(score, bestScore, form),
      };
    });
  }, [selectedSpot, form]);

  const setField = <K extends keyof ScoringConfig>(key: K, value: number) => {
    setForm((current) => current ? { ...current, [key]: value } : current);
  };

  const publish = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await api("POST", "/api/admin/scoring/publish", form);
      toast({ title: "Scoring publish started", description: "Scores are recalculating in the background." });
      await refetchScoring();
    } catch (e: any) {
      toast({ title: "Could not publish scoring", description: String(e.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => navigate("/admin/data");

  return (
    <AdminLayout>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={dismiss}>
              <ArrowLeft className="h-4 w-4" /> Data
            </button>
            <span>/</span>
            <span>Configure scoring</span>
          </div>
          <h1 className="font-serif text-2xl font-semibold text-foreground">Configure scoring</h1>
          <p className="text-sm text-muted-foreground">Edit the draft scoring parameters, preview a spot, then publish to recalculate all scores.</p>
          {scoring?.publishedAt ? <p className="mt-1 text-xs text-muted-foreground">Last published: {new Date(scoring.publishedAt).toLocaleString()}</p> : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={dismiss} disabled={busy} data-testid="button-scoring-dismiss">
            Dismiss
          </Button>
          <Button onClick={publish} disabled={busy || !form} data-testid="button-scoring-publish">
            <UploadCloud className="mr-2 h-4 w-4" /> {busy ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>

      {scoringLoading || !form ? (
        <Skeleton className="h-80 w-full rounded-2xl" />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            {FIELD_GROUPS.map((group) => (
              <Card key={group.title}>
                <CardHeader>
                  <CardTitle>{group.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">{group.hint}</p>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  {group.fields.map((field) => (
                    <div key={String(field.key)} className="space-y-1.5">
                      <Label>{field.label}</Label>
                      <Input
                        type="number"
                        step={field.step}
                        min={field.min}
                        max={field.max}
                        value={String(form[field.key])}
                        onChange={(e) => setField(field.key, Number(e.target.value))}
                      />
                      {field.helper ? <p className="text-xs text-muted-foreground">{field.helper}</p> : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Spot preview</CardTitle>
              <p className="text-sm text-muted-foreground">Search a spot and preview its monthly score table with the current draft configuration.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_20rem]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                    placeholder="Search spot…"
                  />
                </div>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedSpotId ?? ""}
                  onChange={(e) => setSelectedSpotId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Select a spot</option>
                  {filteredSpots.map((spot) => (
                    <option key={spot.id} value={spot.id}>{spot.name} — {spot.country || "—"}</option>
                  ))}
                </select>
              </div>

              {!selectedSpotId ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-sm text-muted-foreground">Choose a spot to preview its monthly table.</div>
              ) : selectedLoading || !selectedSpot ? (
                <Skeleton className="h-72 w-full rounded-2xl" />
              ) : (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-serif text-xl font-semibold text-foreground">{selectedSpot.name}</h3>
                    <p className="text-sm text-muted-foreground">{[selectedSpot.region, selectedSpot.country].filter(Boolean).join(", ") || "—"}</p>
                  </div>

                  <div className="flex gap-1" data-testid="season-strip-scoring-preview">
                    {previewRows.map(({ month, seasonLabel }, index) => (
                      <div key={month} className="flex-1 text-center" title={`${month} · ${SEASON_META[seasonLabel].label}`}>
                        <div className={`h-8 rounded-md ${SEASON_META[seasonLabel].dot}`} />
                        <div className="mt-1 text-[10px] font-medium uppercase text-muted-foreground">{MONTHS[index].slice(0, 1)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-card-border">
                    <table className="w-full text-sm">
                      <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="sticky left-0 z-10 bg-secondary/60 px-4 py-3 font-medium">Month</th>
                          <th className="px-4 py-3 text-right font-medium">Score</th>
                          <th className="px-4 py-3 font-medium">Season</th>
                          <th className="px-4 py-3 text-right font-medium">Kiteable days</th>
                          <th className="px-4 py-3 text-right font-medium">Hours/day</th>
                          <th className="px-4 py-3 text-right font-medium">Avg wind</th>
                          <th className="px-4 py-3 font-medium">Wind type</th>
                          <th className="px-4 py-3 text-right font-medium">Wave height</th>
                          <th className="px-4 py-3 text-right font-medium">Wave period</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map(({ month, row, score, seasonLabel }) => {
                          const avgWind = row?.avgKiteableWind10mKnots ?? row?.averageBaseWind ?? null;
                          const windyDays = row?.kiteableDaysCount ?? row?.windDays ?? null;
                          const kiteHours = row?.avgKiteableHoursPerDay ?? null;
                          const primaryWT = row?.primaryWindType ?? null;
                          const secondaryWT = row?.secondaryWindType ?? null;
                          const windTypeLabel = primaryWT ? secondaryWT ? `${primaryWT} / ${secondaryWT}` : primaryWT : "—";
                          return (
                            <tr key={month} className="border-t border-border">
                              <td className="sticky left-0 z-10 bg-card px-4 py-3 font-medium text-foreground">{month}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{score != null ? score.toFixed(1) : "—"}</td>
                              <td className="px-4 py-3"><SeasonBadge label={seasonLabel} /></td>
                              <td className="px-4 py-3 text-right tabular-nums">{windyDays != null ? windyDays : "—"}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{kiteHours != null ? `${kiteHours} h` : "—"}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{avgWind != null ? `${avgWind} kn` : "—"}</td>
                              <td className="px-4 py-3 text-muted-foreground">{windTypeLabel}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{row?.avgWaveHeightM != null ? `${row.avgWaveHeightM} m` : "—"}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{row?.avgWavePeriodS != null ? `${row.avgWavePeriodS} s` : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}
