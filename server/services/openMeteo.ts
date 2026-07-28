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
 * ── Daily metrics used ───────────────────────────────────────────────
 * The Archive API exposes DAILY wind aggregates (no hourly fetch needed, so a
 * 10-year pull is ~3650 rows and returns in well under a second):
 *   • wind_speed_10m_max          → daily peak 10 m wind (knots)
 *   • wind_gusts_10m_max          → daily peak gust (knots)
 *   • wind_direction_10m_dominant → daily dominant direction (unused for now)
 * Marine daily aggregates:
 *   • wave_height_max, wave_period_max, wave_direction_dominant
 *
 * ── Aggregation, per calendar month ──────────────────────────────────
 *   • avgWind10mKnots  = mean of daily wind_speed_10m_max across all days of that month in the window
 *   • gustKnots        = a TYPICAL strong-day gust, defined as the GUST_PERCENTILE (default 90th)
 *                        percentile of daily wind_gusts_10m_max. We deliberately do NOT use the
 *                        all-time max: a single decade-extreme storm (e.g. 70 kn) is misleading on a
 *                        planning page. The 90th percentile answers "what do gusts reach on a strong
 *                        day here" while ignoring rare outliers. Falls back to the percentile of daily
 *                        wind_speed_10m_max when the gust series is unavailable.
 *   • windyDaysCount   = average number of days per month where wind_speed_10m_max >= WINDY_DAY_THRESHOLD_KNOTS
 *                        (rounded), i.e. total qualifying days / number of years in window.
 *   • avgWaveHeightM   = mean of daily wave_height_max
 *   • maxWaveHeightM   = max  of daily wave_height_max
 *   • avgWavePeriodS   = mean of daily wave_period_max
 *   • dominantWaveDirectionDeg = circular mean of daily wave_direction_dominant
 *
 * NOTE: "avg wind" here is the mean of daily *maxima*, not a 24h mean. For a
 * planning tool this better reflects the ridable part of the day and keeps the
 * fetch light. This choice is documented in the README as well.
 */

// ── Configuration ──────────────────────────────────────────────────────────
/** A day counts as "windy" when the daily max 10 m wind is at or above this many knots. Single source of truth. */
export const WINDY_DAY_THRESHOLD_KNOTS = 18;
/** Historical window (inclusive). 10 full years. */
export const HISTORY_START_YEAR = 2015;
export const HISTORY_END_YEAR = 2024;
/**
 * Percentile (0..1) used to derive the "typical strong-day gust" from daily gust maxima.
 * 0.90 = the gust level reached on the windiest ~10% of days, i.e. a strong-but-normal day,
 * NOT the once-a-decade storm peak. Lower this for a calmer figure, raise it toward 1 for a
 * more extreme one.
 */
export const GUST_PERCENTILE = 0.90;

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const DATA_SOURCE = "open-meteo";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export interface EnrichedMonth {
  month: string;
  avgWind10mKnots: number | null;
  /** Typical strong-day gust (GUST_PERCENTILE of daily gusts), not the all-time extreme. */
  gustKnots: number | null;
  windyDaysCount: number | null;
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
  windMaxSum: number; windMaxCount: number;
  gustSeries: number[];                    // daily gust maxima (for percentile)
  windSeries: number[];                    // daily wind maxima (percentile fallback)
  windyDayHits: number;                    // count of days >= threshold
  waveHSum: number; waveHCount: number; waveHPeak: number | null;
  wavePSum: number; wavePCount: number;
  dirSinSum: number; dirCosSum: number; dirCount: number;
}

function emptyBuckets(): Bucket[] {
  return Array.from({ length: 12 }, () => ({
    windMaxSum: 0, windMaxCount: 0, gustSeries: [], windSeries: [], windyDayHits: 0,
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

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); if (j?.reason) detail = j.reason; } catch { /* ignore */ }
    throw new Error(`Open-Meteo ${res.status}: ${detail}`);
  }
  return res.json();
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
 */
export async function enrichCoordinate(latitude: number, longitude: number): Promise<EnrichmentResult> {
  const start = `${HISTORY_START_YEAR}-01-01`;
  const end = `${HISTORY_END_YEAR}-12-31`;
  const buckets = emptyBuckets();
  const notes: string[] = [];

  // ── Wind (Archive API) — required ──
  const windUrl =
    `${ARCHIVE_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&start_date=${start}&end_date=${end}` +
    `&daily=wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant` +
    `&wind_speed_unit=kn&timezone=UTC`;

  const wind = await fetchJson(windUrl); // throws on failure → caller keeps existing data
  const wTime: string[] = wind?.daily?.time ?? [];
  const wMax: (number | null)[] = wind?.daily?.wind_speed_10m_max ?? [];
  const gMax: (number | null)[] = wind?.daily?.wind_gusts_10m_max ?? [];
  for (let i = 0; i < wTime.length; i++) {
    const mi = monthIndexFromISO(wTime[i]);
    const b = buckets[mi];
    const w = wMax[i];
    if (w != null && Number.isFinite(w)) {
      b.windMaxSum += w; b.windMaxCount++;
      b.windSeries.push(w);
      if (w >= WINDY_DAY_THRESHOLD_KNOTS) b.windyDayHits++;
    }
    const g = gMax[i];
    if (g != null && Number.isFinite(g)) b.gustSeries.push(g);
  }
  const windAvailable = wTime.length > 0;

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
    const avgWind = b.windMaxCount > 0 ? round1(b.windMaxSum / b.windMaxCount) : null;
    // Typical strong-day gust = high percentile of daily gusts (NOT the all-time extreme).
    // Fall back to the percentile of daily wind maxima when the gust series is missing.
    const gustPct = percentile(b.gustSeries, GUST_PERCENTILE) ?? percentile(b.windSeries, GUST_PERCENTILE);
    const gust = gustPct != null ? round1(gustPct) : null;
    const windyDays = b.windMaxCount > 0 ? Math.round(b.windyDayHits / years) : null;
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
      avgWind10mKnots: avgWind,
      gustKnots: gust,
      windyDaysCount: windyDays,
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
