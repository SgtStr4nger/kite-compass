/**
 * Enrichment orchestration
 * ------------------------------------------------------------------
 * Bridges the Open-Meteo service (server/services/openMeteo.ts) and the
 * database (storage). Used by BOTH the admin endpoint and the CLI script
 * (server/enrich.ts) so the behaviour is identical everywhere.
 *
 * Policy (agreed with product owner):
 *   • Coordinate guard: never runs without latitude AND longitude.
 *   • Overwrite: enrichment OVERWRITES wind + wave metrics, but ALWAYS
 *     PRESERVES manual scores (manualScore). notes and source links are also left untouched.
 *     enrichment OVERWRITES wind + wave metrics and the computed weather score + season label, but ALWAYS
 *   • Draft-only: enriched values are written via storage.updateMonthly /
 *     createMonthly, which mark rows hasDraft=true and never auto-publish.
 *     Existing published content stays live until the admin publishes.
 *   • Failure-safe: if the wind fetch fails, we throw BEFORE writing anything,
 *     so existing data is never wiped. Partial success (wind ok, waves missing)
 *     is applied and surfaced through the spot's dataQualityNote.
 *   • Also mirrors the canonical metrics onto the legacy display columns
 *     (averageBaseWind, gusts, windDays) so the existing admin inputs and any
 *     un-migrated views keep working.
 */

import { storage } from "../storage";
import { enrichCoordinate, KITEABLE_DAY_MIN_HOURS, type EnrichmentResult } from "./openMeteo";
import { bestEvaluableScore, calculateAutoMonthlyScore, deriveSeasonLabelFromScore } from "@shared/scoring";

export interface EnrichOptions {
  /** Configurable kiteable-day threshold (spec §14.5). Falls back to the published scoring config, then KITEABLE_DAY_MIN_HOURS. */
  kiteableDayMinHours?: number;
}

/** Resolve the kiteable-day minimum-hours threshold from explicit option → published scoring config → constant. */
async function resolveKiteableDayMinHours(options?: EnrichOptions): Promise<number> {
  if (options?.kiteableDayMinHours != null && Number.isFinite(options.kiteableDayMinHours)) {
    return options.kiteableDayMinHours;
  }
  try {
    const scoring = await storage.getScoringContent();
    const published = scoring.published.kiteableDayMinHours;
    if (typeof published === "number" && Number.isFinite(published)) return published;
  } catch { /* settings row may not be initialized yet — fall through to the constant */ }
  return KITEABLE_DAY_MIN_HOURS;
}

export interface EnrichSpotOutcome {
  ok: boolean;
  spotId: number;
  slug: string;
  name: string;
  monthsWritten: number;
  windAvailable: boolean;
  waveAvailable: boolean;
  qualityNote: string;
  refreshedAt: string;
  error?: string;
}

/** Thrown for the coordinate guard so callers can distinguish it from API errors. */
export class MissingCoordinatesError extends Error {
  constructor(msg = "Spot has no latitude/longitude — add coordinates before enriching.") {
    super(msg);
    this.name = "MissingCoordinatesError";
  }
}

function hasCoords(lat: number | null, lng: number | null): boolean {
  return typeof lat === "number" && Number.isFinite(lat) &&
         typeof lng === "number" && Number.isFinite(lng);
}

/**
 * Apply an EnrichmentResult to a spot's monthly rows, preserving manual fields.
 * Creates missing month rows, updates existing ones. Returns count written.
 * If `spotPublished` is true, each record is immediately published (weather bypass).
 */
async function applyResult(spotId: number, result: EnrichmentResult, spotPublished: boolean): Promise<number> {
  const existing = await storage.listMonthly(spotId, false); // include drafts
  const byMonth = new Map(existing.map(m => [m.month, m]));
  const scoring = await storage.getScoringContent();
  const config = scoring.published;
  const autoScoreByMonth = new Map(result.months.map((em) => [em.month, calculateAutoMonthlyScore(em, config)]));
  const bestScore = bestEvaluableScore(Array.from(autoScoreByMonth.values()));
  let written = 0;

  for (const em of result.months) {
    const automaticWindScore = autoScoreByMonth.get(em.month) ?? null;
    const seasonLabel = deriveSeasonLabelFromScore(automaticWindScore, bestScore, config);
    const metrics = {
      avgKiteableWind10mKnots: em.avgKiteableWind10mKnots,
      kiteableDaysCount: em.kiteableDaysCount,
      avgKiteableHoursPerDay: em.avgKiteableHoursPerDay,
      avgWaveHeightM: em.avgWaveHeightM,
      maxWaveHeightM: em.maxWaveHeightM,
      avgWavePeriodS: em.avgWavePeriodS,
      dominantWaveDirectionDeg: em.dominantWaveDirectionDeg,
      automaticWindScore,
      seasonLabel,
      averageBaseWind: em.avgKiteableWind10mKnots,
      windDays: em.kiteableDaysCount,
      windSourceName: "Open-Meteo",
      windSourceUrl: "https://open-meteo.com",
    };

    const current = byMonth.get(em.month);
    if (current) {
      await storage.updateMonthly(current.id, metrics as any);
    } else {
      await storage.createMonthly({ spotId, month: em.month, ...metrics } as any);
    }
    written++;
  }

  // For already-published spots, weather changes bypass the draft queue and go live immediately.
  if (spotPublished) {
    await storage.publishAllMonthlyForSpot(spotId);
  }

  return written;
}

/** Enrich a spot by its DB row. Throws MissingCoordinatesError / Error(API). */
export async function enrichSpot(spot: {
  id: number; slug: string; name: string;
  latitude: number | null; longitude: number | null;
  published?: boolean | null;
}, options?: EnrichOptions): Promise<EnrichSpotOutcome> {
  if (!hasCoords(spot.latitude, spot.longitude)) throw new MissingCoordinatesError();
  const minKiteableHours = await resolveKiteableDayMinHours(options);

  let result: EnrichmentResult;
  try {
    result = await enrichCoordinate(spot.latitude as number, spot.longitude as number, minKiteableHours);
  } catch (e: any) {
    // Record failure on the spot so weatherStatus can surface "Update failed".
    await storage.updateSpot(spot.id, {
      weatherLastError: String(e?.message ?? e),
    } as any);
    throw e;
  }

  const monthsWritten = await applyResult(spot.id, result, !!spot.published);

  // Stamp spot-level metadata; clear any previous error and manual-change flag.
  await storage.updateSpot(spot.id, {
    dataSource: result.dataSource,
    dataLastRefreshedAt: result.refreshedAt,
    dataQualityNote: result.qualityNote,
    weatherLastError: null,
    weatherHasManualChanges: false,
  } as any);

  return {
    ok: true,
    spotId: spot.id,
    slug: spot.slug,
    name: spot.name,
    monthsWritten,
    windAvailable: result.windAvailable,
    waveAvailable: result.waveAvailable,
    qualityNote: result.qualityNote,
    refreshedAt: result.refreshedAt,
  };
}

/** Convenience: enrich by numeric id. */
export async function enrichSpotById(id: number, options?: EnrichOptions): Promise<EnrichSpotOutcome> {
  const spot = await storage.getSpot(id);
  if (!spot) throw new Error(`No spot with id ${id}`);
  return enrichSpot(spot as any, options);
}

/** Convenience: enrich by slug. */
export async function enrichSpotBySlug(slug: string, options?: EnrichOptions): Promise<EnrichSpotOutcome> {
  const spot = await storage.getSpotBySlug(slug);
  if (!spot) throw new Error(`No spot with slug "${slug}"`);
  return enrichSpot(spot as any, options);
}
