/**
 * Seed / import script.
 * Usage:
 *   tsx server/seed.ts            # seed from seed_data.json (idempotent, publishes all)
 *
 * This is also the structured-import path for CSV/XLSX: convert a spreadsheet to
 * the seed_data.json shape ({ spots: [...], months: [...] }) and re-run.
 */
import { db } from "./storage";
import { spots, monthlyRecords, filterDefs, schools, stays } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const now = () => new Date().toISOString();
const SEED = path.resolve(process.cwd(), "seed_data.json");

async function run() {
  const data = JSON.parse(fs.readFileSync(SEED, "utf-8"));

  // ── Filter definitions (dynamic, schema-driven) ──
  const defs = [
    { key: "spotTypes", label: "Spot type", field: "spot_types", type: "multiselect",
      options: JSON.stringify(["flat-water", "chop", "waves", "lagoon", "foil", "freestyle"]), isPublic: true, sortOrder: 1 },
    { key: "riderLevels", label: "Rider level", field: "rider_levels", type: "multiselect",
      options: JSON.stringify(["beginner", "intermediate", "advanced"]), isPublic: true, sortOrder: 2 },
    { key: "vibeTags", label: "Travel vibe", field: "vibe_tags", type: "multiselect",
      options: JSON.stringify(["city", "town", "village", "remote", "touristy", "local-scene", "family-friendly", "nightlife"]), isPublic: true, sortOrder: 3 },
    { key: "windTypes", label: "Wind type", field: "primary_wind_type", type: "multiselect",
      options: JSON.stringify(["Onshore", "Side-on", "Side-shore", "Side-off", "Offshore"]), isPublic: true, sortOrder: 4 },
  ];
  for (const d of defs) {
    const ex = db.select().from(filterDefs).where(eq(filterDefs.key, d.key)).get();
    if (ex) db.update(filterDefs).set(d).where(eq(filterDefs.id, ex.id)).run();
    else db.insert(filterDefs).values(d).run();
  }

  // ── Spots ──
  let created = 0, updated = 0;
  const slugToId: Record<string, number> = {};
  for (const s of data.spots) {
    const row = {
      publicId: s.public_id || crypto.randomUUID(),
      slug: s.slug, name: s.name, country: s.country || "", region: s.region || "",
      latitude: s.latitude, longitude: s.longitude,
      googleMapsUrl: s.google_maps_url || "", windyUrl: "", windfinderUrl: "",
      destinationSummary: s.destination_summary || "",
      destinationDescription: s.destination_description || "",
      kiteContextDescription: s.kite_context_description || "",
      teaserText: s.teaser_text || "",
      heroImageUrl: s.hero_image_url || "",
      nearestAirportName: s.nearest_airport_name || "",
      nearestAirportCode: s.nearest_airport_code || "",
      airportTransferTime: s.airport_transfer_time || "",
      transportNote: s.transport_note || "",
      spotTypes: JSON.stringify(s.spot_types || []),
      riderLevels: JSON.stringify(s.rider_levels || []),
      vibeTags: JSON.stringify(s.vibe_tags || []),
      internalNotes: "", sourceNotes: s.source_notes || "",
      rankingMode: "manual",
      published: true, hasDraft: false,
      updatedAt: now(),
    };
    const ex = db.select().from(spots).where(eq(spots.slug, s.slug)).get();
    if (ex) {
      db.update(spots).set({ ...row, publishedSnapshot: JSON.stringify({ ...ex, ...row }) } as any).where(eq(spots.id, ex.id)).run();
      slugToId[s.slug] = ex.id; updated++;
    } else {
      const ins = db.insert(spots).values({ ...row, createdAt: now() } as any).returning().get();
      db.update(spots).set({ publishedSnapshot: JSON.stringify(ins) } as any).where(eq(spots.id, ins.id)).run();
      slugToId[s.slug] = ins.id; created++;
    }
  }

  // ── Monthly records ── (wipe + reinsert for the seeded spots)
  let mc = 0;
  for (const m of data.months) {
    const spotId = slugToId[m.spot_slug];
    if (!spotId) continue;
    // avoid duplicates: delete existing (spotId, month) then insert
    const existing = db.select().from(monthlyRecords).where(eq(monthlyRecords.spotId, spotId)).all()
      .filter((r: any) => r.month === m.month);
    for (const e of existing) db.delete(monthlyRecords).where(eq(monthlyRecords.id, (e as any).id)).run();
    const row = {
      spotId, month: m.month,
      manualScore: m.manual_score ?? null,
      automaticWindScore: null,
      averageBaseWind: m.average_base_wind ?? null,
      avgKiteableWind10mKnots: m.avg_kiteable_wind_10m_knots ?? m.average_base_wind ?? null,
      gusts: m.gusts ?? null,
      windDays: m.wind_days ?? null,
      kiteableDaysCount: m.kiteable_days_count ?? m.wind_days ?? null,
      avgKiteableHoursPerDay: m.avg_kiteable_hours_per_day ?? null,
      seasonLabel: m.season_label || "good",
      windSourceName: m.wind_source_name || "",
      windSourceUrl: m.wind_source_url || "",
      internalNotes: m.internal_notes || "",
      published: true, hasDraft: false,
      createdAt: now(), updatedAt: now(),
    };
    const ins = db.insert(monthlyRecords).values(row as any).returning().get();
    db.update(monthlyRecords).set({ publishedSnapshot: JSON.stringify(ins) } as any).where(eq(monthlyRecords.id, ins.id)).run();
    mc++;
  }

  // ── Linked schools/stays ──
  let schoolCount = 0;
  for (const s of data.schools ?? []) {
    const spotId = slugToId[s.spot_slug];
    if (!spotId || !s.name) continue;
    const row = {
      spotId,
      name: s.name,
      websiteUrl: s.website_url || "",
      mapUrl: s.map_url || "",
      offersRental: !!s.offers_rental,
      offersLessons: !!s.offers_lessons,
      notes: s.notes || "",
      favorite: !!s.favorite,
      published: true,
      hasDraft: false,
      createdAt: now(),
      updatedAt: now(),
    };
    const ins = db.insert(schools).values(row as any).returning().get();
    db.update(schools).set({ publishedSnapshot: JSON.stringify(ins) } as any).where(eq(schools.id, ins.id)).run();
    schoolCount++;
  }

  let stayCount = 0;
  for (const s of data.stays ?? []) {
    const spotId = slugToId[s.spot_slug];
    if (!spotId || !s.name) continue;
    const row = {
      spotId,
      name: s.name,
      type: s.type || "",
      websiteUrl: s.website_url || "",
      mapUrl: s.map_url || "",
      notes: s.notes || "",
      favorite: !!s.favorite,
      published: true,
      hasDraft: false,
      createdAt: now(),
      updatedAt: now(),
    };
    const ins = db.insert(stays).values(row as any).returning().get();
    db.update(stays).set({ publishedSnapshot: JSON.stringify(ins) } as any).where(eq(stays.id, ins.id)).run();
    stayCount++;
  }

  console.log(`Seed complete: spots created=${created} updated=${updated}, monthly records=${mc}, schools=${schoolCount}, stays=${stayCount}`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
