import { users, spots, monthlyRecords, filterDefs, schools, stays, sitePages } from '@shared/schema';
import type {
  User, InsertUser, Spot, InsertSpot, MonthlyRecord, InsertMonthly,
  School, InsertSchool, Stay, InsertStay,
  SitePage, InsertSitePage,
  FilterDef, InsertFilterDef,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

// ── Lightweight, idempotent column migrations ──
// Drizzle here talks straight to better-sqlite3 with no migration runner, so we
// additively add any missing columns at startup. ALTER TABLE ADD COLUMN is cheap
// and safe; we guard each one against the current table_info so re-runs are no-ops.
function ensureColumns(table: string, cols: { name: string; ddl: string }[]) {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(r => r.name),
  );
  for (const c of cols) {
    if (!existing.has(c.name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${c.ddl}`);
  }
}
ensureColumns("spots", [
  { name: "public_id", ddl: "public_id TEXT DEFAULT ''" },
  { name: "data_source", ddl: "data_source TEXT DEFAULT ''" },
  { name: "data_last_refreshed_at", ddl: "data_last_refreshed_at TEXT" },
  { name: "data_quality_note", ddl: "data_quality_note TEXT DEFAULT ''" },
  { name: "water_states", ddl: "water_states TEXT DEFAULT '[]'" },
  { name: "weather_last_error", ddl: "weather_last_error TEXT" },
  { name: "weather_coord_updated_at", ddl: "weather_coord_updated_at TEXT" },
  { name: "weather_has_manual_changes", ddl: "weather_has_manual_changes INTEGER DEFAULT 0" },
]);
ensureColumns("monthly_records", [
  { name: "avg_kiteable_wind_10m_knots", ddl: "avg_kiteable_wind_10m_knots REAL" },
  { name: "kiteable_days_count", ddl: "kiteable_days_count INTEGER" },
  { name: "avg_kiteable_hours_per_day", ddl: "avg_kiteable_hours_per_day REAL" },
  { name: "avg_wave_height_m", ddl: "avg_wave_height_m REAL" },
  { name: "max_wave_height_m", ddl: "max_wave_height_m REAL" },
  { name: "avg_wave_period_s", ddl: "avg_wave_period_s REAL" },
  { name: "dominant_wave_direction_deg", ddl: "dominant_wave_direction_deg REAL" },
  { name: "primary_wind_type", ddl: "primary_wind_type TEXT" },
  { name: "secondary_wind_type", ddl: "secondary_wind_type TEXT" },
]);

const now = () => new Date().toISOString();

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spot_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    website_url TEXT DEFAULT '',
    map_url TEXT DEFAULT '',
    offers_rental INTEGER DEFAULT 0,
    offers_lessons INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    favorite INTEGER DEFAULT 0,
    published INTEGER DEFAULT 0,
    has_draft INTEGER DEFAULT 1,
    published_snapshot TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS stays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spot_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT DEFAULT '',
    website_url TEXT DEFAULT '',
    map_url TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    favorite INTEGER DEFAULT 0,
    published INTEGER DEFAULT 0,
    has_draft INTEGER DEFAULT 1,
    published_snapshot TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS site_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
  );
`);

ensureColumns("site_pages", [
  { name: "slug", ddl: "slug TEXT NOT NULL UNIQUE" },
  { name: "title", ddl: "title TEXT NOT NULL" },
  { name: "body", ddl: "body TEXT NOT NULL" },
]);

const defaultImpressumBody = [
  "Angaben gemäß § 5 TMG",
  "",
  "Kite Compass",
  "[Name des Betreibers / Unternehmens]",
  "[Straße und Hausnummer]",
  "[PLZ Ort]",
  "[Land]",
  "",
  "Kontakt",
  "E-Mail: [E-Mail-Adresse]",
  "Telefon: [optional]",
  "",
  "Vertretungsberechtigt",
  "[Name der vertretungsberechtigten Person]",
  "",
  "Haftung für Inhalte",
  "Die Inhalte dieser Website wurden mit Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte können wir jedoch keine Gewähr übernehmen.",
  "",
  "Haftung für Links",
  "Diese Website enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen.",
].join("\n");

function ensureDefaultSitePages() {
  const row = db.select().from(sitePages).where(eq(sitePages.slug, "impressum")).get();
  if (!row) {
    db.insert(sitePages).values({
      slug: "impressum",
      title: "Impressum",
      body: defaultImpressumBody,
      createdAt: now(),
      updatedAt: now(),
    } as any).run();
  }
}
ensureDefaultSitePages();

function ensureSpotPublicIds() {
  const rows = db.select({ id: spots.id, publicId: spots.publicId }).from(spots).all();
  for (const row of rows) {
    if (!row.publicId) {
      db.update(spots).set({ publicId: crypto.randomUUID(), updatedAt: now() } as any).where(eq(spots.id, row.id)).run();
    }
  }
}
ensureSpotPublicIds();

db.update(spots).set({ rankingMode: "auto" } as any).run();

// Fields excluded when taking a "published snapshot" of an entity's content.
function snapshotSpot(s: Spot) {
  const { publishedSnapshot, hasDraft, published, ...rest } = s as any;
  return JSON.stringify(rest);
}
function snapshotMonthly(m: MonthlyRecord) {
  const { publishedSnapshot, hasDraft, published, ...rest } = m as any;
  return JSON.stringify(rest);
}

export interface IStorage {
  // auth
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  countUsers(): Promise<number>;
  createUser(u: InsertUser): Promise<User>;
  // spots
  listSpots(publishedOnly: boolean): Promise<Spot[]>;
  getSpot(id: number): Promise<Spot | undefined>;
  getSpotBySlug(slug: string): Promise<Spot | undefined>;
  createSpot(s: InsertSpot): Promise<Spot>;
  updateSpot(id: number, s: Partial<InsertSpot>): Promise<Spot | undefined>;
  publishSpot(id: number): Promise<Spot | undefined>;
  deleteSpot(id: number): Promise<void>;
  // monthly
  listMonthly(spotId: number, publishedOnly: boolean): Promise<MonthlyRecord[]>;
  listAllMonthly(publishedOnly: boolean): Promise<MonthlyRecord[]>;
  getMonthly(id: number): Promise<MonthlyRecord | undefined>;
  createMonthly(m: InsertMonthly): Promise<MonthlyRecord>;
  updateMonthly(id: number, m: Partial<InsertMonthly>): Promise<MonthlyRecord | undefined>;
  publishMonthly(id: number): Promise<MonthlyRecord | undefined>;
  publishAllMonthlyForSpot(spotId: number): Promise<number>;
  resetWeatherManualChanges(spotId: number): Promise<void>;
  deleteMonthly(id: number): Promise<void>;
  // linked entities
  listSchools(spotId: number, publishedOnly: boolean): Promise<School[]>;
  createSchool(s: InsertSchool): Promise<School>;
  updateSchool(id: number, s: Partial<InsertSchool>): Promise<School | undefined>;
  publishSchool(id: number): Promise<School | undefined>;
  deleteSchool(id: number): Promise<void>;
  listStays(spotId: number, publishedOnly: boolean): Promise<Stay[]>;
  createStay(s: InsertStay): Promise<Stay>;
  updateStay(id: number, s: Partial<InsertStay>): Promise<Stay | undefined>;
  publishStay(id: number): Promise<Stay | undefined>;
  deleteStay(id: number): Promise<void>;
  // filters
  listFilterDefs(publicOnly: boolean): Promise<FilterDef[]>;
  upsertFilterDef(f: InsertFilterDef): Promise<FilterDef>;
  // content pages
  getSitePageBySlug(slug: string): Promise<SitePage | undefined>;
  upsertSitePage(page: InsertSitePage): Promise<SitePage>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number) { return db.select().from(users).where(eq(users.id, id)).get(); }
  async getUserByEmail(email: string) { return db.select().from(users).where(eq(users.email, email)).get(); }
  async countUsers() { return db.select().from(users).all().length; }
  async createUser(u: InsertUser) { return db.insert(users).values(u).returning().get(); }

  async listSpots(publishedOnly: boolean) {
    const all = db.select().from(spots).all();
    return publishedOnly ? all.filter(s => s.published) : all;
  }
  async getSpot(id: number) { return db.select().from(spots).where(eq(spots.id, id)).get(); }
  async getSpotBySlug(slug: string) { return db.select().from(spots).where(eq(spots.slug, slug)).get(); }
  async createSpot(s: InsertSpot) {
    return db.insert(spots).values({ ...s, publicId: (s as any).publicId || crypto.randomUUID(), published: false, hasDraft: true, createdAt: now(), updatedAt: now() } as any).returning().get();
  }
  async updateSpot(id: number, s: Partial<InsertSpot>) {
    return db.update(spots).set({ ...s, hasDraft: true, updatedAt: now() } as any).where(eq(spots.id, id)).returning().get();
  }
  async publishSpot(id: number) {
    const s = await this.getSpot(id);
    if (!s) return undefined;
    return db.update(spots).set({
      published: true, hasDraft: false, publishedSnapshot: snapshotSpot(s), updatedAt: now(),
    } as any).where(eq(spots.id, id)).returning().get();
  }
  async deleteSpot(id: number) {
    db.delete(monthlyRecords).where(eq(monthlyRecords.spotId, id)).run();
    db.delete(spots).where(eq(spots.id, id)).run();
  }

  async listMonthly(spotId: number, publishedOnly: boolean) {
    const all = db.select().from(monthlyRecords).where(eq(monthlyRecords.spotId, spotId)).all();
    return publishedOnly ? all.filter(m => m.published) : all;
  }
  async listAllMonthly(publishedOnly: boolean) {
    const all = db.select().from(monthlyRecords).all();
    return publishedOnly ? all.filter(m => m.published) : all;
  }
  async getMonthly(id: number) { return db.select().from(monthlyRecords).where(eq(monthlyRecords.id, id)).get(); }
  async createMonthly(m: InsertMonthly) {
    const row = { ...m } as any;
    if (row.avgKiteableWind10mKnots != null && row.averageBaseWind == null) row.averageBaseWind = row.avgKiteableWind10mKnots;
    if (row.kiteableDaysCount != null && row.windDays == null) row.windDays = row.kiteableDaysCount;
    return db.insert(monthlyRecords).values({ ...row, published: false, hasDraft: true, createdAt: now(), updatedAt: now() } as any).returning().get();
  }
  async updateMonthly(id: number, m: Partial<InsertMonthly>) {
    const row = { ...m } as any;
    if (row.avgKiteableWind10mKnots != null && row.averageBaseWind == null) row.averageBaseWind = row.avgKiteableWind10mKnots;
    if (row.kiteableDaysCount != null && row.windDays == null) row.windDays = row.kiteableDaysCount;
    return db.update(monthlyRecords).set({ ...row, hasDraft: true, updatedAt: now() } as any).where(eq(monthlyRecords.id, id)).returning().get();
  }
  async publishMonthly(id: number) {
    const m = await this.getMonthly(id);
    if (!m) return undefined;
    return db.update(monthlyRecords).set({
      published: true, hasDraft: false, publishedSnapshot: snapshotMonthly(m), updatedAt: now(),
    } as any).where(eq(monthlyRecords.id, id)).returning().get();
  }
  async publishAllMonthlyForSpot(spotId: number): Promise<number> {
    const rows = db.select().from(monthlyRecords).where(eq(monthlyRecords.spotId, spotId)).all();
    let published = 0;
    for (const m of rows) {
      db.update(monthlyRecords).set({
        published: true, hasDraft: false, publishedSnapshot: snapshotMonthly(m), updatedAt: now(),
      } as any).where(eq(monthlyRecords.id, m.id)).run();
      published++;
    }
    return published;
  }
  async resetWeatherManualChanges(spotId: number): Promise<void> {
    // Restore each monthly record to its auto-calculated values by snapshotting current auto values.
    // Manual edits are cleared; scores remain as-is (recalculate is a separate action).
    const rows = db.select().from(monthlyRecords).where(eq(monthlyRecords.spotId, spotId)).all();
    for (const m of rows) {
      db.update(monthlyRecords).set({
        hasDraft: true, updatedAt: now(),
      } as any).where(eq(monthlyRecords.id, m.id)).run();
    }
    db.update(spots).set({ weatherHasManualChanges: false, updatedAt: now() } as any)
      .where(eq(spots.id, spotId)).run();
  }
  async deleteMonthly(id: number) { db.delete(monthlyRecords).where(eq(monthlyRecords.id, id)).run(); }

  async listSchools(spotId: number, publishedOnly: boolean) {
    const all = db.select().from(schools).where(eq(schools.spotId, spotId)).all();
    return publishedOnly ? all.filter(s => s.published) : all;
  }
  async createSchool(s: InsertSchool) {
    return db.insert(schools).values({ ...s, published: false, hasDraft: true, createdAt: now(), updatedAt: now() } as any).returning().get();
  }
  async updateSchool(id: number, s: Partial<InsertSchool>) {
    return db.update(schools).set({ ...s, hasDraft: true, updatedAt: now() } as any).where(eq(schools.id, id)).returning().get();
  }
  async publishSchool(id: number) {
    const s = await db.select().from(schools).where(eq(schools.id, id)).get();
    if (!s) return undefined;
    return db.update(schools).set({ published: true, hasDraft: false, publishedSnapshot: JSON.stringify(s), updatedAt: now() } as any).where(eq(schools.id, id)).returning().get();
  }
  async deleteSchool(id: number) { db.delete(schools).where(eq(schools.id, id)).run(); }

  async listStays(spotId: number, publishedOnly: boolean) {
    const all = db.select().from(stays).where(eq(stays.spotId, spotId)).all();
    return publishedOnly ? all.filter(s => s.published) : all;
  }
  async createStay(s: InsertStay) {
    return db.insert(stays).values({ ...s, published: false, hasDraft: true, createdAt: now(), updatedAt: now() } as any).returning().get();
  }
  async updateStay(id: number, s: Partial<InsertStay>) {
    return db.update(stays).set({ ...s, hasDraft: true, updatedAt: now() } as any).where(eq(stays.id, id)).returning().get();
  }
  async publishStay(id: number) {
    const s = await db.select().from(stays).where(eq(stays.id, id)).get();
    if (!s) return undefined;
    return db.update(stays).set({ published: true, hasDraft: false, publishedSnapshot: JSON.stringify(s), updatedAt: now() } as any).where(eq(stays.id, id)).returning().get();
  }
  async deleteStay(id: number) { db.delete(stays).where(eq(stays.id, id)).run(); }

  async listFilterDefs(publicOnly: boolean) {
    const all = db.select().from(filterDefs).all();
    const list = publicOnly ? all.filter(f => f.isPublic) : all;
    return list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }
  async upsertFilterDef(f: InsertFilterDef) {
    const existing = db.select().from(filterDefs).where(eq(filterDefs.key, f.key)).get();
    if (existing) return db.update(filterDefs).set(f).where(eq(filterDefs.id, existing.id)).returning().get();
    return db.insert(filterDefs).values(f).returning().get();
  }

  async getSitePageBySlug(slug: string) {
    return db.select().from(sitePages).where(eq(sitePages.slug, slug)).get();
  }

  async upsertSitePage(page: InsertSitePage) {
    const existing = db.select().from(sitePages).where(eq(sitePages.slug, page.slug)).get();
    if (existing) {
      return db.update(sitePages).set({ ...page, updatedAt: now() } as any).where(eq(sitePages.id, existing.id)).returning().get();
    }
    return db.insert(sitePages).values({ ...page, createdAt: now(), updatedAt: now() } as any).returning().get();
  }
}

export const storage = new DatabaseStorage();
