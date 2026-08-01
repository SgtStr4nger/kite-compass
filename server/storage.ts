import { users, spots, monthlyRecords, filterDefs, schools, stays, sitePages, legalPages, seoSettings, spotSchools, spotStays } from '@shared/schema';
import type {
  User, InsertUser, Spot, InsertSpot, MonthlyRecord, InsertMonthly,
  School, InsertSchool, Stay, InsertStay,
  SitePage, InsertSitePage, LegalPage, SeoSettings,
  FilterDef, InsertFilterDef,
  SpotSchool, SpotStay,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, inArray } from "drizzle-orm";
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
  { name: "seo_title_override", ddl: "seo_title_override TEXT DEFAULT ''" },
  { name: "seo_description_override", ddl: "seo_description_override TEXT DEFAULT ''" },
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
ensureColumns("users", [
  { name: "role", ddl: "role TEXT NOT NULL DEFAULT 'standard'" },
  { name: "is_active", ddl: "is_active INTEGER NOT NULL DEFAULT 1" },
  { name: "must_change_password", ddl: "must_change_password INTEGER NOT NULL DEFAULT 0" },
  { name: "failed_login_attempts", ddl: "failed_login_attempts INTEGER NOT NULL DEFAULT 0" },
  { name: "temporary_lock_until", ddl: "temporary_lock_until TEXT" },
  { name: "is_fully_locked", ddl: "is_fully_locked INTEGER NOT NULL DEFAULT 0" },
  { name: "created_at", ddl: "created_at TEXT" },
  { name: "updated_at", ddl: "updated_at TEXT" },
]);

// ── Schools / Stays: migrate from embedded spot_id to assignment tables ──
// If spot_id is NOT NULL in the existing schools table we need to rebuild it so
// that globally-created schools (not yet assigned) can be inserted without a spotId.
function migrateSchoolsTable() {
  const tableInfo = sqlite.prepare(`PRAGMA table_info(schools)`).all() as any[];
  if (!tableInfo.length) return; // table doesn't exist yet — will be created fresh below
  const spotIdCol = tableInfo.find((c: any) => c.name === 'spot_id');
  if (!spotIdCol) return;
  if (!spotIdCol.notnull) {
    // Already nullable — just ensure new columns exist
    ensureColumns("schools", [
      { name: "sports", ddl: "sports TEXT DEFAULT '[]'" },
      { name: "short_description", ddl: "short_description TEXT DEFAULT ''" },
    ]);
    return;
  }
  // Rebuild: make spot_id nullable and add new columns
  sqlite.exec(`
    BEGIN;
    CREATE TABLE schools_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spot_id INTEGER,
      name TEXT NOT NULL,
      sports TEXT DEFAULT '[]',
      website_url TEXT DEFAULT '',
      map_url TEXT DEFAULT '',
      offers_rental INTEGER DEFAULT 0,
      offers_lessons INTEGER DEFAULT 0,
      short_description TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      favorite INTEGER DEFAULT 0,
      published INTEGER DEFAULT 0,
      has_draft INTEGER DEFAULT 1,
      published_snapshot TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    INSERT INTO schools_v2 (id, spot_id, name, website_url, map_url, offers_rental, offers_lessons, notes, favorite, published, has_draft, published_snapshot, created_at, updated_at)
      SELECT id, spot_id, name, website_url, map_url, offers_rental, offers_lessons, notes, favorite, published, has_draft, published_snapshot, created_at, updated_at FROM schools;
    DROP TABLE schools;
    ALTER TABLE schools_v2 RENAME TO schools;
    COMMIT;
  `);
}

function migrateStaysTable() {
  const tableInfo = sqlite.prepare(`PRAGMA table_info(stays)`).all() as any[];
  if (!tableInfo.length) return;
  const spotIdCol = tableInfo.find((c: any) => c.name === 'spot_id');
  if (!spotIdCol) return;
  if (!spotIdCol.notnull) {
    ensureColumns("stays", [
      { name: "short_description", ddl: "short_description TEXT DEFAULT ''" },
    ]);
    return;
  }
  sqlite.exec(`
    BEGIN;
    CREATE TABLE stays_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spot_id INTEGER,
      name TEXT NOT NULL,
      type TEXT DEFAULT '',
      website_url TEXT DEFAULT '',
      map_url TEXT DEFAULT '',
      short_description TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      favorite INTEGER DEFAULT 0,
      published INTEGER DEFAULT 0,
      has_draft INTEGER DEFAULT 1,
      published_snapshot TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    INSERT INTO stays_v2 (id, spot_id, name, type, website_url, map_url, notes, favorite, published, has_draft, published_snapshot, created_at, updated_at)
      SELECT id, spot_id, name, type, website_url, map_url, notes, favorite, published, has_draft, published_snapshot, created_at, updated_at FROM stays;
    DROP TABLE stays;
    ALTER TABLE stays_v2 RENAME TO stays;
    COMMIT;
  `);
}

migrateSchoolsTable();
migrateStaysTable();

const now = () => new Date().toISOString();

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'standard',
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    temporary_lock_until TEXT,
    is_fully_locked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spot_id INTEGER,
    name TEXT NOT NULL,
    sports TEXT DEFAULT '[]',
    website_url TEXT DEFAULT '',
    map_url TEXT DEFAULT '',
    offers_rental INTEGER DEFAULT 0,
    offers_lessons INTEGER DEFAULT 0,
    short_description TEXT DEFAULT '',
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
    spot_id INTEGER,
    name TEXT NOT NULL,
    type TEXT DEFAULT '',
    website_url TEXT DEFAULT '',
    map_url TEXT DEFAULT '',
    short_description TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    favorite INTEGER DEFAULT 0,
    published INTEGER DEFAULT 0,
    has_draft INTEGER DEFAULT 1,
    published_snapshot TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS spot_schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spot_id INTEGER NOT NULL,
    school_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(spot_id, school_id)
  );
  CREATE TABLE IF NOT EXISTS spot_stays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spot_id INTEGER NOT NULL,
    stay_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(spot_id, stay_id)
  );
  CREATE TABLE IF NOT EXISTS site_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS legal_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    privacy_policy_draft TEXT NOT NULL DEFAULT '',
    legal_notice_draft TEXT NOT NULL DEFAULT '',
    privacy_policy_published TEXT NOT NULL DEFAULT '',
    legal_notice_published TEXT NOT NULL DEFAULT '',
    has_draft INTEGER DEFAULT 1,
    published_at TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS seo_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    homepage_title_draft TEXT NOT NULL DEFAULT '',
    homepage_description_draft TEXT NOT NULL DEFAULT '',
    explore_title_draft TEXT NOT NULL DEFAULT '',
    explore_description_draft TEXT NOT NULL DEFAULT '',
    methodology_title_draft TEXT NOT NULL DEFAULT '',
    methodology_description_draft TEXT NOT NULL DEFAULT '',
    homepage_title_published TEXT NOT NULL DEFAULT '',
    homepage_description_published TEXT NOT NULL DEFAULT '',
    explore_title_published TEXT NOT NULL DEFAULT '',
    explore_description_published TEXT NOT NULL DEFAULT '',
    methodology_title_published TEXT NOT NULL DEFAULT '',
    methodology_description_published TEXT NOT NULL DEFAULT '',
    has_draft INTEGER DEFAULT 1,
    published_at TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`);

// Migrate existing schools/stays with spot_id into the assignment tables
function migrateAssignmentTables() {
  const schoolAssignCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM spot_schools`).get() as any).c;
  if (schoolAssignCount === 0) {
    const existingSchools = sqlite.prepare(`SELECT id, spot_id FROM schools WHERE spot_id IS NOT NULL AND spot_id > 0`).all() as any[];
    const stmt = sqlite.prepare(`INSERT OR IGNORE INTO spot_schools (spot_id, school_id, sort_order) VALUES (?, ?, ?)`);
    existingSchools.forEach((s, idx) => stmt.run(s.spot_id, s.id, idx));
  }
  const stayAssignCount = (sqlite.prepare(`SELECT COUNT(*) as c FROM spot_stays`).get() as any).c;
  if (stayAssignCount === 0) {
    const existingStays = sqlite.prepare(`SELECT id, spot_id FROM stays WHERE spot_id IS NOT NULL AND spot_id > 0`).all() as any[];
    const stmt = sqlite.prepare(`INSERT OR IGNORE INTO spot_stays (spot_id, stay_id, sort_order) VALUES (?, ?, ?)`);
    existingStays.forEach((s, idx) => stmt.run(s.spot_id, s.id, idx));
  }
}
migrateAssignmentTables();

ensureColumns("site_pages", [
  { name: "slug", ddl: "slug TEXT NOT NULL UNIQUE" },
  { name: "title", ddl: "title TEXT NOT NULL" },
  { name: "body", ddl: "body TEXT NOT NULL" },
]);
ensureColumns("legal_pages", [
  { name: "privacy_policy_draft", ddl: "privacy_policy_draft TEXT NOT NULL DEFAULT ''" },
  { name: "legal_notice_draft", ddl: "legal_notice_draft TEXT NOT NULL DEFAULT ''" },
  { name: "privacy_policy_published", ddl: "privacy_policy_published TEXT NOT NULL DEFAULT ''" },
  { name: "legal_notice_published", ddl: "legal_notice_published TEXT NOT NULL DEFAULT ''" },
  { name: "has_draft", ddl: "has_draft INTEGER DEFAULT 1" },
  { name: "published_at", ddl: "published_at TEXT" },
]);
ensureColumns("seo_settings", [
  { name: "homepage_title_draft", ddl: "homepage_title_draft TEXT NOT NULL DEFAULT ''" },
  { name: "homepage_description_draft", ddl: "homepage_description_draft TEXT NOT NULL DEFAULT ''" },
  { name: "explore_title_draft", ddl: "explore_title_draft TEXT NOT NULL DEFAULT ''" },
  { name: "explore_description_draft", ddl: "explore_description_draft TEXT NOT NULL DEFAULT ''" },
  { name: "methodology_title_draft", ddl: "methodology_title_draft TEXT NOT NULL DEFAULT ''" },
  { name: "methodology_description_draft", ddl: "methodology_description_draft TEXT NOT NULL DEFAULT ''" },
  { name: "homepage_title_published", ddl: "homepage_title_published TEXT NOT NULL DEFAULT ''" },
  { name: "homepage_description_published", ddl: "homepage_description_published TEXT NOT NULL DEFAULT ''" },
  { name: "explore_title_published", ddl: "explore_title_published TEXT NOT NULL DEFAULT ''" },
  { name: "explore_description_published", ddl: "explore_description_published TEXT NOT NULL DEFAULT ''" },
  { name: "methodology_title_published", ddl: "methodology_title_published TEXT NOT NULL DEFAULT ''" },
  { name: "methodology_description_published", ddl: "methodology_description_published TEXT NOT NULL DEFAULT ''" },
  { name: "has_draft", ddl: "has_draft INTEGER DEFAULT 1" },
  { name: "published_at", ddl: "published_at TEXT" },
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

const defaultPrivacyPolicyBody = [
  "Privacy Policy",
  "",
  "This privacy policy explains what data Kite Compass processes and for which purposes.",
  "",
  "Please replace this placeholder text with your final legal content before publishing.",
].join("\n");

const defaultLegalNoticeBody = defaultImpressumBody;
const DEFAULT_SEO_VALUES = {
  homepageTitle: "Kite Compass | Find your perfect kitesurf month",
  homepageDescription: "Discover the best kitesurfing destinations month by month with Kite Compass rankings, wind insights and travel context.",
  exploreTitle: "Explore Kitesurf Spots by Month | Kite Compass",
  exploreDescription: "Browse and compare kitesurf spots worldwide. Filter by season, conditions and travel vibe to find your next trip.",
  methodologyTitle: "Methodology | How Kite Compass Ranks Spots",
  methodologyDescription: "Learn how Kite Compass evaluates monthly kitesurf conditions, seasonality and destination fit across global spots.",
} as const;

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

function ensureDefaultLegalPages() {
  const row = db.select().from(legalPages).get();
  if (row) return;
  const legacyImpressum = db.select().from(sitePages).where(eq(sitePages.slug, "impressum")).get();
  const seededLegalNotice = legacyImpressum?.body?.trim() ? legacyImpressum.body : defaultLegalNoticeBody;
  db.insert(legalPages).values({
    privacyPolicyDraft: defaultPrivacyPolicyBody,
    legalNoticeDraft: seededLegalNotice,
    privacyPolicyPublished: defaultPrivacyPolicyBody,
    legalNoticePublished: seededLegalNotice,
    hasDraft: false,
    publishedAt: now(),
    createdAt: now(),
    updatedAt: now(),
  } as any).run();
}
ensureDefaultLegalPages();

function ensureDefaultSeoSettings() {
  const row = db.select().from(seoSettings).get();
  if (row) return;
  const timestamp = now();
  db.insert(seoSettings).values({
    homepageTitleDraft: DEFAULT_SEO_VALUES.homepageTitle,
    homepageDescriptionDraft: DEFAULT_SEO_VALUES.homepageDescription,
    exploreTitleDraft: DEFAULT_SEO_VALUES.exploreTitle,
    exploreDescriptionDraft: DEFAULT_SEO_VALUES.exploreDescription,
    methodologyTitleDraft: DEFAULT_SEO_VALUES.methodologyTitle,
    methodologyDescriptionDraft: DEFAULT_SEO_VALUES.methodologyDescription,
    homepageTitlePublished: DEFAULT_SEO_VALUES.homepageTitle,
    homepageDescriptionPublished: DEFAULT_SEO_VALUES.homepageDescription,
    exploreTitlePublished: DEFAULT_SEO_VALUES.exploreTitle,
    exploreDescriptionPublished: DEFAULT_SEO_VALUES.exploreDescription,
    methodologyTitlePublished: DEFAULT_SEO_VALUES.methodologyTitle,
    methodologyDescriptionPublished: DEFAULT_SEO_VALUES.methodologyDescription,
    hasDraft: false,
    publishedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as any).run();
}
ensureDefaultSeoSettings();

function ensureSpotPublicIds() {
  const rows = db.select({ id: spots.id, publicId: spots.publicId }).from(spots).all();
  for (const row of rows) {
    if (!row.publicId) {
      db.update(spots).set({ publicId: crypto.randomUUID(), updatedAt: now() } as any).where(eq(spots.id, row.id)).run();
    }
  }
}
ensureSpotPublicIds();

function ensureSingleActiveMainAdmin() {
  const allUsers = db.select().from(users).all();
  if (!allUsers.length) return;

  const ordered = allUsers.slice().sort((a, b) => {
    const aTs = new Date(a.createdAt || "").getTime();
    const bTs = new Date(b.createdAt || "").getTime();
    if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return aTs - bTs;
    return a.id - b.id;
  });

  const activeMains = ordered.filter(u => u.role === "main" && !!u.isActive);
  if (activeMains.length === 0) {
    const fallback = ordered.find(u => !!u.isActive) ?? ordered[0];
    db.update(users).set({ role: "main", isActive: true, updatedAt: now() } as any).where(eq(users.id, fallback.id)).run();
  } else if (activeMains.length > 1) {
    const keeper = activeMains[0];
    for (const u of activeMains.slice(1)) {
      db.update(users).set({ role: "standard", updatedAt: now() } as any).where(eq(users.id, u.id)).run();
    }
    db.update(users).set({ role: "main", isActive: true, updatedAt: now() } as any).where(eq(users.id, keeper.id)).run();
  }
}
ensureSingleActiveMainAdmin();

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
function tryParseArr(v: any): string[] {
  try { const a = JSON.parse(v ?? "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}

function toLegalContent(row: LegalPage): LegalContent {
  return {
    privacyPolicyDraft: row.privacyPolicyDraft,
    legalNoticeDraft: row.legalNoticeDraft,
    privacyPolicyPublished: row.privacyPolicyPublished,
    legalNoticePublished: row.legalNoticePublished,
    hasDraft: !!row.hasDraft,
    publishedAt: row.publishedAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

function toSeoContent(row: SeoSettings): SeoContent {
  return {
    homepageTitleDraft: row.homepageTitleDraft,
    homepageDescriptionDraft: row.homepageDescriptionDraft,
    exploreTitleDraft: row.exploreTitleDraft,
    exploreDescriptionDraft: row.exploreDescriptionDraft,
    methodologyTitleDraft: row.methodologyTitleDraft,
    methodologyDescriptionDraft: row.methodologyDescriptionDraft,
    homepageTitlePublished: row.homepageTitlePublished,
    homepageDescriptionPublished: row.homepageDescriptionPublished,
    exploreTitlePublished: row.exploreTitlePublished,
    exploreDescriptionPublished: row.exploreDescriptionPublished,
    methodologyTitlePublished: row.methodologyTitlePublished,
    methodologyDescriptionPublished: row.methodologyDescriptionPublished,
    hasDraft: !!row.hasDraft,
    publishedAt: row.publishedAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export interface ListingsFilter {
  search?: string;
  published?: boolean;
  spotId?: number;
  missingWebsite?: boolean;
  missingMap?: boolean;
  // schools only
  sports?: string[];
  offersLessons?: boolean;
  offersRental?: boolean;
  // stays only
  type?: string;
  // pagination
  sortBy?: "name" | "updatedAt";
  sortDir?: "asc" | "desc";
  page?: number;
  perPage?: number;
}

export interface ListingsPage<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface LegalContent {
  privacyPolicyDraft: string;
  legalNoticeDraft: string;
  privacyPolicyPublished: string;
  legalNoticePublished: string;
  hasDraft: boolean;
  publishedAt: string | null;
  updatedAt: string | null;
}

export interface SeoContent {
  homepageTitleDraft: string;
  homepageDescriptionDraft: string;
  exploreTitleDraft: string;
  exploreDescriptionDraft: string;
  methodologyTitleDraft: string;
  methodologyDescriptionDraft: string;
  homepageTitlePublished: string;
  homepageDescriptionPublished: string;
  exploreTitlePublished: string;
  exploreDescriptionPublished: string;
  methodologyTitlePublished: string;
  methodologyDescriptionPublished: string;
  hasDraft: boolean;
  publishedAt: string | null;
  updatedAt: string | null;
}

export type AdminRole = "main" | "standard";
export interface CreateAdminUserInput {
  email: string;
  passwordHash: string;
  role: AdminRole;
  mustChangePassword: boolean;
}
export interface AdminUserSummary {
  id: number;
  email: string;
  role: AdminRole;
  isActive: boolean;
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  temporaryLockUntil: string | null;
  isFullyLocked: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface IStorage {
  // auth
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  countUsers(): Promise<number>;
  createUser(u: CreateAdminUserInput): Promise<User>;
  updateUser(id: number, patch: Partial<InsertUser>): Promise<User | undefined>;
  listAdminUsers(): Promise<AdminUserSummary[]>;
  countActiveMainAdmins(): Promise<number>;
  getActiveMainAdmin(): Promise<User | undefined>;
  transferMainOwnership(currentMainUserId: number, nextMainUserId: number): Promise<void>;
  deleteUser(id: number): Promise<void>;
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
  // schools — global entity CRUD
  getSchool(id: number): Promise<School | undefined>;
  listAllSchools(filter: ListingsFilter): Promise<ListingsPage<School & { assignedSpotsCount: number }>>;
  createSchool(s: InsertSchool): Promise<School>;
  updateSchool(id: number, s: Partial<InsertSchool>): Promise<School | undefined>;
  publishSchool(id: number): Promise<School | undefined>;
  deleteSchool(id: number): Promise<void>;
  // schools — spot assignments
  listSchoolsForSpot(spotId: number, publishedOnly: boolean): Promise<School[]>;
  assignSchool(spotId: number, schoolId: number): Promise<SpotSchool>;
  unassignSchool(spotId: number, schoolId: number): Promise<void>;
  reorderSchoolAssignments(spotId: number, orderedSchoolIds: number[]): Promise<void>;
  // stays — global entity CRUD
  getStay(id: number): Promise<Stay | undefined>;
  listAllStays(filter: ListingsFilter): Promise<ListingsPage<Stay & { assignedSpotsCount: number }>>;
  createStay(s: InsertStay): Promise<Stay>;
  updateStay(id: number, s: Partial<InsertStay>): Promise<Stay | undefined>;
  publishStay(id: number): Promise<Stay | undefined>;
  deleteStay(id: number): Promise<void>;
  // stays — spot assignments
  listStaysForSpot(spotId: number, publishedOnly: boolean): Promise<Stay[]>;
  assignStay(spotId: number, stayId: number): Promise<SpotStay>;
  unassignStay(spotId: number, stayId: number): Promise<void>;
  reorderStayAssignments(spotId: number, orderedStayIds: number[]): Promise<void>;
  // filters
  listFilterDefs(publicOnly: boolean): Promise<FilterDef[]>;
  upsertFilterDef(f: InsertFilterDef): Promise<FilterDef>;
  // content pages
  getSitePageBySlug(slug: string): Promise<SitePage | undefined>;
  upsertSitePage(page: InsertSitePage): Promise<SitePage>;
  // legal pages (shared draft/publish)
  getLegalContent(): Promise<LegalContent>;
  saveLegalDraft(privacyPolicyDraft: string, legalNoticeDraft: string): Promise<LegalContent>;
  publishLegalDraft(): Promise<LegalContent>;
  // SEO settings (shared draft/publish)
  getSeoContent(): Promise<SeoContent>;
  saveSeoDraft(next: Pick<SeoContent, "homepageTitleDraft" | "homepageDescriptionDraft" | "exploreTitleDraft" | "exploreDescriptionDraft" | "methodologyTitleDraft" | "methodologyDescriptionDraft">): Promise<SeoContent>;
  publishSeoDraft(): Promise<SeoContent>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number) { return db.select().from(users).where(eq(users.id, id)).get(); }
  async getUserByEmail(email: string) { return db.select().from(users).where(eq(users.email, email.toLowerCase())).get(); }
  async countUsers() { return db.select().from(users).all().length; }
  async createUser(u: CreateAdminUserInput) {
    return db.insert(users).values({
      email: u.email.toLowerCase(),
      passwordHash: u.passwordHash,
      role: u.role,
      isActive: true,
      mustChangePassword: u.mustChangePassword,
      failedLoginAttempts: 0,
      temporaryLockUntil: null,
      isFullyLocked: false,
      createdAt: now(),
      updatedAt: now(),
    } as any).returning().get();
  }
  async updateUser(id: number, patch: Partial<InsertUser>) {
    return db.update(users).set({ ...patch, updatedAt: now() } as any).where(eq(users.id, id)).returning().get();
  }
  async listAdminUsers(): Promise<AdminUserSummary[]> {
    const rows = db.select().from(users).all();
    return rows
      .sort((a, b) => a.email.localeCompare(b.email))
      .map(row => ({
        id: row.id,
        email: row.email,
        role: (row.role === "main" ? "main" : "standard") as AdminRole,
        isActive: !!row.isActive,
        mustChangePassword: !!row.mustChangePassword,
        failedLoginAttempts: row.failedLoginAttempts ?? 0,
        temporaryLockUntil: row.temporaryLockUntil ?? null,
        isFullyLocked: !!row.isFullyLocked,
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null,
      }));
  }
  async countActiveMainAdmins(): Promise<number> {
    return db.select().from(users).where(and(eq(users.role, "main"), eq(users.isActive, true))).all().length;
  }
  async getActiveMainAdmin() {
    return db.select().from(users).where(and(eq(users.role, "main"), eq(users.isActive, true))).get();
  }
  async transferMainOwnership(currentMainUserId: number, nextMainUserId: number): Promise<void> {
    sqlite.exec("BEGIN");
    try {
      db.update(users).set({ role: "standard", updatedAt: now() } as any).where(eq(users.id, currentMainUserId)).run();
      db.update(users).set({ role: "main", isActive: true, updatedAt: now() } as any).where(eq(users.id, nextMainUserId)).run();
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  async deleteUser(id: number) {
    db.delete(users).where(eq(users.id, id)).run();
  }

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
    db.delete(spotSchools).where(eq(spotSchools.spotId, id)).run();
    db.delete(spotStays).where(eq(spotStays.spotId, id)).run();
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

  // ── Schools: global entity CRUD ──

  async getSchool(id: number) { return db.select().from(schools).where(eq(schools.id, id)).get(); }

  async listAllSchools(filter: ListingsFilter): Promise<ListingsPage<School & { assignedSpotsCount: number }>> {
    let all = db.select().from(schools).all();
    const assignments = db.select().from(spotSchools).all();
    const assignCountById: Record<number, number> = {};
    for (const a of assignments) assignCountById[a.schoolId] = (assignCountById[a.schoolId] || 0) + 1;

    if (filter.search) {
      const q = filter.search.toLowerCase();
      all = all.filter(s => s.name.toLowerCase().includes(q));
    }
    if (filter.published !== undefined) all = all.filter(s => !!s.published === filter.published);
    if (filter.spotId !== undefined) {
      const ids = new Set(assignments.filter(a => a.spotId === filter.spotId).map(a => a.schoolId));
      all = all.filter(s => ids.has(s.id));
    }
    if (filter.missingWebsite) all = all.filter(s => !s.websiteUrl);
    if (filter.missingMap) all = all.filter(s => !s.mapUrl);
    if (filter.offersLessons !== undefined) all = all.filter(s => !!s.offersLessons === filter.offersLessons);
    if (filter.offersRental !== undefined) all = all.filter(s => !!s.offersRental === filter.offersRental);
    if (filter.sports?.length) {
      all = all.filter(s => {
        const sp = tryParseArr(s.sports);
        return filter.sports!.some(x => sp.includes(x));
      });
    }

    const sortBy = filter.sortBy || "updatedAt";
    const sortDir = filter.sortDir || "desc";
    all.sort((a, b) => {
      const av = sortBy === "name" ? a.name : (a.updatedAt || "");
      const bv = sortBy === "name" ? b.name : (b.updatedAt || "");
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    const total = all.length;
    const perPage = filter.perPage || 50;
    const page = filter.page || 1;
    const start = (page - 1) * perPage;
    const items = all.slice(start, start + perPage).map(s => ({ ...s, assignedSpotsCount: assignCountById[s.id] || 0 }));
    return { items, total, page, perPage };
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
  async deleteSchool(id: number) {
    db.delete(spotSchools).where(eq(spotSchools.schoolId, id)).run();
    db.delete(schools).where(eq(schools.id, id)).run();
  }

  // ── Schools: spot assignments ──

  async listSchoolsForSpot(spotId: number, publishedOnly: boolean): Promise<School[]> {
    const assignments = db.select().from(spotSchools).where(eq(spotSchools.spotId, spotId))
      .all().sort((a, b) => a.sortOrder - b.sortOrder);
    if (!assignments.length) return [];
    const ids = assignments.map(a => a.schoolId);
    const rows = db.select().from(schools).where(inArray(schools.id, ids)).all();
    const byId = new Map(rows.map(r => [r.id, r]));
    const ordered = assignments.map(a => byId.get(a.schoolId)).filter(Boolean) as School[];
    return publishedOnly ? ordered.filter(s => s.published) : ordered;
  }

  async assignSchool(spotId: number, schoolId: number): Promise<SpotSchool> {
    // Determine next sort_order for this spot
    const existing = db.select().from(spotSchools).where(eq(spotSchools.spotId, spotId)).all();
    const maxOrder = existing.length ? Math.max(...existing.map(a => a.sortOrder)) : -1;
    return db.insert(spotSchools).values({ spotId, schoolId, sortOrder: maxOrder + 1 }).returning().get();
  }

  async unassignSchool(spotId: number, schoolId: number): Promise<void> {
    db.delete(spotSchools).where(and(eq(spotSchools.spotId, spotId), eq(spotSchools.schoolId, schoolId))).run();
  }

  async reorderSchoolAssignments(spotId: number, orderedSchoolIds: number[]): Promise<void> {
    for (let i = 0; i < orderedSchoolIds.length; i++) {
      db.update(spotSchools)
        .set({ sortOrder: i })
        .where(and(eq(spotSchools.spotId, spotId), eq(spotSchools.schoolId, orderedSchoolIds[i])))
        .run();
    }
  }

  // ── Stays: global entity CRUD ──

  async getStay(id: number) { return db.select().from(stays).where(eq(stays.id, id)).get(); }

  async listAllStays(filter: ListingsFilter): Promise<ListingsPage<Stay & { assignedSpotsCount: number }>> {
    let all = db.select().from(stays).all();
    const assignments = db.select().from(spotStays).all();
    const assignCountById: Record<number, number> = {};
    for (const a of assignments) assignCountById[a.stayId] = (assignCountById[a.stayId] || 0) + 1;

    if (filter.search) {
      const q = filter.search.toLowerCase();
      all = all.filter(s => s.name.toLowerCase().includes(q));
    }
    if (filter.published !== undefined) all = all.filter(s => !!s.published === filter.published);
    if (filter.spotId !== undefined) {
      const ids = new Set(assignments.filter(a => a.spotId === filter.spotId).map(a => a.stayId));
      all = all.filter(s => ids.has(s.id));
    }
    if (filter.missingWebsite) all = all.filter(s => !s.websiteUrl);
    if (filter.missingMap) all = all.filter(s => !s.mapUrl);
    if (filter.type) all = all.filter(s => s.type === filter.type);

    const sortBy = filter.sortBy || "updatedAt";
    const sortDir = filter.sortDir || "desc";
    all.sort((a, b) => {
      const av = sortBy === "name" ? a.name : (a.updatedAt || "");
      const bv = sortBy === "name" ? b.name : (b.updatedAt || "");
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    const total = all.length;
    const perPage = filter.perPage || 50;
    const page = filter.page || 1;
    const start = (page - 1) * perPage;
    const items = all.slice(start, start + perPage).map(s => ({ ...s, assignedSpotsCount: assignCountById[s.id] || 0 }));
    return { items, total, page, perPage };
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
  async deleteStay(id: number) {
    db.delete(spotStays).where(eq(spotStays.stayId, id)).run();
    db.delete(stays).where(eq(stays.id, id)).run();
  }

  // ── Stays: spot assignments ──

  async listStaysForSpot(spotId: number, publishedOnly: boolean): Promise<Stay[]> {
    const assignments = db.select().from(spotStays).where(eq(spotStays.spotId, spotId))
      .all().sort((a, b) => a.sortOrder - b.sortOrder);
    if (!assignments.length) return [];
    const ids = assignments.map(a => a.stayId);
    const rows = db.select().from(stays).where(inArray(stays.id, ids)).all();
    const byId = new Map(rows.map(r => [r.id, r]));
    const ordered = assignments.map(a => byId.get(a.stayId)).filter(Boolean) as Stay[];
    return publishedOnly ? ordered.filter(s => s.published) : ordered;
  }

  async assignStay(spotId: number, stayId: number): Promise<SpotStay> {
    const existing = db.select().from(spotStays).where(eq(spotStays.spotId, spotId)).all();
    const maxOrder = existing.length ? Math.max(...existing.map(a => a.sortOrder)) : -1;
    return db.insert(spotStays).values({ spotId, stayId, sortOrder: maxOrder + 1 }).returning().get();
  }

  async unassignStay(spotId: number, stayId: number): Promise<void> {
    db.delete(spotStays).where(and(eq(spotStays.spotId, spotId), eq(spotStays.stayId, stayId))).run();
  }

  async reorderStayAssignments(spotId: number, orderedStayIds: number[]): Promise<void> {
    for (let i = 0; i < orderedStayIds.length; i++) {
      db.update(spotStays)
        .set({ sortOrder: i })
        .where(and(eq(spotStays.spotId, spotId), eq(spotStays.stayId, orderedStayIds[i])))
        .run();
    }
  }

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

  async getLegalContent() {
    const row = db.select().from(legalPages).get();
    if (!row) throw new Error("legal pages not initialized");
    return toLegalContent(row);
  }

  async saveLegalDraft(privacyPolicyDraft: string, legalNoticeDraft: string) {
    const row = db.select().from(legalPages).get();
    if (!row) throw new Error("legal pages not initialized");
    const updated = db.update(legalPages).set({
      privacyPolicyDraft,
      legalNoticeDraft,
      hasDraft: true,
      updatedAt: now(),
    } as any).where(eq(legalPages.id, row.id)).returning().get();
    return toLegalContent(updated);
  }

  async publishLegalDraft() {
    const row = db.select().from(legalPages).get();
    if (!row) throw new Error("legal pages not initialized");
    const nextPublishedAt = now();
    const updated = sqlite.transaction(() => {
      const out = db.update(legalPages).set({
        privacyPolicyPublished: row.privacyPolicyDraft,
        legalNoticePublished: row.legalNoticeDraft,
        hasDraft: false,
        publishedAt: nextPublishedAt,
        updatedAt: nextPublishedAt,
      } as any).where(eq(legalPages.id, row.id)).returning().get();
      return out;
    })();
    return toLegalContent(updated);
  }

  async getSeoContent() {
    const row = db.select().from(seoSettings).get();
    if (!row) throw new Error("seo settings not initialized");
    return toSeoContent(row);
  }

  async saveSeoDraft(next: Pick<SeoContent, "homepageTitleDraft" | "homepageDescriptionDraft" | "exploreTitleDraft" | "exploreDescriptionDraft" | "methodologyTitleDraft" | "methodologyDescriptionDraft">) {
    const row = db.select().from(seoSettings).get();
    if (!row) throw new Error("seo settings not initialized");
    const updated = db.update(seoSettings).set({
      ...next,
      hasDraft: true,
      updatedAt: now(),
    } as any).where(eq(seoSettings.id, row.id)).returning().get();
    return toSeoContent(updated);
  }

  async publishSeoDraft() {
    const row = db.select().from(seoSettings).get();
    if (!row) throw new Error("seo settings not initialized");
    const nextPublishedAt = now();
    const updated = sqlite.transaction(() => {
      return db.update(seoSettings).set({
        homepageTitlePublished: row.homepageTitleDraft,
        homepageDescriptionPublished: row.homepageDescriptionDraft,
        exploreTitlePublished: row.exploreTitleDraft,
        exploreDescriptionPublished: row.exploreDescriptionDraft,
        methodologyTitlePublished: row.methodologyTitleDraft,
        methodologyDescriptionPublished: row.methodologyDescriptionDraft,
        hasDraft: false,
        publishedAt: nextPublishedAt,
        updatedAt: nextPublishedAt,
      } as any).where(eq(seoSettings.id, row.id)).returning().get();
    })();
    return toSeoContent(updated);
  }
}

export const storage = new DatabaseStorage();
