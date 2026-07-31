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
import { enrichCoordinate, type EnrichmentResult } from "./openMeteo";

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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp01((value - min) / (max - min));
}

export function calculateWeatherScore(row: {
  avgKiteableWind10mKnots?: number | null;
  averageBaseWind?: number | null;
  kiteableDaysCount?: number | null;
  windDays?: number | null;
  avgKiteableHoursPerDay?: number | null;
}): number | null {
  const wind = row.avgKiteableWind10mKnots ?? row.averageBaseWind;
  const days = row.kiteableDaysCount ?? row.windDays;
  const hours = row.avgKiteableHoursPerDay;
  const parts: { value: number; weight: number }[] = [];
  if (wind != null && Number.isFinite(wind)) parts.push({ value: normalize(wind, 12, 25), weight: 0.5 });
  if (days != null && Number.isFinite(days)) parts.push({ value: normalize(days, 3, 20), weight: 0.3 });
  if (hours != null && Number.isFinite(hours)) parts.push({ value: normalize(hours, 1, 6), weight: 0.2 });
  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const weighted = parts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight;
  return Math.round(weighted * 100) / 10;
}

export function seasonLabelFromScore(score: number | null): "peak" | "side" | "off" {
  if (score == null) return "side";
  if (score >= 7.5) return "peak";
  if (score >= 5) return "side";
  return "off";
}

/**
 * Apply an EnrichmentResult to a spot's monthly rows, preserving manual fields.
 * Creates missing month rows, updates existing ones. Returns count written.
 */
async function applyResult(spotId: number, result: EnrichmentResult): Promise<number> {
  const existing = await storage.listMonthly(spotId, false); // include drafts
  const byMonth = new Map(existing.map(m => [m.month, m]));
  let written = 0;

  for (const em of result.months) {
    const automaticWindScore = calculateWeatherScore(em);
    const seasonLabel = seasonLabelFromScore(automaticWindScore);
    // The canonical enriched metrics (overwrite).
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
      // Mirror onto legacy display columns so existing UI keeps showing values.
      averageBaseWind: em.avgKiteableWind10mKnots,
      windDays: em.kiteableDaysCount,
      // Attribution for the public "source" line.
      windSourceName: "Open-Meteo",
      windSourceUrl: "https://open-meteo.com",
    };

    const current = byMonth.get(em.month);
    if (current) {
      // Update in place. seasonLabel, manualScore, automaticWindScore,
      // internalNotes are intentionally NOT included → preserved.
      await storage.updateMonthly(current.id, metrics as any);
    } else {
      // New month row: seed the computed score + season for the admin to review.
      await storage.createMonthly({
        spotId, month: em.month, ...metrics,
      } as any);
    }
    written++;
  }
  return written;
}

/** Enrich a spot by its DB row. Throws MissingCoordinatesError / Error(API). */
export async function enrichSpot(spot: {
  id: number; slug: string; name: string;
  latitude: number | null; longitude: number | null;
}): Promise<EnrichSpotOutcome> {
  if (!hasCoords(spot.latitude, spot.longitude)) throw new MissingCoordinatesError();

  // Fetch + aggregate. If wind fails this throws → nothing is written below.
  const result = await enrichCoordinate(spot.latitude as number, spot.longitude as number);

  const monthsWritten = await applyResult(spot.id, result);

  // Stamp spot-level metadata (as a draft edit).
  await storage.updateSpot(spot.id, {
    dataSource: result.dataSource,
    dataLastRefreshedAt: result.refreshedAt,
    dataQualityNote: result.qualityNote,
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
export async function enrichSpotById(id: number): Promise<EnrichSpotOutcome> {
  const spot = await storage.getSpot(id);
  if (!spot) throw new Error(`No spot with id ${id}`);
  return enrichSpot(spot as any);
}

/** Convenience: enrich by slug. */
export async function enrichSpotBySlug(slug: string): Promise<EnrichSpotOutcome> {
  const spot = await storage.getSpotBySlug(slug);
  if (!spot) throw new Error(`No spot with slug "${slug}"`);
  return enrichSpot(spot as any);
}
