import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/* ─────────────── Admin users ─────────────── */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("standard"), // main|standard
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  temporaryLockUntil: text("temporary_lock_until"),
  isFullyLocked: integer("is_fully_locked", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});
export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  passwordHash: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  failedLoginAttempts: true,
  temporaryLockUntil: true,
  isFullyLocked: true,
  createdAt: true,
  updatedAt: true,
});
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
  publicId: text("public_id").default(""),
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
  spotTypes: text("spot_types").default("[]"),      // JSON array
  riderLevels: text("rider_levels").default("[]"),  // JSON array
  vibeTags: text("vibe_tags").default("[]"),        // JSON array
  internalNotes: text("internal_notes").default(""),
  sourceNotes: text("source_notes").default(""),
  seoTitleOverride: text("seo_title_override").default(""),
  seoDescriptionOverride: text("seo_description_override").default(""),
  // ranking mode: 'manual' | 'auto' (admin-only control)
  rankingMode: text("ranking_mode").default("auto"),
  // Weather status tracking (separate publish dimension from content)
  weatherLastError: text("weather_last_error"),             // last enrichment error message
  weatherCoordUpdatedAt: text("weather_coord_updated_at"),  // set when lat/lng/onshore change
  weatherHasManualChanges: integer("weather_has_manual_changes", { mode: "boolean" }).default(false),
  // true when the country was set manually (admin override); auto-derived from coords otherwise
  countryManual: integer("country_manual", { mode: "boolean" }).default(false),
  // draft/publish
  published: integer("published", { mode: "boolean" }).default(false),
  hasDraft: integer("has_draft", { mode: "boolean" }).default(true),
  publishedSnapshot: text("published_snapshot"), // JSON of last published version
  publishedAt: text("published_at"), // ISO timestamp of last content publish
  // soft delete (30-day restorable)
  deletedAt: text("deleted_at"),
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
  avgKiteableWind10mKnots: real("avg_kiteable_wind_10m_knots"),
  kiteableDaysCount: integer("kiteable_days_count"),    // days meeting the kiteable-hour threshold
  avgKiteableHoursPerDay: real("avg_kiteable_hours_per_day"),
  avgWaveHeightM: real("avg_wave_height_m"),
  maxWaveHeightM: real("max_wave_height_m"),
  avgWavePeriodS: real("avg_wave_period_s"),
  dominantWaveDirectionDeg: real("dominant_wave_direction_deg"),
  // Wind direction classification (per spec §16): Onshore|Side-on|Side-shore|Side-off|Offshore
  primaryWindType: text("primary_wind_type"),
  secondaryWindType: text("secondary_wind_type"),
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

/* ─────────────── Schools ─────────────── */
// Global listing entities — assigned to spots via spot_schools.
export const schools = sqliteTable("schools", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Legacy column retained for DB compat; use spot_schools for multi-spot assignment.
  spotId: integer("spot_id"),
  name: text("name").notNull(),
  sports: text("sports").default("[]"),             // JSON array: Kitesurfing, Wingfoiling, Kitefoiling, Surfing
  websiteUrl: text("website_url").default(""),
  mapUrl: text("map_url").default(""),
  offersRental: integer("offers_rental", { mode: "boolean" }).default(false),
  offersLessons: integer("offers_lessons", { mode: "boolean" }).default(false),
  shortDescription: text("short_description").default(""), // max 300 chars
  notes: text("notes").default(""),
  favorite: integer("favorite", { mode: "boolean" }).default(false),
  published: integer("published", { mode: "boolean" }).default(false),
  hasDraft: integer("has_draft", { mode: "boolean" }).default(true),
  publishedSnapshot: text("published_snapshot"),
  // soft delete (30-day restorable)
  deletedAt: text("deleted_at"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});
export const insertSchoolSchema = createInsertSchema(schools).omit({
  id: true, createdAt: true, updatedAt: true, publishedSnapshot: true, spotId: true,
}).partial().extend({
  name: z.string().min(1),
});
export type InsertSchool = z.infer<typeof insertSchoolSchema>;
export type School = typeof schools.$inferSelect;

/* ─────────────── Stays ─────────────── */
// Global listing entities — assigned to spots via spot_stays.
export const stays = sqliteTable("stays", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Legacy column retained for DB compat; use spot_stays for multi-spot assignment.
  spotId: integer("spot_id"),
  name: text("name").notNull(),
  type: text("type").default(""),               // Hotel | Hostel | Apartment | Guesthouse | Resort
  websiteUrl: text("website_url").default(""),
  mapUrl: text("map_url").default(""),
  shortDescription: text("short_description").default(""), // max 300 chars
  notes: text("notes").default(""),
  favorite: integer("favorite", { mode: "boolean" }).default(false),
  published: integer("published", { mode: "boolean" }).default(false),
  hasDraft: integer("has_draft", { mode: "boolean" }).default(true),
  publishedSnapshot: text("published_snapshot"),
  // soft delete (30-day restorable)
  deletedAt: text("deleted_at"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});
export const insertStaySchema = createInsertSchema(stays).omit({
  id: true, createdAt: true, updatedAt: true, publishedSnapshot: true, spotId: true,
}).partial().extend({
  name: z.string().min(1),
});
export type InsertStay = z.infer<typeof insertStaySchema>;
export type Stay = typeof stays.$inferSelect;

/* ─────────────── Spot–listing assignment tables ─────────────── */
// Assignments are ordered by sort_order; duplicate spot+listing pairs are not allowed.
export const spotSchools = sqliteTable("spot_schools", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spotId: integer("spot_id").notNull(),
  schoolId: integer("school_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
export type SpotSchool = typeof spotSchools.$inferSelect;

export const spotStays = sqliteTable("spot_stays", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spotId: integer("spot_id").notNull(),
  stayId: integer("stay_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
export type SpotStay = typeof spotStays.$inferSelect;

/* ─────────────── Site pages ─────────────── */
export const sitePages = sqliteTable("site_pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});
export const insertSitePageSchema = createInsertSchema(sitePages).omit({ id: true, createdAt: true, updatedAt: true }).partial().extend({
  slug: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
});
export type InsertSitePage = z.infer<typeof insertSitePageSchema>;
export type SitePage = typeof sitePages.$inferSelect;

/* ─────────────── Legal pages (shared draft/publish) ─────────────── */
export const legalPages = sqliteTable("legal_pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  privacyPolicyDraft: text("privacy_policy_draft").notNull().default(""),
  legalNoticeDraft: text("legal_notice_draft").notNull().default(""),
  privacyPolicyPublished: text("privacy_policy_published").notNull().default(""),
  legalNoticePublished: text("legal_notice_published").notNull().default(""),
  hasDraft: integer("has_draft", { mode: "boolean" }).default(true),
  publishedAt: text("published_at"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});
export const insertLegalPageSchema = createInsertSchema(legalPages).omit({ id: true, createdAt: true, updatedAt: true }).partial();
export type InsertLegalPage = z.infer<typeof insertLegalPageSchema>;
export type LegalPage = typeof legalPages.$inferSelect;

/* ─────────────── SEO settings (shared draft/publish) ─────────────── */
export const seoSettings = sqliteTable("seo_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  homepageTitleDraft: text("homepage_title_draft").notNull().default(""),
  homepageDescriptionDraft: text("homepage_description_draft").notNull().default(""),
  exploreTitleDraft: text("explore_title_draft").notNull().default(""),
  exploreDescriptionDraft: text("explore_description_draft").notNull().default(""),
  methodologyTitleDraft: text("methodology_title_draft").notNull().default(""),
  methodologyDescriptionDraft: text("methodology_description_draft").notNull().default(""),
  homepageTitlePublished: text("homepage_title_published").notNull().default(""),
  homepageDescriptionPublished: text("homepage_description_published").notNull().default(""),
  exploreTitlePublished: text("explore_title_published").notNull().default(""),
  exploreDescriptionPublished: text("explore_description_published").notNull().default(""),
  methodologyTitlePublished: text("methodology_title_published").notNull().default(""),
  methodologyDescriptionPublished: text("methodology_description_published").notNull().default(""),
  hasDraft: integer("has_draft", { mode: "boolean" }).default(true),
  publishedAt: text("published_at"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});
export const insertSeoSettingsSchema = createInsertSchema(seoSettings).omit({ id: true, createdAt: true, updatedAt: true }).partial();
export type InsertSeoSettings = z.infer<typeof insertSeoSettingsSchema>;
export type SeoSettings = typeof seoSettings.$inferSelect;

/* ─────────────── Scoring settings (shared draft/publish) ─────────────── */
export const scoringSettings = sqliteTable("scoring_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  draftJson: text("draft_json").notNull().default("{}"),
  publishedJson: text("published_json").notNull().default("{}"),
  hasDraft: integer("has_draft", { mode: "boolean" }).default(true),
  publishedAt: text("published_at"),
  updatedAt: text("updated_at"),
});
export type ScoringSettings = typeof scoringSettings.$inferSelect;

export const scoringRecalcState = sqliteTable("scoring_recalc_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull().default("Idle"),
  totalSpots: integer("total_spots").notNull().default(0),
  completedSpots: integer("completed_spots").notNull().default(0),
  message: text("message").notNull().default(""),
  dismissible: integer("dismissible", { mode: "boolean" }).default(false),
  dismissed: integer("dismissed", { mode: "boolean" }).default(false),
  updatedAt: text("updated_at"),
});
export type ScoringRecalcState = typeof scoringRecalcState.$inferSelect;

export const weatherRefreshState = sqliteTable("weather_refresh_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull().default("Idle"),
  totalSpots: integer("total_spots").notNull().default(0),
  completedSpots: integer("completed_spots").notNull().default(0),
  message: text("message").notNull().default(""),
  dismissible: integer("dismissible", { mode: "boolean" }).default(false),
  dismissed: integer("dismissed", { mode: "boolean" }).default(false),
  updatedAt: text("updated_at"),
});
export type WeatherRefreshState = typeof weatherRefreshState.$inferSelect;

/* ─────────────── AI enrichment settings (spec #74) ───────────────
 * Singleton row (id=1) holding the DeepSeek provider connection. The API key is
 * stored server-side only; the routes layer masks it before responding so it
 * never reaches the client or the request/response log.
 */
export const aiSettings = sqliteTable("ai_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  apiKey: text("api_key").notNull().default(""),
  model: text("model").notNull().default("deepseek-v4-flash"),
  baseUrl: text("base_url").notNull().default("https://api.deepseek.com"),
  // JSON object: per-field custom prompt instructions, keyed by fillable field name.
  promptsJson: text("prompts_json").notNull().default("{}"),
  updatedAt: text("updated_at"),
});
export type AiSettingsRow = typeof aiSettings.$inferSelect;

/* Per-call AI enrichment log (spec #74 follow-up: history in AI settings). */
export const aiEnrichLog = sqliteTable("ai_enrich_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spotId: integer("spot_id"),
  spotName: text("spot_name").notNull().default(""),
  status: text("status").notNull().default("success"), // success | failed | skipped
  writtenFields: text("written_fields"),               // JSON array
  skippedFields: text("skipped_fields"),               // JSON array
  error: text("error"),
  createdAt: text("created_at"),
});
export type AiEnrichLogRow = typeof aiEnrichLog.$inferSelect;

/* Background AI enrichment job state (mirror of weather_refresh_state). */
export const aiEnrichState = sqliteTable("ai_enrich_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull().default("Idle"),
  totalSpots: integer("total_spots").notNull().default(0),
  completedSpots: integer("completed_spots").notNull().default(0),
  message: text("message").notNull().default(""),
  dismissible: integer("dismissible", { mode: "boolean" }).default(false),
  dismissed: integer("dismissed", { mode: "boolean" }).default(false),
  updatedAt: text("updated_at"),
});
export type AiEnrichState = typeof aiEnrichState.$inferSelect;

/* ─────────────── Redirects (spec §29) ─────────────── */
export const redirects = sqliteTable("redirects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromPath: text("from_path").notNull().unique(),
  toUrl: text("to_url").notNull(),
  targetType: text("target_type").notNull(), // 'spot' | 'manual'
  spotId: integer("spot_id"),
  isBroken: integer("is_broken", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});
export const insertRedirectSchema = createInsertSchema(redirects).omit({
  id: true, createdAt: true, updatedAt: true,
}).partial().extend({
  fromPath: z.string().min(1),
  toUrl: z.string().min(1),
  targetType: z.union([z.literal("spot"), z.literal("manual")]),
});
export type InsertRedirect = z.infer<typeof insertRedirectSchema>;
export type Redirect = typeof redirects.$inferSelect;

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
