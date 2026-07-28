import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/* ─────────────── Admin users ─────────────── */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
});
export const insertUserSchema = createInsertSchema(users).pick({ email: true, passwordHash: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

/* ─────────────── Spots ───────────────
 * Draft/publish: every editable field is stored once; `published` marks whether
 * the current row content is live. Draft edits set published=0 until publish.
 * `publishedSnapshot` (JSON) holds the last-published version so the public site
 * can read live content while the admin edits a newer draft.
 * List fields (tags) are JSON text — SQLite has no array columns.
 */
export const spots = sqliteTable("spots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  country: text("country").default(""),
  region: text("region").default(""),
  latitude: real("latitude"),
  longitude: real("longitude"),
  // Weather enrichment metadata (Open-Meteo). Per-month values live on monthlyRecords.
  dataSource: text("data_source").default(""),                 // e.g. 'open-meteo'
  dataLastRefreshedAt: text("data_last_refreshed_at"),          // ISO timestamp of last enrichment
  dataQualityNote: text("data_quality_note").default(""),       // admin-only note (partial success, etc.)
  googleMapsUrl: text("google_maps_url").default(""),
  windyUrl: text("windy_url").default(""),
  windfinderUrl: text("windfinder_url").default(""),
  destinationSummary: text("destination_summary").default(""),
  destinationDescription: text("destination_description").default(""),
  kiteContextDescription: text("kite_context_description").default(""),
  teaserText: text("teaser_text").default(""),
  heroImageUrl: text("hero_image_url").default(""),
  nearestAirportName: text("nearest_airport_name").default(""),
  nearestAirportCode: text("nearest_airport_code").default(""),
  airportTransferTime: text("airport_transfer_time").default(""),
  transportNote: text("transport_note").default(""),
  beginnerFriendly: integer("beginner_friendly", { mode: "boolean" }).default(false),
  spotTypes: text("spot_types").default("[]"),      // JSON array
  riderLevels: text("rider_levels").default("[]"),  // JSON array
  vibeTags: text("vibe_tags").default("[]"),        // JSON array
  internalNotes: text("internal_notes").default(""),
  sourceNotes: text("source_notes").default(""),
  // ranking mode: 'manual' | 'auto' (admin-only control)
  rankingMode: text("ranking_mode").default("manual"),
  // draft/publish
  published: integer("published", { mode: "boolean" }).default(false),
  hasDraft: integer("has_draft", { mode: "boolean" }).default(true),
  publishedSnapshot: text("published_snapshot"), // JSON of last published version
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

export const insertSpotSchema = createInsertSchema(spots).omit({
  id: true, createdAt: true, updatedAt: true, publishedSnapshot: true,
}).partial().extend({
  slug: z.string().min(1),
  name: z.string().min(1),
});
export type InsertSpot = z.infer<typeof insertSpotSchema>;
export type Spot = typeof spots.$inferSelect;

/* ─────────────── Monthly records ─────────────── */
export const monthlyRecords = sqliteTable("monthly_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spotId: integer("spot_id").notNull(),
  month: text("month").notNull(), // 'January' .. 'December'
  manualScore: real("manual_score"),
  automaticWindScore: real("automatic_wind_score"),
  averageBaseWind: real("average_base_wind"),
  gusts: real("gusts"),
  windDays: integer("wind_days"),
  seasonLabel: text("season_label").default("good"), // peak|good|okay|off
  // ── Open-Meteo enriched metrics (canonical units: wind in knots, waves in metres, period in seconds) ──
  avgWind10mKnots: real("avg_wind_10m_knots"),
  maxWind10mKnots: real("max_wind_10m_knots"),          // monthly peak of daily-max 10m wind (gust proxy)
  windyDaysCount: integer("windy_days_count"),          // days meeting the windy-day threshold
  avgWaveHeightM: real("avg_wave_height_m"),
  maxWaveHeightM: real("max_wave_height_m"),
  avgWavePeriodS: real("avg_wave_period_s"),
  dominantWaveDirectionDeg: real("dominant_wave_direction_deg"),
  windSourceName: text("wind_source_name").default(""),
  windSourceUrl: text("wind_source_url").default(""),
  internalNotes: text("internal_notes").default(""),
  published: integer("published", { mode: "boolean" }).default(false),
  hasDraft: integer("has_draft", { mode: "boolean" }).default(true),
  publishedSnapshot: text("published_snapshot"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});
export const insertMonthlySchema = createInsertSchema(monthlyRecords).omit({
  id: true, createdAt: true, updatedAt: true, publishedSnapshot: true,
}).partial().extend({
  spotId: z.number(),
  month: z.string().min(1),
});
export type InsertMonthly = z.infer<typeof insertMonthlySchema>;
export type MonthlyRecord = typeof monthlyRecords.$inferSelect;

/* ─────────────── Dynamic filter definitions ───────────────
 * Filterable fields are described in the DB so new filters can be added
 * without frontend rework. The frontend renders controls from this config.
 */
export const filterDefs = sqliteTable("filter_defs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),   // e.g. 'spot_types'
  label: text("label").notNull(),         // e.g. 'Spot type'
  field: text("field").notNull(),         // spot column the filter maps to
  type: text("type").notNull(),           // 'multiselect' | 'boolean' | 'select'
  options: text("options").default("[]"), // JSON array of allowed values (multiselect/select)
  isPublic: integer("is_public", { mode: "boolean" }).default(true),
  sortOrder: integer("sort_order").default(0),
});
export const insertFilterDefSchema = createInsertSchema(filterDefs).omit({ id: true });
export type FilterDef = typeof filterDefs.$inferSelect;
export type InsertFilterDef = z.infer<typeof insertFilterDefSchema>;
