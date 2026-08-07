/**
 * Open-Meteo enrichment CLI
 * ------------------------------------------------------------------
 * Run with tsx. Enrich one spot (by slug or id) or every spot with coordinates.
 * Enriched values are written as DRAFTS — review and publish them in the admin.
 *
 * Usage:
 *   npm run enrich -- --all                 # enrich every spot that has coordinates
 *   npm run enrich -- --slug el-medano      # enrich a single spot by slug
 *   npm run enrich -- --id 15               # enrich a single spot by numeric id
 *   npm run enrich -- --all --delay 400     # throttle: 400ms between spots (default 300)
 *
 * (Equivalent direct form: npx tsx server/enrich.ts --all)
 *
 * Notes:
 *   • Spots without latitude/longitude are SKIPPED and listed at the end.
 *   • A failed API call for one spot does NOT wipe its data and does NOT stop
 *     the batch — the error is logged and the run continues.
 */

import { storage } from "./storage";
import { enrichSpot, enrichSpotById, enrichSpotBySlug, MissingCoordinatesError, type EnrichOptions } from "./services/enrichment";
import { HISTORY_START_YEAR, HISTORY_END_YEAR, KITEABLE_WIND_THRESHOLD_KNOTS, KITEABLE_DAY_MIN_HOURS, KITEABLE_DAY_SUN_MARGIN_MINUTES } from "./services/openMeteo";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const delay = Number(arg("delay") ?? 300);
  const minKiteableHours = await resolveConfiguredThreshold();
  const enrichOptions: EnrichOptions = { kiteableDayMinHours: minKiteableHours };
  console.log(`Open-Meteo enrichment — window ${HISTORY_START_YEAR}–${HISTORY_END_YEAR}, kiteable threshold ${KITEABLE_WIND_THRESHOLD_KNOTS} kn / ${minKiteableHours} h, kiteable window sunrise−${KITEABLE_DAY_SUN_MARGIN_MINUTES}min → sunset+${KITEABLE_DAY_SUN_MARGIN_MINUTES}min`);
  console.log("Enriched values are saved as DRAFTS. Review and publish in the admin.\n");

  // ── Single spot ──
  const slug = arg("slug");
  const id = arg("id");
  if (slug || id) {
    try {
      const out = slug ? await enrichSpotBySlug(slug, enrichOptions) : await enrichSpotById(Number(id), enrichOptions);
      console.log(`✓ ${out.name} (${out.slug}) — ${out.monthsWritten} months, ` +
        `wind ${out.windAvailable ? "ok" : "—"}, waves ${out.waveAvailable ? "ok" : "—"}` +
        (out.qualityNote ? `\n  note: ${out.qualityNote}` : ""));
    } catch (e: any) {
      console.error(`✗ enrichment failed: ${e?.message ?? e}`);
      process.exit(1);
    }
    return;
  }

  // ── All spots ──
  if (!has("all")) {
    console.error("Nothing to do. Pass --all, --slug <slug> or --id <id>.");
    process.exit(2);
  }

  const spots = await storage.listSpots(false); // include drafts
  const skipped: string[] = [];
  const failed: { name: string; err: string }[] = [];
  let done = 0;

  for (const s of spots) {
    if (s.latitude == null || s.longitude == null) { skipped.push(`${s.name} (${s.slug})`); continue; }
    try {
      const out = await enrichSpot(s as any, enrichOptions);
      done++;
      console.log(`✓ ${out.name} — ${out.monthsWritten} months` +
        (out.waveAvailable ? ", waves ok" : ", no waves") +
        (out.qualityNote ? ` — ${out.qualityNote}` : ""));
    } catch (e: any) {
      if (e instanceof MissingCoordinatesError) { skipped.push(`${s.name} (${s.slug})`); continue; }
      failed.push({ name: `${s.name} (${s.slug})`, err: e?.message ?? String(e) });
      console.error(`✗ ${s.name}: ${e?.message ?? e}`);
    }
    if (delay > 0) await sleep(delay);
  }

  console.log(`\n── Summary ──`);
  console.log(`Enriched: ${done}`);
  console.log(`Skipped (no coordinates): ${skipped.length}`);
  if (skipped.length) skipped.forEach(x => console.log(`   · ${x}`));
  console.log(`Failed: ${failed.length}`);
  if (failed.length) failed.forEach(x => console.log(`   · ${x.name} — ${x.err}`));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

/** Resolve the published kiteable-day min-hours threshold, falling back to the constant. */
async function resolveConfiguredThreshold(): Promise<number> {
  try {
    const scoring = await storage.getScoringContent();
    const published = scoring.published.kiteableDayMinHours;
    if (typeof published === "number" && Number.isFinite(published)) return published;
  } catch { /* scoring settings not initialized yet */ }
  return KITEABLE_DAY_MIN_HOURS;
}
