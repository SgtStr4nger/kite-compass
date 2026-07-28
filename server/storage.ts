import { users, spots, monthlyRecords, filterDefs } from '@shared/schema';
import type {
  User, InsertUser, Spot, InsertSpot, MonthlyRecord, InsertMonthly,
  FilterDef, InsertFilterDef,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and } from "drizzle-orm";

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
  { name: "data_source", ddl: "data_source TEXT DEFAULT ''" },
  { name: "data_last_refreshed_at", ddl: "data_last_refreshed_at TEXT" },
  { name: "data_quality_note", ddl: "data_quality_note TEXT DEFAULT ''" },
]);
ensureColumns("monthly_records", [
  { name: "avg_wind_10m_knots", ddl: "avg_wind_10m_knots REAL" },
  { name: "max_wind_10m_knots", ddl: "max_wind_10m_knots REAL" },
  { name: "windy_days_count", ddl: "windy_days_count INTEGER" },
  { name: "avg_wave_height_m", ddl: "avg_wave_height_m REAL" },
  { name: "max_wave_height_m", ddl: "max_wave_height_m REAL" },
  { name: "avg_wave_period_s", ddl: "avg_wave_period_s REAL" },
  { name: "dominant_wave_direction_deg", ddl: "dominant_wave_direction_deg REAL" },
]);

const now = () => new Date().toISOString();

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
  deleteMonthly(id: number): Promise<void>;
  // filters
  listFilterDefs(publicOnly: boolean): Promise<FilterDef[]>;
  upsertFilterDef(f: InsertFilterDef): Promise<FilterDef>;
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
    return db.insert(spots).values({ ...s, published: false, hasDraft: true, createdAt: now(), updatedAt: now() } as any).returning().get();
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
    return db.insert(monthlyRecords).values({ ...m, published: false, hasDraft: true, createdAt: now(), updatedAt: now() } as any).returning().get();
  }
  async updateMonthly(id: number, m: Partial<InsertMonthly>) {
    return db.update(monthlyRecords).set({ ...m, hasDraft: true, updatedAt: now() } as any).where(eq(monthlyRecords.id, id)).returning().get();
  }
  async publishMonthly(id: number) {
    const m = await this.getMonthly(id);
    if (!m) return undefined;
    return db.update(monthlyRecords).set({
      published: true, hasDraft: false, publishedSnapshot: snapshotMonthly(m), updatedAt: now(),
    } as any).where(eq(monthlyRecords.id, id)).returning().get();
  }
  async deleteMonthly(id: number) { db.delete(monthlyRecords).where(eq(monthlyRecords.id, id)).run(); }

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
}

export const storage = new DatabaseStorage();
