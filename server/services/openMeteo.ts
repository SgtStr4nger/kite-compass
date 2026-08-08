/**
 * Open-Meteo enrichment service
 * ------------------------------------------------------------------
 * Fetches multi-year historical wind + wave data for a coordinate and
 * aggregates it into 12 monthly planning records (Jan–Dec).
 *
 * Provider: Open-Meteo (https://open-meteo.com) — free for non-commercial use.
 *   • Historical wind  → Archive API   https://archive-api.open-meteo.com/v1/archive
 *   • Historical waves → Marine API    https://marine-api.open-meteo.com/v1/marine
 *
 * ── Billing / pacing ───────────────────────────────────────────────────────
 * Open-Meteo meters the free tier by WEIGHTED "API calls", not raw requests:
 *     weight = nLocations × (nDays / 14) × (nVariables / 10)
 * with limits of 600/min, 5,000/hour, 10,000/day. With our 3,653-day window and
 * 3 variables per call, a single full spot enrichment (archive + marine) costs
 * ≈ 156.6 weighted calls (≈78.3 each), so a bulk run is deliberately paced well
 * under the budget by server/services/openMeteoBudget.ts. `fetchJson` enforces
 * the budget before each attempt and uses conservative exponential backoff
 * (plus Retry-After and window-aware waiting) on 429s. `MIN_REQUEST_GAP_MS` is
 * now only a politeness floor — the budget service does the real pacing.
 *
 * Units (canonical, matching the rest of the app):
 *   • Wind  → knots      (Archive API called with wind_speed_unit=kn)
 *   • Waves → metres     (Marine API length_unit=metric)
 *   • Period → seconds
 *
 * ── Historical window ────────────────────────────────────────────────
 * We aggregate a fixed 10-year window (see HISTORY_START_YEAR / HISTORY_END_YEAR).
 * Ten years smooths out unusual individual seasons and is well within the
 * archive's coverage (data from 1940 onward). Change the two constants below
 * to widen/narrow the window.
 *
 * ── Hourly metrics used ──────────────────────────────────────────────
 * The Archive API exposes hourly wind data plus daily sunrise/sunset so we can
 * isolate the kiteable part of the day instead of averaging all 24 hours.
 *   • wind_speed_10m              → hourly 10 m wind (knots)
 *   • sunrise / sunset            → daily daylight window
 * Marine daily aggregates:
 *   • wave_height_max, wave_period_max, wave_direction_dominant
 *
 * ── Kiteable window ──────────────────────────────────────────────────
 * The kiteable part of a day runs from sunrise − KITEABLE_DAY_SUN_MARGIN_MINUTES
 * to sunset + KITEABLE_DAY_SUN_MARGIN_MINUTES (spec §13.4: 60 min each side).
 * Since the window can cross midnight in UTC (sunrise near 00:00 UTC for
 * UTC+3…+6 spots, sunset near 24:00 UTC for UTC−3…−5 spots), each hourly slot
 * is tested against the day rows for its own date AND the neighbouring dates
 * (D−1, D, D+1), and counted at most once.
 *
 * ── Aggregation, per calendar month ──────────────────────────────────
 *   • avgKiteableWind10mKnots = mean wind speed across kiteable hours only
 *   • kiteableDaysCount       = average number of days per month with at least
 *                               minKiteableHours kiteable hours (configurable;
 *                               falls back to KITEABLE_DAY_MIN_HOURS)
 *   • avgKiteableHoursPerDay  = average kiteable hours per calendar day
 *   • avgWaveHeightM   = mean of daily wave_height_max
 *   • maxWaveHeightM   = max  of daily wave_height_max
 *   • avgWavePeriodS   = mean of daily wave_period_max
 *   • dominantWaveDirectionDeg = circular mean of daily wave_direction_dominant
 *
 * NOTE: The public wind number now reflects kiteable hours only. This is the
 * most kite-relevant planning view and keeps the metric easy to explain.
 */

import { waitForBudget, recordRequest, markWindowFull, getOpenMeteoBudget } from "./openMeteoBudget";

// ── Configuration ──────────────────────────────────────────────────────────
/** A day counts as kiteable when daylight hours hit this wind threshold. */
export const KITEABLE_WIND_THRESHOLD_KNOTS = 15;
/** A day counts as kiteable when it has at least this many kiteable daylight hours. */
export const KITEABLE_DAY_MIN_HOURS = 2;
/**
 * The kiteable daily window starts this many minutes before local sunrise and
 * ends this many minutes after local sunset (spec §13.4).
 */
export const KITEABLE_DAY_SUN_MARGIN_MINUTES = 60;
/** Historical window (inclusive). 10 full years. */
export const HISTORY_START_YEAR = 2015;
export const HISTORY_END_YEAR = 2024;
export const DEFAULT_DAYLIGHT_START = "06:00";
export const DEFAULT_DAYLIGHT_END = "18:00";

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const DATA_SOURCE = "open-meteo";

const openMeteoStats = {
  archiveRequests: 0,
  marineRequests: 0,
  failedRequests: 0,
};

/** Politeness floor between raw requests; the budget service does the real pacing. */
const MIN_REQUEST_GAP_MS = 250;
let lastRequestAt = 0;

async function waitForRequestSlot(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, lastRequestAt + MIN_REQUEST_GAP_MS - now);
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
  lastRequestAt = Date.now();
}

export function getOpenMeteoStats() {
  const budget = getOpenMeteoBudget();
  return {
    ...openMeteoStats,
    totalRequests: openMeteoStats.archiveRequests + openMeteoStats.marineRequests,
    perSpotCost: budget.perSpotCost,
    limits: budget.limits,
    usage: budget.usage,
    waitState: budget.waitState,
    pacing: { ...budget.pacing, requestGapFloorMs: MIN_REQUEST_GAP_MS },
  };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export interface EnrichedMonth {
  month: string;
  avgKiteableWind10mKnots: number | null;
  kiteableDaysCount: number | null;
  avgKiteableHoursPerDay: number | null;
  avgWaveHeightM: number | null;
  maxWaveHeightM: number | null;
  avgWavePeriodS: number | null;
  dominantWaveDirectionDeg: number | null;
}

export interface EnrichmentResult {
  months: EnrichedMonth[];        // exactly 12, Jan–Dec
  dataSource: string;             // 'open-meteo'
  refreshedAt: string;            // ISO timestamp
  qualityNote: string;            // '' on full success, otherwise a human note
  windAvailable: boolean;
  waveAvailable: boolean;
}

// Buckets keyed 0..11 (month index)
interface Bucket {
  kiteableWindSum: number; kiteableWindCount: number;
  kiteableHourSum: number;
  dayCount: number;
  kiteableDayHits: number;
  waveHSum: number; waveHCount: number; waveHPeak: number | null;
  wavePSum: number; wavePCount: number;
  dirSinSum: number; dirCosSum: number; dirCount: number;
}

function emptyBuckets(): Bucket[] {
  return Array.from({ length: 12 }, () => ({
    kiteableWindSum: 0, kiteableWindCount: 0, kiteableHourSum: 0, dayCount: 0, kiteableDayHits: 0,
    waveHSum: 0, waveHCount: 0, waveHPeak: null, wavePSum: 0, wavePCount: 0,
    dirSinSum: 0, dirCosSum: 0, dirCount: 0,
  }));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** Linear-interpolated percentile of a numeric array. p in 0..1. */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
const monthIndexFromISO = (d: string) => Number(d.slice(5, 7)) - 1; // "YYYY-MM-DD" → 0..11

/**
 * Shift a UTC ISO timestamp by a number of minutes and return it in the same
 * 16-char "YYYY-MM-DDTHH:MM" format the Open-Meteo Archive API returns for
 * sunrise/sunset and hourly times (lexicographic comparison stays valid).
 * Accepts the old 19-char "…THH:MM:SSZ" fallback form defensively.
 */
function shiftIsoMinutes(iso: string, deltaMin: number): string {
  const ms = Date.parse(iso.length === 16 ? `${iso}:00Z` : iso);
  return new Date(ms + deltaMin * 60_000).toISOString().slice(0, 16);
}

/** Shift a "YYYY-MM-DD" date by a number of days (UTC-safe, handles month/year rollover). */
const shiftDate = (d: string, days: number) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + days)).toISOString().slice(0, 10);
};

/** Conservative exponential backoff (ms) with jitter, capped at 60s. */
function backoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500), 60_000);
}

async function fetchJson(url: string): Promise<any> {
  const isArchive = url.includes("archive-api.open-meteo.com");
  const isMarine = url.includes("marine-api.open-meteo.com");
  const attempts = 5;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await waitForRequestSlot();
    if (isArchive) openMeteoStats.archiveRequests++;
    if (isMarine) openMeteoStats.marineRequests++;
    // Enforce the weighted budget before each attempt. Long waits are surfaced
    // to the admin banner via the wait listener (throttled inside the service).
    await waitForBudget(url);
    const res = await fetch(url);
    if (res.ok) {
      recordRequest(url, res.status); // billable consumption counts toward the meters
      return res.json();
    }

    openMeteoStats.failedRequests++;
    let detail = res.statusText;
    try { const j = await res.json(); if (j?.reason) detail = j.reason; } catch { /* ignore */ }
    lastError = new Error(`Open-Meteo ${res.status}: ${detail}`);
    const retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
    if (!retryable || attempt === attempts) break;

    let waitMs: number;
    if (res.status === 429) {
      // Treat the current minute/hour/day windows as exhausted until they roll
      // over — the next attempt will wait on the budget instead of blind retries.
      markWindowFull();
      const retryAfter = Number(res.headers.get("retry-after"));
      waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 300_000)
        : backoffMs(attempt);
    } else {
      waitMs = backoffMs(attempt);
    }
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  throw lastError ?? new Error("Open-Meteo request failed");
}

/** Number of distinct calendar years in the window (for per-month day averaging). */
function yearsInWindow(): number {
  return HISTORY_END_YEAR - HISTORY_START_YEAR + 1;
}

/**
 * Enrich a single coordinate. Wind and wave are fetched independently so that a
 * marine-model gap (common for inland/lagoon spots) still yields wind data.
 * Throws only when the WIND fetch fails (wind is the core signal); wave failure
 * degrades gracefully and is recorded in qualityNote.
 *
 * `minKiteableHours` is the configurable threshold for what counts as a
 * "kiteable day" (spec §14.5); defaults to the KITEABLE_DAY_MIN_HOURS constant.
 */
export async function enrichCoordinate(latitude: number, longitude: number, minKiteableHours: number = KITEABLE_DAY_MIN_HOURS): Promise<EnrichmentResult> {
  const start = `${HISTORY_START_YEAR}-01-01`;
  const end = `${HISTORY_END_YEAR}-12-31`;
  const buckets = emptyBuckets();
  const notes: string[] = [];

  const dayMap = new Map<string, {
    monthIndex: number;
    windowStart: string;
    windowEnd: string;
    kiteableWindSum: number;
    kiteableWindCount: number;
    kiteableHourCount: number;
  }>();

  // ── Wind (Archive API) — required ──
  const windUrl =
    `${ARCHIVE_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&start_date=${start}&end_date=${end}` +
    `&hourly=wind_speed_10m` +
    `&daily=sunrise,sunset` +
    `&wind_speed_unit=kn&timezone=UTC`;

  const wind = await fetchJson(windUrl); // throws on failure → caller keeps existing data
  const dayTime: string[] = wind?.daily?.time ?? [];
  const sunrise: string[] = wind?.daily?.sunrise ?? [];
  const sunset: string[] = wind?.daily?.sunset ?? [];
  for (let i = 0; i < dayTime.length; i++) {
    const date = dayTime[i];
    const rawSunrise = sunrise[i] ?? `${date}T${DEFAULT_DAYLIGHT_START}`;
    const rawSunset = sunset[i] ?? `${date}T${DEFAULT_DAYLIGHT_END}`;
    dayMap.set(date, {
      monthIndex: monthIndexFromISO(date),
      windowStart: shiftIsoMinutes(rawSunrise, -KITEABLE_DAY_SUN_MARGIN_MINUTES),
      windowEnd: shiftIsoMinutes(rawSunset, +KITEABLE_DAY_SUN_MARGIN_MINUTES),
      kiteableWindSum: 0,
      kiteableWindCount: 0,
      kiteableHourCount: 0,
    });
  }

  const hourlyTimes: string[] = wind?.hourly?.time ?? [];
  const hourlyWind: (number | null)[] = wind?.hourly?.wind_speed_10m ?? [];
  for (let i = 0; i < hourlyTimes.length; i++) {
    const time = hourlyTimes[i];
    const date = time.slice(0, 10);
    if (!dayMap.has(date)) continue;
    const w = hourlyWind[i];
    if (w == null || !Number.isFinite(w)) continue;
    // The kiteable window can cross midnight UTC (sunrise−60min lands on the
    // previous UTC date, sunset+60min on the next), so test the hour against the
    // day rows for its own date AND the neighbouring dates; count it at most once.
    const inWindow = (day: { windowStart: string; windowEnd: string } | undefined) =>
      day != null && time >= day.windowStart && time < day.windowEnd;
    const day = dayMap.get(date)!; // guarded by dayMap.has(date) above
    if (!(inWindow(day) ||
          inWindow(dayMap.get(shiftDate(date, -1))) ||
          inWindow(dayMap.get(shiftDate(date, 1))))) continue;
    if (w >= KITEABLE_WIND_THRESHOLD_KNOTS) {
      day.kiteableHourCount++;
      day.kiteableWindSum += w;
      day.kiteableWindCount++;
    }
  }

  for (const day of Array.from(dayMap.values())) {
    const b = buckets[day.monthIndex];
    b.dayCount++;
    b.kiteableHourSum += day.kiteableHourCount;
    b.kiteableWindSum += day.kiteableWindSum;
    b.kiteableWindCount += day.kiteableWindCount;
    if (day.kiteableHourCount >= minKiteableHours) b.kiteableDayHits++;
  }
  const windAvailable = hourlyTimes.length > 0 && dayMap.size > 0;

  // ── Waves (Marine API) — optional, best-effort ──
  let waveAvailable = false;
  try {
    const waveUrl =
      `${MARINE_URL}?latitude=${latitude}&longitude=${longitude}` +
      `&start_date=${start}&end_date=${end}` +
      `&daily=wave_height_max,wave_period_max,wave_direction_dominant` +
      `&length_unit=metric&timezone=UTC`;
    const wave = await fetchJson(waveUrl);
    const vTime: string[] = wave?.daily?.time ?? [];
    const hMax: (number | null)[] = wave?.daily?.wave_height_max ?? [];
    const pMax: (number | null)[] = wave?.daily?.wave_period_max ?? [];
    const dDom: (number | null)[] = wave?.daily?.wave_direction_dominant ?? [];
    let anyWave = false;
    for (let i = 0; i < vTime.length; i++) {
      const mi = monthIndexFromISO(vTime[i]);
      const b = buckets[mi];
      const h = hMax[i];
      if (h != null && Number.isFinite(h)) {
        b.waveHSum += h; b.waveHCount++; anyWave = true;
        b.waveHPeak = b.waveHPeak == null ? h : Math.max(b.waveHPeak, h);
      }
      const p = pMax[i];
      if (p != null && Number.isFinite(p)) { b.wavePSum += p; b.wavePCount++; }
      const d = dDom[i];
      if (d != null && Number.isFinite(d)) {
        const rad = (d * Math.PI) / 180;
        b.dirSinSum += Math.sin(rad); b.dirCosSum += Math.cos(rad); b.dirCount++;
      }
    }
    waveAvailable = anyWave;
    if (!anyWave) notes.push("No wave-model coverage for this location (inland/lagoon); wave fields left empty.");
  } catch (e: any) {
    notes.push(`Wave data unavailable (${e?.message ?? "marine fetch failed"}); wind data still applied.`);
  }

  if (!windAvailable) notes.push("No wind data returned for this location.");

  const years = yearsInWindow();
  const months: EnrichedMonth[] = buckets.map((b, mi) => {
    const avgWind = b.kiteableWindCount > 0 ? round1(b.kiteableWindSum / b.kiteableWindCount) : null;
    const kiteableDays = b.dayCount > 0 ? Math.round(b.kiteableDayHits / years) : null;
    const avgKiteableHours = b.dayCount > 0 ? round1(b.kiteableHourSum / b.dayCount) : null;
    const avgWaveH = b.waveHCount > 0 ? round1(b.waveHSum / b.waveHCount) : null;
    const maxWaveH = b.waveHPeak != null ? round1(b.waveHPeak) : null;
    const avgWaveP = b.wavePCount > 0 ? round1(b.wavePSum / b.wavePCount) : null;
    let domDir: number | null = null;
    if (b.dirCount > 0) {
      let deg = (Math.atan2(b.dirSinSum, b.dirCosSum) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      domDir = Math.round(deg);
    }
    return {
      month: MONTHS[mi],
      avgKiteableWind10mKnots: avgWind,
      kiteableDaysCount: kiteableDays,
      avgKiteableHoursPerDay: avgKiteableHours,
      avgWaveHeightM: avgWaveH,
      maxWaveHeightM: maxWaveH,
      avgWavePeriodS: avgWaveP,
      dominantWaveDirectionDeg: domDir,
    };
  });

  return {
    months,
    dataSource: DATA_SOURCE,
    refreshedAt: new Date().toISOString(),
    qualityNote: notes.join(" "),
    windAvailable,
    waveAvailable,
  };
}
