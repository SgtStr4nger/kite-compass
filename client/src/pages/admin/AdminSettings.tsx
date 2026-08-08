import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { AdminLayout } from "./AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { OpenMeteoUsage, WeatherRefreshStatus } from "@/lib/types";
import { Info, Timer, CloudSun } from "lucide-react";

const fmt = (n: number, digits = 1) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const over = used > limit;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${over ? "text-rose-700" : "text-foreground"}`}>
          {fmt(used, 0)} / {fmt(limit, 0)}
        </span>
      </div>
      <Progress value={pct} className={over ? "bg-rose-200" : undefined} />
      {over && <p className="mt-1 text-xs text-rose-700">Window full — enrichment waits until it rolls over.</p>}
    </div>
  );
}

function WaitNotice({ usage }: { usage: OpenMeteoUsage }) {
  const w = usage.waitState;
  if (!w?.active) return null;
  const resumesAt = w.resumesAt ? new Date(w.resumesAt).toLocaleTimeString() : "soon";
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <Timer className="h-4 w-4 shrink-0" />
      <span>
        Waiting for Open-Meteo <strong>{w.window}</strong> budget — resumes {resumesAt}.
      </span>
    </div>
  );
}

export default function AdminSettings() {
  const { token } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => { if (!token) navigate("/admin"); }, [token, navigate]);

  const { data: weather } = useQuery<WeatherRefreshStatus>({
    queryKey: ["/api/admin/weather-refresh/status"],
    enabled: !!token,
    refetchInterval: 5000,
  });

  const { data: usage, isLoading } = useQuery<OpenMeteoUsage>({
    queryKey: ["/api/admin/usage/open-meteo"],
    enabled: !!token,
    refetchInterval: weather?.active ? 2000 : 30_000,
  });

  const pacing = usage?.pacing;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Open-Meteo usage and enrichment pacing.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CloudSun className="h-4 w-4" />
              API Usage — Open-Meteo
            </CardTitle>
            <CardDescription>
              Free/non-commercial tier is metered by weighted calls (600/min · 5,000/h · 10,000/day), not raw request count.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isLoading || !usage ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <>
                <WaitNotice usage={usage} />

                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Per-spot cost:</span>
                  <span className="font-medium">≈ {fmt(usage.perSpotCost.total)} weighted calls</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        weight = nLocations × (nDays ÷ 14) × (nVariables ÷ 10), derived from the real request params.
                        archive {fmt(usage.perSpotCost.archive.weight)} (sunrise/sunset + wind) + marine {fmt(usage.perSpotCost.marine.weight)} (wave) over a {usage.perSpotCost.nDays}-day window.
                        Limits: {usage.limits.minute}/min · {usage.limits.hour}/hour · {usage.limits.day}/day.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <div className="space-y-3">
                  <UsageBar label="Minute" used={usage.usage.minute.used} limit={usage.usage.minute.limit} />
                  <UsageBar label="Hour" used={usage.usage.hour.used} limit={usage.usage.hour.limit} />
                  <UsageBar label="Day" used={usage.usage.day.used} limit={usage.usage.day.limit} />
                </div>

                <div className="rounded-lg border border-card-border bg-muted/30 p-3 text-sm text-muted-foreground">
                  <div className="mb-1 font-medium text-foreground">Pacing</div>
                  <div>
                    Auto (budget-driven) — ≈{fmt(pacing?.effectiveSpotsPerMinute ?? 0, 2)} spots/min at the minute
                    limit; a full re-enrich of all spots takes roughly a day under the day limit. Pacing only adapts when
                    a limit is actually hit.
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  Requests this server process: {fmt(usage.totalRequests, 0)} total ({fmt(usage.archiveRequests, 0)} archive,{" "}
                  {fmt(usage.marineRequests, 0)} marine, {fmt(usage.failedRequests, 0)} failed).
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
