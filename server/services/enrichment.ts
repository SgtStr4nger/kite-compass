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
 *     PRESERVES manual season labels (seasonLabel) and manual scores
 *     (manualScore). automaticWindScore, notes and source links are also left
 *     untouched.
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

/**
 * Apply an EnrichmentResult to a spot's monthly rows, preserving manual fields.
 * Creates missing month rows, updates existing ones. Returns count written.
 */
async function applyResult(spotId: number, result: EnrichmentResult): Promise<number> {
  const existing = await storage.listMonthly(spotId, false); // include drafts
  const byMonth = new Map(existing.map(m => [m.month, m]));
  let written = 0;

  for (const em of result.months) {
    // The canonical enriched metrics (overwrite).
    const metrics = {
      avgWind10mKnots: em.avgWind10mKnots,
      // maxWind10mKnots column now stores the TYPICAL strong-day gust (percentile),
      // not an all-time extreme — see openMeteo.ts GUST_PERCENTILE.
      maxWind10mKnots: em.gustKnots,
      windyDaysCount: em.windyDaysCount,
      avgWaveHeightM: em.avgWaveHeightM,
      maxWaveHeightM: em.maxWaveHeightM,
      avgWavePeriodS: em.avgWavePeriodS,
      dominantWaveDirectionDeg: em.dominantWaveDirectionDeg,
      // Mirror onto legacy display columns so existing UI keeps showing values.
      averageBaseWind: em.avgWind10mKnots,
      gusts: em.gustKnots,
      windDays: em.windyDaysCount,
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
      // New month row: seed a sensible default season the admin can edit later.
      await storage.createMonthly({
        spotId, month: em.month, seasonLabel: "good", ...metrics,
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
