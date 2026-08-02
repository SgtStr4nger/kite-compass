import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { and, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db, storage, sqlite, logError } from "./storage";
import type { ListingsFilter, SeoContent, TrashCategory, RedirectRow, AdminErrorStatus } from "./storage";
import { enrichSpotById, MissingCoordinatesError } from "./services/enrichment";
import { getContinentForCountry } from "@shared/locations";
import { bestEvaluableScore, calculateAutoMonthlyScore, deriveSeasonLabelFromScore, resolveMonthlyScore, type ScoringConfig } from "@shared/scoring";
import { insertSpotSchema, insertMonthlySchema, monthlyRecords, schools, spots, stays, spotSchools, spotStays } from "@shared/schema";
import type { Spot, MonthlyRecord, InsertMonthly, InsertSchool, InsertStay } from "@shared/schema";

// Fixed Jan→Dec order for compact season strips (server-side; mirrors client MONTHS).
const MONTH_ORDER = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

type DataStatus = "fresh" | "dirty" | "missing";

// Spec §20.1 content status
type ContentStatus = "unpublished" | "published" | "published-draft";
// Spec §20.2 weather status
type WeatherStatus = "Missing" | "Up to date" | "Up to date · Manual changes" | "Outdated" | "Update failed";

let scoringRecalcActive = false;

const REFRESH_SPOT_DELAY_MS = 1500;
const OPEN_METEO_MAX_REQUESTS_PER_MINUTE = 50;
const ESTIMATED_REQUESTS_PER_SPOT_REFRESH = 2;
const OPEN_METEO_WINDOW_MS = 60_000;
const EXCEL_MAX_ROWS = 5000;
const EXCEL_RETENTION_DAYS = 30;
const EXCEL_ACTIVE_STATUSES = new Set(["Uploading", "Validating", "Ready for confirmation", "Importing", "Rolling back"]);
const EXCEL_TERMINAL_STATUSES = new Set(["Completed", "Failed", "Cancelled"]);
const SPOT_TYPES = new Set(["flat-water", "chop", "waves", "lagoon", "foil", "freestyle"]);
const RIDER_LEVELS = new Set(["beginner", "intermediate", "advanced"]);
const VIBE_TAGS = new Set(["city", "town", "village", "remote", "touristy", "local-scene", "family-friendly", "nightlife"]);
const WATER_STATES = new Set(["Flat", "Choppy", "Wave", "Mixed"]);
const SCHOOL_SPORTS = new Set(["Kitesurfing", "Wingfoiling", "Kitefoiling", "Surfing"]);
const STAY_TYPES = new Set(["Hotel", "Hostel", "Apartment", "Guesthouse", "Resort"]);
const XLSX_COLUMNS = {
  spots: [
    "internal_id", "name", "country_code", "latitude", "longitude", "weather_latitude", "weather_longitude",
    "onshore_direction_degrees", "spot_description", "kite_conditions_description", "warning_text", "rider_levels",
    "water_states", "destination_type", "destination_vibes",
  ],
  schools: [
    "internal_id", "name", "sports", "lessons", "rental", "website_url", "google_maps_url", "short_description", "published", "spot_ids",
  ],
  stays: [
    "internal_id", "name", "type", "website_url", "google_maps_url", "short_description", "published", "spot_ids",
  ],
} as const;
const XLSX_SHEETS = { spots: "Spots", schools: "Kite Schools", stays: "Stays" } as const;
type ExcelCategory = keyof typeof XLSX_COLUMNS;
type ExcelImportAction = "create_update" | "create_only";
type ImportRowKind = "new" | "update" | "error_id_not_found" | "error_invalid_data";
type ParsedImportRow = {
  rowNumber: number;
  kind: ImportRowKind;
  internalId: number | null;
  error: string | null;
  values: Record<string, string>;
  normalized: Record<string, unknown> | null;
};
type ExcelPreviewSession = {
  id: string;
  category: ExcelCategory;
  fileName: string;
  rows: ParsedImportRow[];
  createdAtIso: string;
  runId: number;
};
type ExcelStatusRow = {
  status: string;
  category: string | null;
  run_id: number | null;
  message: string | null;
  dismissible: number;
  dismissed: number;
  updated_at: string | null;
};
const excelPreviewSessions = new Map<string, ExcelPreviewSession>();
let weatherImportActive = false;

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS excel_import_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    status TEXT NOT NULL DEFAULT 'Idle',
    category TEXT,
    run_id INTEGER,
    message TEXT DEFAULT '',
    dismissible INTEGER NOT NULL DEFAULT 0,
    dismissed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS excel_import_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    file_name TEXT NOT NULL,
    status TEXT NOT NULL,
    created_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0,
    update_count INTEGER NOT NULL DEFAULT 0,
    error_id_not_found_count INTEGER NOT NULL DEFAULT 0,
    error_invalid_data_count INTEGER NOT NULL DEFAULT 0,
    start_at TEXT,
    end_at TEXT,
    duration_ms INTEGER,
    technical_error TEXT,
    rollback_notice TEXT,
    source_file_base64 TEXT,
    updates_file_base64 TEXT,
    errors_file_base64 TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`);
const existingExcelState = sqlite.prepare(`SELECT id FROM excel_import_state WHERE id = 1`).get() as { id: number } | undefined;
if (!existingExcelState) {
  sqlite.prepare(`
    INSERT INTO excel_import_state (id, status, category, run_id, message, dismissible, dismissed, updated_at)
    VALUES (1, 'Idle', NULL, NULL, '', 0, 0, ?)
  `).run(new Date().toISOString());
}

function sanitizeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_") || "import.xlsx";
}
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
function slugifyName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function isExcelCategory(v: string): v is ExcelCategory {
  return v === "spots" || v === "schools" || v === "stays";
}
function toCellString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}
function parseNullableNumber(raw: string): { ok: true; value: number | null } | { ok: false } {
  if (!raw) return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}
function parseBooleanCell(raw: string): { ok: true; value: boolean } | { ok: false } {
  if (!raw) return { ok: true, value: false };
  const lowered = raw.toLowerCase();
  if (["1", "true", "yes", "y"].includes(lowered)) return { ok: true, value: true };
  if (["0", "false", "no", "n"].includes(lowered)) return { ok: true, value: false };
  return { ok: false };
}
function parseCsv(raw: string): string[] {
  if (!raw) return [];
  return Array.from(new Set(raw.split(",").map(v => v.trim()).filter(Boolean)));
}
function getExcelState(): ExcelStatusRow {
  return (sqlite.prepare(`
    SELECT status, category, run_id, message, dismissible, dismissed, updated_at
    FROM excel_import_state
    WHERE id = 1
  `).get() as ExcelStatusRow);
}
function setExcelState(status: string, patch: Partial<Pick<ExcelStatusRow, "category" | "run_id" | "message">> & { dismissible?: boolean; dismissed?: boolean } = {}) {
  sqlite.prepare(`
    UPDATE excel_import_state
    SET status = ?, category = ?, run_id = ?, message = ?, dismissible = ?, dismissed = ?, updated_at = ?
    WHERE id = 1
  `).run(
    status,
    patch.category ?? null,
    patch.run_id ?? null,
    patch.message ?? "",
    patch.dismissible ? 1 : 0,
    patch.dismissed ? 1 : 0,
    new Date().toISOString(),
  );
}
function isExcelImportActive(): boolean {
  return EXCEL_ACTIVE_STATUSES.has(getExcelState().status);
}
function shouldBlockForExcel(req: Request): boolean {
  if (!req.path.startsWith("/api/admin")) return false;
  if (!isExcelImportActive()) return false;
  const allowed = req.path.startsWith("/api/admin/excel/status")
    || req.path.startsWith("/api/admin/excel/import/")
    || req.path.startsWith("/api/admin/excel/dismiss")
    || req.path.startsWith("/api/admin/trash");
  if (allowed) return false;
  return req.method !== "GET";
}
function pruneImportFileRetention() {
  const cutoff = new Date(Date.now() - EXCEL_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  sqlite.prepare(`
    UPDATE excel_import_history
    SET source_file_base64 = NULL, updates_file_base64 = NULL, errors_file_base64 = NULL
    WHERE created_at < ? AND (source_file_base64 IS NOT NULL OR updates_file_base64 IS NOT NULL OR errors_file_base64 IS NOT NULL)
  `).run(cutoff);
}
function setNoStore(res: Response) {
  res.setHeader("Cache-Control", "no-store");
}
function writeWorkbookBase64(sheetName: string, headers: readonly string[], rows: Record<string, unknown>[]): string {
  const aoa: unknown[][] = [Array.from(headers), ...rows.map(row => headers.map(h => row[h] ?? ""))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf.toString("base64");
}
async function parseImportRowsFromWorkbookBase64(category: ExcelCategory, fileBase64: string): Promise<ParsedImportRow[]> {
  const workbook = XLSX.read(Buffer.from(fileBase64, "base64"), { type: "buffer" });
  const sheetName = XLSX_SHEETS[category];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const header = (rows[0] ?? []).map(toCellString);
  const expected = XLSX_COLUMNS[category];
  if (header.length !== expected.length || expected.some((col, i) => header[i] !== col)) {
    throw new Error("Invalid column schema");
  }
  const dataRows = rows.slice(1);
  if (dataRows.length > EXCEL_MAX_ROWS) throw new Error(`Maximum ${EXCEL_MAX_ROWS} data rows allowed`);

  const knownSpotIds = new Set((await storage.listSpots(false)).map(s => s.id));
  const knownSchoolIds = new Set((await storage.listAllSchools({ page: 1, perPage: EXCEL_MAX_ROWS })).items.map(s => s.id));
  const knownStayIds = new Set((await storage.listAllStays({ page: 1, perPage: EXCEL_MAX_ROWS })).items.map(s => s.id));

  return dataRows.map((raw, i) => {
    const values = Object.fromEntries(expected.map((h, idx) => [h, toCellString((raw as unknown[])[idx])])) as Record<string, string>;
    const parsed = category === "spots"
      ? parseSpotsRow(values, knownSpotIds)
      : category === "schools"
        ? parseSchoolRow(values, knownSchoolIds, knownSpotIds)
        : parseStayRow(values, knownStayIds, knownSpotIds);
    return { ...parsed, rowNumber: i + 2 };
  });
}
function buildPreviewResponse(session: ExcelPreviewSession) {
  const category = session.category;
  const expected = XLSX_COLUMNS[category];
  const summary = {
    newCount: session.rows.filter(r => r.kind === "new").length,
    updateCount: session.rows.filter(r => r.kind === "update").length,
    errorIdNotFoundCount: session.rows.filter(r => r.kind === "error_id_not_found").length,
    errorInvalidDataCount: session.rows.filter(r => r.kind === "error_invalid_data").length,
  };
  const updatesXlsxBase64 = writeWorkbookBase64(
    XLSX_SHEETS[category],
    expected,
    session.rows.filter(r => r.kind === "new" || r.kind === "update").map(r => r.values),
  );
  const errorsXlsxBase64 = writeWorkbookBase64(
    XLSX_SHEETS[category],
    [...expected, "error"],
    session.rows.filter(r => r.kind.startsWith("error")).map(r => ({ ...r.values, error: r.error ?? "" })),
  );
  return {
    previewId: session.id,
    summary,
    rows: session.rows.map(r => ({ rowNumber: r.rowNumber, kind: r.kind, internalId: r.internalId, error: r.error })),
    files: { updatesFileName: "updates.xlsx", updatesFileBase64: updatesXlsxBase64, errorsFileName: "errors.xlsx", errorsFileBase64: errorsXlsxBase64 },
  };
}
const LEGAL_PAGE_META = {
  "privacy-policy": {
    title: "Privacy Policy",
    seoTitle: "Privacy Policy | Kite Compass",
    seoDescription: "Learn how Kite Compass handles data and protects your privacy.",
  },
  "legal-notice": {
    title: "Legal Notice",
    seoTitle: "Legal Notice | Kite Compass",
    seoDescription: "Legal information and contact details for Kite Compass.",
  },
} as const;
type LegalSlug = keyof typeof LEGAL_PAGE_META;

// Fields whose change makes weather data outdated (spec §20.2).
const WEATHER_COORD_FIELDS = new Set(["latitude", "longitude"]);

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function spotDataStatus(spot: { dataLastRefreshedAt?: string | null; updatedAt?: string | null }): DataStatus {
  if (!spot.dataLastRefreshedAt) return "missing";
  const refreshedAt = parseIsoMs(spot.dataLastRefreshedAt);
  const updatedAt = parseIsoMs(spot.updatedAt);
  if (refreshedAt == null) return "missing";
  if (updatedAt != null && updatedAt > refreshedAt) return "dirty";
  return "fresh";
}

function computeContentStatus(spot: { published?: boolean | null; hasDraft?: boolean | null }): ContentStatus {
  if (!spot.published) return "unpublished";
  if (spot.hasDraft) return "published-draft";
  return "published";
}

function computeWeatherStatus(spot: {
  dataLastRefreshedAt?: string | null;
  weatherLastError?: string | null;
  weatherCoordUpdatedAt?: string | null;
  weatherHasManualChanges?: boolean | null;
}): WeatherStatus {
  if (!spot.dataLastRefreshedAt) return "Missing";
  if (spot.weatherLastError) return "Update failed";
  const refreshedAt = parseIsoMs(spot.dataLastRefreshedAt);
  const coordUpdatedAt = parseIsoMs((spot as any).weatherCoordUpdatedAt);
  if (refreshedAt != null && coordUpdatedAt != null && coordUpdatedAt > refreshedAt) return "Outdated";
  if (spot.weatherHasManualChanges) return "Up to date · Manual changes";
  return "Up to date";
}

function monthlyScoreForSpot(row: any, rankingMode?: string | null): number | null {
  return resolveMonthlyScore(row, rankingMode);
}

function applyPublicSeasonLabels(monthly: any[], rankingMode: string | null | undefined, config: Pick<ScoringConfig, "seasonPeakThreshold" | "seasonSideThreshold">): any[] {
  const scores = monthly.map((row) => monthlyScoreForSpot(row, rankingMode));
  const bestScore = bestEvaluableScore(scores);
  return monthly.map((m, idx) => ({
    ...m,
    seasonLabel: deriveSeasonLabelFromScore(scores[idx], bestScore, config),
  }));
}

async function recalculateScoresForAllSpots(config: ScoringConfig, commitPublishedConfig: boolean): Promise<number> {
  if (scoringRecalcActive) throw new Error("score recalculation already running");
  scoringRecalcActive = true;
  try {
    const rows = await storage.listAllMonthly(false);
    const spotRows = await storage.listSpots(false);
    const rankingModeBySpotId = new Map(spotRows.map(spot => [spot.id, spot.rankingMode]));
    const rowsBySpot = new Map<number, typeof rows>();
    for (const row of rows) {
      const existing = rowsBySpot.get(row.spotId) ?? [];
      existing.push(row);
      rowsBySpot.set(row.spotId, existing);
    }



    await storage.setScoringStatus({
      status: "Recalculating scores",
      totalSpots: spotRows.length,
      completedSpots: 0,
      message: spotRows.length ? `0 / ${spotRows.length} spots recalculated` : "No spots to recalculate",
      dismissible: false,
      dismissed: false,
    });

    let updated = 0;
    let completed = 0;
    const batchSize = 10;
    for (let offset = 0; offset < spotRows.length; offset += batchSize) {
      const batch = spotRows.slice(offset, offset + batchSize);
      for (const spot of batch) {
        const rankingMode = rankingModeBySpotId.get(spot.id);
        const spotMonthly = rowsBySpot.get(spot.id) ?? [];
        const scores = spotMonthly.map((row) => rankingMode === "auto" ? calculateAutoMonthlyScore(row, config) : resolveMonthlyScore(row, rankingMode));
        const bestScore = bestEvaluableScore(scores);
        for (let i = 0; i < spotMonthly.length; i++) {
          const row = spotMonthly[i];
          const score = scores[i];
          const seasonLabel = deriveSeasonLabelFromScore(score, bestScore, config);
          await storage.updateMonthly(row.id, {
            ...(rankingMode === "auto" ? { automaticWindScore: score } : {}),
            seasonLabel,
          } as any);
          updated++;
        }
        completed++;
        await storage.setScoringStatus({
          status: "Recalculating scores",
          totalSpots: spotRows.length,
          completedSpots: completed,
          message: `${completed} / ${spotRows.length} spots recalculated`,
          dismissible: false,
          dismissed: false,
        });
      }
    }

    if (commitPublishedConfig) {
      await storage.commitScoringDraft();
    }
    await storage.setScoringStatus({
      status: "Scores published",
      totalSpots: spotRows.length,
      completedSpots: spotRows.length,
      message: "Scores published",
      dismissible: true,
      dismissed: false,
    });
    return updated;
  } catch (error) {
    await storage.setScoringStatus({
      status: "Failed",
      message: error instanceof Error ? error.message : "Score recalculation failed",
      dismissible: true,
      dismissed: false,
    });
    throw error;
  } finally {
    scoringRecalcActive = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type WeatherActionScope = "all" | "missing" | "filtered" | "selected";
type SpotPublishMode = "content" | "weather" | "content-weather";
function parseWeatherScope(raw: unknown): WeatherActionScope {
  if (raw === "all" || raw === "filtered" || raw === "selected" || raw === "missing") return raw;
  return "missing";
}
function parseSpotPublishMode(raw: unknown): SpotPublishMode {
  if (raw === "content" || raw === "weather" || raw === "content-weather") return raw;
  return "content";
}
function parseSpotIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(v => Number(v))
    .filter((v): v is number => Number.isFinite(v) && v > 0);
}
function isEligibleForWeatherRefresh(spot: Spot): boolean {
  return !!spot.latitude && !!spot.longitude;
}
function scopeMatchesSpot(scope: WeatherActionScope, scopedIds: Set<number>, spot: Spot): boolean {
  if (scope === "all") return true;
  if (scope === "missing") return !spot.dataLastRefreshedAt;
  return scopedIds.has(spot.id);
}

/* ───────── Auth helpers (no cookies/localStorage — Bearer token) ───────── */
const AUTH_SECRET = process.env.AUTH_SECRET || "kite-compass-dev-secret-change-me";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12h
const INACTIVITY_TIMEOUT_MS = 1000 * 60 * 60; // 60m
const TEMP_LOCK_MS = 1000 * 60 * 15; // 15m

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}
function isValidPassword(password: string): boolean {
  if (password.length < 12) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}
function makeToken(userId: number, lastActivityAt = Date.now()): string {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${userId}.${exp}.${lastActivityAt}`;
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}
function verifyToken(token: string): { userId: number; exp: number; lastActivityAt: number } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const [userId, exp, lastActivityAt, sig] = decoded.split(".");
    const payload = `${userId}.${exp}.${lastActivityAt}`;
    const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const parsedUserId = Number(userId);
    const expMs = Number(exp);
    const lastActivityMs = Number(lastActivityAt);
    if (!Number.isFinite(parsedUserId) || !Number.isFinite(expMs) || !Number.isFinite(lastActivityMs)) return null;
    if (Date.now() > expMs) return null;
    return { userId: parsedUserId, exp: expMs, lastActivityAt: lastActivityMs };
  } catch { return null; }
}
function getBearer(req: Request): string | null {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getBearer(req);
  const parsed = token ? verifyToken(token) : null;
  if (!parsed) return res.status(401).json({ error: "unauthorized" });
  if (Date.now() - parsed.lastActivityAt > INACTIVITY_TIMEOUT_MS) {
    return res.status(401).json({ error: "session expired" });
  }
  const user = await storage.getUser(parsed.userId);
  if (!user || !user.isActive) return res.status(401).json({ error: "unauthorized" });
  if (shouldBlockForExcel(req)) {
    return res.status(423).json({ error: "Excel import in progress. Admin write actions are temporarily blocked." });
  }
  (req as any).userId = user.id;
  (req as any).user = user;
  res.setHeader("x-auth-token", makeToken(user.id));
  next();
}
function requireMainAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== "main" || !user.isActive) return res.status(403).json({ error: "main admin required" });
  next();
}
function isAuthed(req: Request): boolean {
  const token = getBearer(req);
  if (!token) return false;
  const parsed = verifyToken(token);
  if (!parsed) return false;
  return Date.now() - parsed.lastActivityAt <= INACTIVITY_TIMEOUT_MS;
}

/* ───────── Serialization: parse JSON tag columns to arrays ───────── */
const parseArr = (v: any): string[] => {
  try { const a = JSON.parse(v ?? "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
};
const toArray = (v: any): string[] => Array.isArray(v) ? v : v != null ? [String(v)] : [];
// Draft/publish separation: when `preview` is false we serve the last PUBLISHED
// content (from publishedSnapshot), so unpublished draft edits never leak to the
// public site. In preview mode (admin) we serve the live row.
function publishedView<T extends { publishedSnapshot?: any; published?: any }>(row: T, preview: boolean): T {
  if (preview) return row;
  const snap = (row as any).publishedSnapshot;
  if (!snap) return row;
  try {
    const content = typeof snap === "string" ? JSON.parse(snap) : snap;
    // Overlay published content onto the row; keep status flags from the row.
    return { ...row, ...content } as T;
  } catch {
    return row;
  }
}
function serializeSpot(s: Spot, preview = true) {
  const v = publishedView(s, preview) as Spot;
  const publishedSlug = publishedSnapshotSlug(s) ?? s.slug;
  const dataStatus = spotDataStatus(v);
  return {
    ...v,
    spotTypes: parseArr(v.spotTypes),
    riderLevels: parseArr(v.riderLevels),
    vibeTags: parseArr(v.vibeTags),
    waterStates: parseArr((v as any).waterStates),
    beginnerFriendly: !!v.beginnerFriendly,
    publicId: v.publicId || "",
    dataStatus,
    dataNeedsRefresh: dataStatus !== "fresh",
    publishedSlug,
    contentStatus: computeContentStatus(s),
    weatherStatus: computeWeatherStatus(s as any),
    published: !!s.published,
    hasDraft: !!s.hasDraft,
    // never expose the raw snapshot blob to clients
    publishedSnapshot: undefined,
  };
}

function publishedSnapshotSlug(spot: { slug?: string | null; publishedSnapshot?: unknown }): string | null {
  const snapshot = spot.publishedSnapshot;
  if (!snapshot) return null;
  try {
    const parsed = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
    return parsed?.slug && typeof parsed.slug === "string" ? parsed.slug : null;
  } catch {
    return null;
  }
}

function seoDraftPayload(body: any): Pick<SeoContent, "homepageTitleDraft" | "homepageDescriptionDraft" | "exploreTitleDraft" | "exploreDescriptionDraft" | "methodologyTitleDraft" | "methodologyDescriptionDraft"> {
  return {
    homepageTitleDraft: String(body?.homepageTitleDraft ?? ""),
    homepageDescriptionDraft: String(body?.homepageDescriptionDraft ?? ""),
    exploreTitleDraft: String(body?.exploreTitleDraft ?? ""),
    exploreDescriptionDraft: String(body?.exploreDescriptionDraft ?? ""),
    methodologyTitleDraft: String(body?.methodologyTitleDraft ?? ""),
    methodologyDescriptionDraft: String(body?.methodologyDescriptionDraft ?? ""),
  };
}

function allSeoDraftFieldsFilled(next: Pick<SeoContent, "homepageTitleDraft" | "homepageDescriptionDraft" | "exploreTitleDraft" | "exploreDescriptionDraft" | "methodologyTitleDraft" | "methodologyDescriptionDraft">): boolean {
  return Object.values(next).every(value => value.trim().length > 0);
}
function serializeMonthly(m: MonthlyRecord, preview = true) {
  const v = publishedView(m, preview) as MonthlyRecord;
  return { ...v, published: !!m.published, hasDraft: !!m.hasDraft, publishedSnapshot: undefined };
}
function serializeLinked<T extends { publishedSnapshot?: any; published?: any; hasDraft?: any }>(row: T, preview = true): T {
  return publishedView(row, preview);
}
// stringify array fields before writing
function normalizeSpotInput(body: any) {
  const out = { ...body };
  for (const k of ["spotTypes", "riderLevels", "vibeTags", "waterStates"]) {
    if (Array.isArray(out[k])) out[k] = JSON.stringify(out[k]);
  }
  return out;
}

function asLegalSlug(slug: string): LegalSlug | null {
  if (slug === "privacy-policy" || slug === "legal-notice") return slug;
  if (slug === "impressum") return "legal-notice";
  return null;
}

function serializeAdminUser(u: any) {
  return {
    id: u.id,
    email: u.email,
    role: u.role === "main" ? "main" : "standard",
    isActive: !!u.isActive,
    mustChangePassword: !!u.mustChangePassword,
    failedLoginAttempts: u.failedLoginAttempts ?? 0,
    temporaryLockUntil: u.temporaryLockUntil ?? null,
    isFullyLocked: !!u.isFullyLocked,
    createdAt: u.createdAt ?? null,
    updatedAt: u.updatedAt ?? null,
  };
}

function parseInternalId(raw: string): number | null | "invalid" {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return "invalid";
  return n;
}

function parseSpotsRow(values: Record<string, string>, knownSpotIds: Set<number>): ParsedImportRow {
  const internal = parseInternalId(values.internal_id);
  if (internal === "invalid") return { rowNumber: 0, kind: "error_invalid_data", internalId: null, error: "Invalid internal_id", values, normalized: null };
  if (typeof internal === "number" && !knownSpotIds.has(internal)) return { rowNumber: 0, kind: "error_id_not_found", internalId: internal, error: "ID not found", values, normalized: null };
  if (!values.name.trim()) return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Name is required", values, normalized: null };

  const latitude = parseNullableNumber(values.latitude);
  const longitude = parseNullableNumber(values.longitude);
  const weatherLatitude = parseNullableNumber(values.weather_latitude);
  const weatherLongitude = parseNullableNumber(values.weather_longitude);
  const onshore = parseNullableNumber(values.onshore_direction_degrees);
  if (!latitude.ok || !longitude.ok || !weatherLatitude.ok || !weatherLongitude.ok || !onshore.ok) {
    return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Invalid number value", values, normalized: null };
  }
  const riderLevels = parseCsv(values.rider_levels).map(v => v.toLowerCase());
  if (riderLevels.some(v => !RIDER_LEVELS.has(v))) {
    return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Invalid rider level", values, normalized: null };
  }
  const waterStates = parseCsv(values.water_states).map(v => v[0]?.toUpperCase() + v.slice(1).toLowerCase());
  if (waterStates.some(v => !WATER_STATES.has(v))) {
    return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Invalid water state", values, normalized: null };
  }
  const destinationType = parseCsv(values.destination_type).map(v => slugifyName(v)).filter(Boolean);
  if (destinationType.some(v => !SPOT_TYPES.has(v))) {
    return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Invalid destination type", values, normalized: null };
  }
  const destinationVibes = parseCsv(values.destination_vibes).map(v => slugifyName(v)).filter(Boolean);
  if (destinationVibes.some(v => !VIBE_TAGS.has(v))) {
    return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Invalid destination vibe", values, normalized: null };
  }
  return {
    rowNumber: 0,
    kind: typeof internal === "number" ? "update" : "new",
    internalId: internal,
    error: null,
    values,
    normalized: {
      name: values.name.trim(),
      country: values.country_code.trim(),
      latitude: latitude.value ?? weatherLatitude.value,
      longitude: longitude.value ?? weatherLongitude.value,
      destinationDescription: values.spot_description,
      kiteContextDescription: values.kite_conditions_description,
      dataQualityNote: values.warning_text,
      riderLevels,
      waterStates,
      spotTypes: destinationType,
      vibeTags: destinationVibes,
    },
  };
}

function parseSchoolRow(values: Record<string, string>, knownSchoolIds: Set<number>, knownSpotIds: Set<number>): ParsedImportRow {
  const internal = parseInternalId(values.internal_id);
  if (internal === "invalid") return { rowNumber: 0, kind: "error_invalid_data", internalId: null, error: "Invalid internal_id", values, normalized: null };
  if (typeof internal === "number" && !knownSchoolIds.has(internal)) return { rowNumber: 0, kind: "error_id_not_found", internalId: internal, error: "ID not found", values, normalized: null };
  if (!values.name.trim()) return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Name is required", values, normalized: null };
  const lessons = parseBooleanCell(values.lessons);
  const rental = parseBooleanCell(values.rental);
  const published = parseBooleanCell(values.published);
  if (!lessons.ok || !rental.ok || !published.ok) return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Invalid boolean value", values, normalized: null };
  const sports = parseCsv(values.sports);
  if (sports.some(v => !SCHOOL_SPORTS.has(v))) return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Invalid sport value", values, normalized: null };
  const spotIds = parseCsv(values.spot_ids).map(v => Number(v));
  if (spotIds.some(v => !Number.isInteger(v) || v <= 0 || !knownSpotIds.has(v))) {
    return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Invalid spot_ids", values, normalized: null };
  }
  return {
    rowNumber: 0,
    kind: typeof internal === "number" ? "update" : "new",
    internalId: internal,
    error: null,
    values,
    normalized: {
      name: values.name.trim(),
      sports,
      offersLessons: lessons.value,
      offersRental: rental.value,
      websiteUrl: values.website_url,
      mapUrl: values.google_maps_url,
      shortDescription: values.short_description,
      published: published.value,
      spotIds: Array.from(new Set(spotIds)),
    },
  };
}

function parseStayRow(values: Record<string, string>, knownStayIds: Set<number>, knownSpotIds: Set<number>): ParsedImportRow {
  const internal = parseInternalId(values.internal_id);
  if (internal === "invalid") return { rowNumber: 0, kind: "error_invalid_data", internalId: null, error: "Invalid internal_id", values, normalized: null };
  if (typeof internal === "number" && !knownStayIds.has(internal)) return { rowNumber: 0, kind: "error_id_not_found", internalId: internal, error: "ID not found", values, normalized: null };
  if (!values.name.trim()) return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Name is required", values, normalized: null };
  const published = parseBooleanCell(values.published);
  if (!published.ok) return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Invalid boolean value", values, normalized: null };
  if (values.type && !STAY_TYPES.has(values.type)) return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Invalid stay type", values, normalized: null };
  const spotIds = parseCsv(values.spot_ids).map(v => Number(v));
  if (spotIds.some(v => !Number.isInteger(v) || v <= 0 || !knownSpotIds.has(v))) return { rowNumber: 0, kind: "error_invalid_data", internalId: internal, error: "Invalid spot_ids", values, normalized: null };
  return {
    rowNumber: 0,
    kind: typeof internal === "number" ? "update" : "new",
    internalId: internal,
    error: null,
    values,
    normalized: {
      name: values.name.trim(),
      type: values.type,
      websiteUrl: values.website_url,
      mapUrl: values.google_maps_url,
      shortDescription: values.short_description,
      published: published.value,
      spotIds: Array.from(new Set(spotIds)),
    },
  };
}

async function recalculateScoresForSpotIds(config: ScoringConfig, spotIds: number[], progressMessage = "spots recalculated"): Promise<number> {
  if (scoringRecalcActive) throw new Error("score recalculation already running");
  const targetIds = Array.from(new Set(spotIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (!targetIds.length) return 0;
  scoringRecalcActive = true;
  try {
    const rows = await storage.listAllMonthly(false);
    const spotRows = (await storage.listSpots(false)).filter((spot) => targetIds.includes(spot.id));
    const rankingModeBySpotId = new Map(spotRows.map((spot) => [spot.id, spot.rankingMode]));
    const rowsBySpot = new Map<number, typeof rows>();
    for (const row of rows) {
      if (!targetIds.includes(row.spotId)) continue;
      const existing = rowsBySpot.get(row.spotId) ?? [];
      existing.push(row);
      rowsBySpot.set(row.spotId, existing);
    }

    await storage.setScoringStatus({
      status: "Recalculating scores",
      totalSpots: spotRows.length,
      completedSpots: 0,
      message: spotRows.length ? `0 / ${spotRows.length} ${progressMessage}` : "No spots to recalculate",
      dismissible: false,
      dismissed: false,
    });

    let updated = 0;
    let completed = 0;
    for (const spot of spotRows) {
      const rankingMode = rankingModeBySpotId.get(spot.id);
      const spotMonthly = rowsBySpot.get(spot.id) ?? [];
      const scores = spotMonthly.map((row) => rankingMode === "auto" ? calculateAutoMonthlyScore(row, config) : resolveMonthlyScore(row, rankingMode));
      const bestScore = bestEvaluableScore(scores);
      for (let i = 0; i < spotMonthly.length; i++) {
        const row = spotMonthly[i];
        const score = scores[i];
        const seasonLabel = deriveSeasonLabelFromScore(score, bestScore, config);
        await storage.updateMonthly(row.id, {
          ...(rankingMode === "auto" ? { automaticWindScore: score } : {}),
          seasonLabel,
        } as any);
        updated++;
      }
      completed++;
      await storage.setScoringStatus({
        status: "Recalculating scores",
        totalSpots: spotRows.length,
        completedSpots: completed,
        message: `${completed} / ${spotRows.length} ${progressMessage}`,
        dismissible: false,
        dismissed: false,
      });
    }

    await storage.setScoringStatus({
      status: "Scores published",
      totalSpots: spotRows.length,
      completedSpots: spotRows.length,
      message: `Scores recalculated for ${spotRows.length} spots`,
      dismissible: true,
      dismissed: false,
    });
    return updated;
  } catch (error) {
    await storage.setScoringStatus({
      status: "Failed",
      message: error instanceof Error ? error.message : "Score recalculation failed",
      dismissible: true,
      dismissed: false,
    });
    throw error;
  } finally {
    scoringRecalcActive = false;
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ── Redirect middleware (spec §29): 301 for non-broken, non-API paths ──
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const match = sqlite.prepare(
      `SELECT to_url FROM redirects WHERE from_path = ? AND is_broken = 0`
    ).get(req.path) as { to_url: string } | undefined;
    if (match) return _res.redirect(301, match.to_url);
    next();
  });

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send([
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /admin/",
      "Disallow: /*preview=1",
      "Disallow: /api/",
    ].join("\n"));
  });

  /* ══════════════ AUTH ══════════════ */
  // Setup: create the first admin (only allowed when no users exist).
  app.post("/api/auth/setup", async (req, res) => {
    const count = await storage.countUsers();
    if (count > 0) return res.status(403).json({ error: "setup already complete" });
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email and password required" });
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: "password policy: min 12 + upper + lower + number + special" });
    }
    const user = await storage.createUser({
      email,
      passwordHash: hashPassword(password),
      role: "main",
      mustChangePassword: false,
    });
    return res.json({ token: makeToken(user.id), user: serializeAdminUser(user) });
  });

  app.get("/api/auth/status", async (_req, res) => {
    res.json({ needsSetup: (await storage.countUsers()) === 0 });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    const user = email ? await storage.getUserByEmail(String(email).toLowerCase()) : undefined;
    if (!user || !user.isActive) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    if (user.isFullyLocked) return res.status(423).json({ error: "account fully locked" });
    if (user.temporaryLockUntil && new Date(user.temporaryLockUntil).getTime() > Date.now()) {
      return res.status(423).json({ error: "account temporarily locked", temporaryLockUntil: user.temporaryLockUntil });
    }
    if (!verifyPassword(password || "", user.passwordHash)) {
      const prev = user.failedLoginAttempts ?? 0;
      const next = Math.min(prev + 1, 10);
      const patch: any = { failedLoginAttempts: next };
      if (next >= 10) {
        patch.isFullyLocked = true;
        patch.temporaryLockUntil = null;
      } else if (next >= 5) {
        patch.temporaryLockUntil = new Date(Date.now() + TEMP_LOCK_MS).toISOString();
      }
      await storage.updateUser(user.id, patch);
      return res.status(401).json({ error: "invalid credentials" });
    }
    await storage.updateUser(user.id, {
      failedLoginAttempts: 0,
      temporaryLockUntil: null,
      isFullyLocked: false,
    });
    const refreshed = await storage.getUser(user.id);
    if (!refreshed) return res.status(500).json({ error: "user unavailable" });
    res.json({ token: makeToken(user.id), user: serializeAdminUser(refreshed) });
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const u = await storage.getUser((req as any).userId);
    if (!u) return res.status(404).json({ error: "not found" });
    res.json({ user: serializeAdminUser(u) });
  });

  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    const actor = (req as any).user;
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "currentPassword and newPassword required" });
    if (!verifyPassword(currentPassword, actor.passwordHash)) return res.status(400).json({ error: "current password is incorrect" });
    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ error: "password policy: min 12 + upper + lower + number + special" });
    }
    await storage.updateUser(actor.id, {
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      temporaryLockUntil: null,
      isFullyLocked: false,
    });
    const updated = await storage.getUser(actor.id);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.setHeader("x-auth-token", makeToken(updated.id));
    res.json({ user: serializeAdminUser(updated) });
  });

  app.post("/api/auth/refresh", requireAuth, async (req, res) => {
    const user = await storage.getUser((req as any).userId);
    if (!user) return res.status(404).json({ error: "not found" });
    const nextToken = makeToken(user.id);
    res.setHeader("x-auth-token", nextToken);
    res.json({ token: nextToken, user: serializeAdminUser(user) });
  });

  app.get("/api/admin/excel/status", requireAuth, async (_req, res) => {
    setNoStore(res);
    pruneImportFileRetention();
    const row = getExcelState();
    res.json({
      status: row.status,
      category: row.category,
      runId: row.run_id,
      message: row.message || "",
      active: EXCEL_ACTIVE_STATUSES.has(row.status),
      dismissible: !!row.dismissible,
      dismissed: !!row.dismissed,
      visible: row.status !== "Idle" && (!row.dismissed || EXCEL_ACTIVE_STATUSES.has(row.status)),
      updatedAt: row.updated_at,
    });
  });

  app.post("/api/admin/excel/dismiss", requireAuth, async (_req, res) => {
    const row = getExcelState();
    if (EXCEL_TERMINAL_STATUSES.has(row.status)) {
      setExcelState(row.status, { category: row.category, run_id: row.run_id, message: row.message ?? "", dismissible: true, dismissed: true });
    }
    res.json({ ok: true });
  });

  app.get("/api/admin/excel/import/:category/history", requireAuth, async (req, res) => {
    setNoStore(res);
    const category = String(req.params.category);
    if (!isExcelCategory(category)) return res.status(400).json({ error: "invalid category" });
    pruneImportFileRetention();
    const rows = sqlite.prepare(`
      SELECT id, category, file_name, status, created_count, updated_count, skipped_count, error_count,
             new_count, update_count, error_id_not_found_count, error_invalid_data_count, start_at, end_at, duration_ms,
             technical_error, rollback_notice, created_at, updated_at
      FROM excel_import_history
      WHERE category = ?
      ORDER BY id DESC
      LIMIT 50
    `).all(category);
    res.json(rows);
  });

  app.post("/api/admin/excel/export/:category", requireAuth, async (req, res) => {
    const category = String(req.params.category);
    if (!isExcelCategory(category)) return res.status(400).json({ error: "invalid category" });
    const scope = String(req.body?.scope ?? "all");
    const selectedIds = Array.isArray(req.body?.selectedIds) ? req.body.selectedIds.map((v: unknown) => Number(v)).filter((v: number) => Number.isInteger(v) && v > 0) : [];
    const filters = (req.body?.filters ?? {}) as ListingsFilter & { q?: string };
    const date = todayIsoDate();
    const headers = XLSX_COLUMNS[category];

    let rows: Record<string, unknown>[] = [];
    if (category === "spots") {
      let list = (await storage.listSpots(false)).map(s => serializeSpot(s, true));
      if (filters.q) {
        const q = filters.q.toLowerCase();
        list = list.filter(s => s.name.toLowerCase().includes(q) || (s.country || "").toLowerCase().includes(q));
      }
      if (scope === "selected") list = list.filter(s => selectedIds.includes(s.id));
      rows = list.map(s => ({
        internal_id: s.id,
        name: s.name ?? "",
        country_code: s.country ?? "",
        latitude: s.latitude ?? "",
        longitude: s.longitude ?? "",
        weather_latitude: s.latitude ?? "",
        weather_longitude: s.longitude ?? "",
        onshore_direction_degrees: "",
        spot_description: s.destinationDescription ?? "",
        kite_conditions_description: s.kiteContextDescription ?? "",
        warning_text: s.dataQualityNote ?? "",
        rider_levels: (s.riderLevels ?? []).join(", "),
        water_states: (s.waterStates ?? []).join(", "),
        destination_type: (s.spotTypes ?? []).join(", "),
        destination_vibes: (s.vibeTags ?? []).join(", "),
      }));
    } else if (category === "schools") {
      let list = (await storage.listAllSchools({ ...filters, page: 1, perPage: EXCEL_MAX_ROWS })).items;
      if (scope === "selected") list = list.filter(s => selectedIds.includes(s.id));
      const assignments = db.select().from(spotSchools).all();
      const spotIdsBySchool = new Map<number, number[]>();
      for (const row of assignments) {
        const cur = spotIdsBySchool.get(row.schoolId) ?? [];
        cur.push(row.spotId);
        spotIdsBySchool.set(row.schoolId, cur);
      }
      rows = list.map(s => ({
        internal_id: s.id,
        name: s.name ?? "",
        sports: parseArr(s.sports).join(", "),
        lessons: !!s.offersLessons,
        rental: !!s.offersRental,
        website_url: s.websiteUrl ?? "",
        google_maps_url: s.mapUrl ?? "",
        short_description: s.shortDescription ?? "",
        published: !!s.published,
        spot_ids: (spotIdsBySchool.get(s.id) ?? []).join(", "),
      }));
    } else {
      let list = (await storage.listAllStays({ ...filters, page: 1, perPage: EXCEL_MAX_ROWS })).items;
      if (scope === "selected") list = list.filter(s => selectedIds.includes(s.id));
      const assignments = db.select().from(spotStays).all();
      const spotIdsByStay = new Map<number, number[]>();
      for (const row of assignments) {
        const cur = spotIdsByStay.get(row.stayId) ?? [];
        cur.push(row.spotId);
        spotIdsByStay.set(row.stayId, cur);
      }
      rows = list.map(s => ({
        internal_id: s.id,
        name: s.name ?? "",
        type: s.type ?? "",
        website_url: s.websiteUrl ?? "",
        google_maps_url: s.mapUrl ?? "",
        short_description: s.shortDescription ?? "",
        published: !!s.published,
        spot_ids: (spotIdsByStay.get(s.id) ?? []).join(", "),
      }));
    }
    if (scope === "template") rows = [];
    const fileBase64 = writeWorkbookBase64(XLSX_SHEETS[category], headers, rows);
    const fileName = scope === "template" ? `${category}-template-${date}.xlsx` : `${category}-export-${date}.xlsx`;
    res.json({ fileName, fileBase64 });
  });

  app.post("/api/admin/excel/import/:category/preview", requireAuth, async (req, res) => {
    const category = String(req.params.category);
    if (!isExcelCategory(category)) return res.status(400).json({ error: "invalid category" });
    if (weatherImportActive) return res.status(409).json({ error: "Weather import is active" });
    if (isExcelImportActive()) return res.status(409).json({ error: "Another Excel import is active" });

    const fileName = sanitizeFileName(String(req.body?.fileName ?? "import.xlsx"));
    if (!fileName.toLowerCase().endsWith(".xlsx")) return res.status(400).json({ error: "Only .xlsx files are supported" });
    const fileBase64 = String(req.body?.fileBase64 ?? "");
    if (!fileBase64) return res.status(400).json({ error: "fileBase64 required" });
    setExcelState("Uploading", { category, message: `Uploading ${fileName}` });
    try {
      setExcelState("Validating", { category, message: `Validating ${fileName}` });
      const parsedRows = await parseImportRowsFromWorkbookBase64(category, fileBase64);
      const nowIso = new Date().toISOString();
      const summary = {
        newCount: parsedRows.filter(r => r.kind === "new").length,
        updateCount: parsedRows.filter(r => r.kind === "update").length,
        errorIdNotFoundCount: parsedRows.filter(r => r.kind === "error_id_not_found").length,
        errorInvalidDataCount: parsedRows.filter(r => r.kind === "error_invalid_data").length,
      };
      const previewId = crypto.randomUUID();
      const session: ExcelPreviewSession = { id: previewId, category, fileName, rows: parsedRows, createdAtIso: nowIso, runId: -1 };
      const previewPayload = buildPreviewResponse(session);
      const run = sqlite.prepare(`
        INSERT INTO excel_import_history
          (category, file_name, status, created_count, updated_count, skipped_count, error_count, new_count, update_count,
           error_id_not_found_count, error_invalid_data_count, start_at, created_at, updated_at, source_file_base64, updates_file_base64, errors_file_base64)
        VALUES (?, ?, 'Ready for confirmation', 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        category, fileName,
        summary.errorIdNotFoundCount + summary.errorInvalidDataCount,
        summary.newCount, summary.updateCount, summary.errorIdNotFoundCount, summary.errorInvalidDataCount,
        nowIso, nowIso, nowIso, fileBase64, previewPayload.files.updatesFileBase64, previewPayload.files.errorsFileBase64,
      );

      session.runId = Number(run.lastInsertRowid);
      excelPreviewSessions.set(previewId, session);
      setExcelState("Ready for confirmation", { category, run_id: Number(run.lastInsertRowid), message: fileName });
      return res.json(previewPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Excel import validation failed";
      setExcelState("Failed", { category, message, dismissible: true, dismissed: false });
      return res.status(400).json({ error: message });
    }
  });

  app.get("/api/admin/excel/import/:category/preview-current", requireAuth, async (req, res) => {
    setNoStore(res);
    const category = String(req.params.category);
    if (!isExcelCategory(category)) return res.status(400).json({ error: "invalid category" });
    const state = getExcelState();
    if (state.status !== "Ready for confirmation" || state.category !== category || !state.run_id) {
      return res.status(404).json({ error: "no preview ready for confirmation" });
    }
    const session = Array.from(excelPreviewSessions.values()).find(s => s.category === category && s.runId === state.run_id);
    if (!session) {
      const fallbackRow = sqlite.prepare(`
        SELECT id, file_name, source_file_base64
        FROM excel_import_history
        WHERE id = ? AND category = ? AND status = 'Ready for confirmation'
      `).get(state.run_id, category) as { id: number; file_name: string; source_file_base64: string | null } | undefined;
      if (fallbackRow?.source_file_base64) {
        try {
          const parsedRows = await parseImportRowsFromWorkbookBase64(category, fallbackRow.source_file_base64);
          const restoredSession: ExcelPreviewSession = {
            id: crypto.randomUUID(),
            category,
            fileName: fallbackRow.file_name,
            rows: parsedRows,
            createdAtIso: new Date().toISOString(),
            runId: fallbackRow.id,
          };
          excelPreviewSessions.set(restoredSession.id, restoredSession);
          return res.json(buildPreviewResponse(restoredSession));
        } catch {
          // fall through to expiration handling below
        }
      }
      const nowIso = new Date().toISOString();
      sqlite.prepare(`
        UPDATE excel_import_history
        SET status = 'Failed', updated_at = ?, end_at = ?, technical_error = ?, rollback_notice = ?
        WHERE id = ?
      `).run(nowIso, nowIso, "Preview session expired before confirmation", "No changes were applied.", state.run_id);
      setExcelState("Failed", { category, run_id: state.run_id, message: "Preview session expired. Please re-upload the file.", dismissible: true, dismissed: false });
      return res.status(410).json({ error: "preview session expired. Please upload the file again." });
    }
    return res.json(buildPreviewResponse(session));
  });

  app.post("/api/admin/excel/import/:category/cancel", requireAuth, async (req, res) => {
    const category = String(req.params.category);
    if (!isExcelCategory(category)) return res.status(400).json({ error: "invalid category" });
    const previewId = String(req.body?.previewId ?? "");
    const session = excelPreviewSessions.get(previewId);
    if (!session || session.category !== category) return res.status(404).json({ error: "preview session not found" });
    excelPreviewSessions.delete(previewId);
    sqlite.prepare(`UPDATE excel_import_history SET status = 'Cancelled', updated_at = ?, end_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), new Date().toISOString(), session.runId);
    setExcelState("Cancelled", { category, run_id: session.runId, message: "Cancelled by admin", dismissible: true, dismissed: false });
    res.json({ ok: true });
  });

  app.post("/api/admin/excel/import/:category/commit", requireAuth, async (req, res) => {
    const category = String(req.params.category);
    if (!isExcelCategory(category)) return res.status(400).json({ error: "invalid category" });
    const previewId = String(req.body?.previewId ?? "");
    const action = String(req.body?.action ?? "") as ExcelImportAction;
    if (action !== "create_only" && action !== "create_update") return res.status(400).json({ error: "invalid action" });
    const session = excelPreviewSessions.get(previewId);
    if (!session || session.category !== category) return res.status(404).json({ error: "preview session not found" });

    const validRows = session.rows.filter(r => r.kind === "new" || (r.kind === "update" && action === "create_update"));
    const skippedCount = session.rows.length - validRows.length;
    const startIso = new Date().toISOString();
    setExcelState("Importing", { category, run_id: session.runId, message: `Importing ${validRows.length} rows` });
    let createdCount = 0;
    let updatedCount = 0;
    try {
      const tx = sqlite.transaction(() => {
        for (const row of validRows) {
          if (!row.normalized) continue;
          if (category === "spots") {
            const payload = normalizeSpotInput(row.normalized);
            if (row.kind === "new") {
              const base = slugifyName(String(payload.name || "spot")) || "spot";
              let slug = base;
              let idx = 1;
              while (db.select().from(spots).where(eq(spots.slug, slug)).get()) slug = `${base}-${idx++}`;
              db.insert(spots).values({
                ...payload,
                slug,
                publicId: crypto.randomUUID(),
                published: false,
                hasDraft: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              } as any).run();
              createdCount++;
            } else if (row.internalId) {
              db.update(spots).set({ ...payload, hasDraft: true, updatedAt: new Date().toISOString() } as any).where(eq(spots.id, row.internalId)).run();
              updatedCount++;
            }
          } else if (category === "schools") {
            const payload = row.normalized as { spotIds: number[]; [key: string]: unknown };
            const { spotIds, ...rest } = payload;
            let schoolId = row.internalId;
            if (row.kind === "new") {
              const created = db.insert(schools).values({
                ...rest,
                sports: JSON.stringify((rest.sports as string[]) ?? []),
                published: false,
                hasDraft: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              } as any).returning().get();
              schoolId = created.id;
              createdCount++;
            } else if (schoolId) {
              db.update(schools).set({
                ...rest,
                sports: JSON.stringify((rest.sports as string[]) ?? []),
                hasDraft: true,
                updatedAt: new Date().toISOString(),
              } as any).where(eq(schools.id, schoolId)).run();
              updatedCount++;
            }
            if (schoolId) {
              db.delete(spotSchools).where(eq(spotSchools.schoolId, schoolId)).run();
              spotIds.forEach((spotId, idx) => {
                db.insert(spotSchools).values({ spotId, schoolId, sortOrder: idx }).run();
              });
            }
          } else {
            const payload = row.normalized as { spotIds: number[]; [key: string]: unknown };
            const { spotIds, ...rest } = payload;
            let stayId = row.internalId;
            if (row.kind === "new") {
              const created = db.insert(stays).values({
                ...rest,
                published: false,
                hasDraft: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              } as any).returning().get();
              stayId = created.id;
              createdCount++;
            } else if (stayId) {
              db.update(stays).set({
                ...rest,
                hasDraft: true,
                updatedAt: new Date().toISOString(),
              } as any).where(eq(stays.id, stayId)).run();
              updatedCount++;
            }
            if (stayId) {
              db.delete(spotStays).where(eq(spotStays.stayId, stayId)).run();
              spotIds.forEach((spotId, idx) => {
                db.insert(spotStays).values({ spotId, stayId, sortOrder: idx }).run();
              });
            }
          }
        }
      });
      tx();
      const endIso = new Date().toISOString();
      const durationMs = new Date(endIso).getTime() - new Date(startIso).getTime();
      sqlite.prepare(`
        UPDATE excel_import_history
        SET status = 'Completed', created_count = ?, updated_count = ?, skipped_count = ?, error_count = ?,
            start_at = COALESCE(start_at, ?), end_at = ?, duration_ms = ?, updated_at = ?, technical_error = NULL, rollback_notice = NULL
        WHERE id = ?
      `).run(
        createdCount, updatedCount, skippedCount, session.rows.filter(r => r.kind.startsWith("error")).length,
        startIso, endIso, durationMs, endIso, session.runId,
      );
      excelPreviewSessions.delete(previewId);
      setExcelState("Completed", { category, run_id: session.runId, message: `Created ${createdCount}, updated ${updatedCount}`, dismissible: true, dismissed: false });
      res.json({ createdCount, updatedCount, skippedCount });
    } catch (error) {
      const endIso = new Date().toISOString();
      const message = error instanceof Error ? error.message : "Technical import failure";
      setExcelState("Rolling back", { category, run_id: session.runId, message: "Rolling back changes…" });
      sqlite.prepare(`
        UPDATE excel_import_history
        SET status = 'Failed', start_at = COALESCE(start_at, ?), end_at = ?, duration_ms = ?, updated_at = ?,
            technical_error = ?, rollback_notice = 'All selected rows were rolled back.'
        WHERE id = ?
      `).run(startIso, endIso, new Date(endIso).getTime() - new Date(startIso).getTime(), endIso, message, session.runId);
      setExcelState("Failed", { category, run_id: session.runId, message, dismissible: true, dismissed: false });
      void logError("Excel Import", `${category} import failed: ${message}`, `run:${session.runId}`);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/admin/users", requireAuth, requireMainAdmin, async (_req, res) => {
    const users = await storage.listAdminUsers();
    res.json(users);
  });

  app.post("/api/admin/users", requireAuth, requireMainAdmin, async (req, res) => {
    const { email, temporaryPassword } = req.body || {};
    if (!email || !temporaryPassword) return res.status(400).json({ error: "email and temporaryPassword required" });
    if (!isValidPassword(temporaryPassword)) {
      return res.status(400).json({ error: "password policy: min 12 + upper + lower + number + special" });
    }
    if (await storage.getUserByEmail(String(email).toLowerCase())) return res.status(409).json({ error: "email exists" });
    const user = await storage.createUser({
      email,
      passwordHash: hashPassword(temporaryPassword),
      role: "standard",
      mustChangePassword: true,
    });
    res.json({ user: serializeAdminUser(user) });
  });

  app.post("/api/admin/users/:id/reset-password", requireAuth, requireMainAdmin, async (req, res) => {
    const targetUserId = Number(req.params.id);
    const { temporaryPassword } = req.body || {};
    if (!temporaryPassword) return res.status(400).json({ error: "temporaryPassword required" });
    if (!isValidPassword(temporaryPassword)) {
      return res.status(400).json({ error: "password policy: min 12 + upper + lower + number + special" });
    }
    const target = await storage.getUser(targetUserId);
    if (!target) return res.status(404).json({ error: "not found" });
    if (target.role === "main") return res.status(403).json({ error: "main admin reset requires server-side recovery" });
    const updated = await storage.updateUser(target.id, {
      passwordHash: hashPassword(temporaryPassword),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      temporaryLockUntil: null,
      isFullyLocked: false,
      isActive: true,
    });
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json({ user: serializeAdminUser(updated) });
  });

  app.post("/api/admin/users/:id/unlock", requireAuth, requireMainAdmin, async (req, res) => {
    const targetUserId = Number(req.params.id);
    const target = await storage.getUser(targetUserId);
    if (!target) return res.status(404).json({ error: "not found" });
    if (target.role === "main") return res.status(403).json({ error: "main admin unlock requires server-side recovery" });
    const updated = await storage.updateUser(target.id, {
      failedLoginAttempts: 0,
      temporaryLockUntil: null,
      isFullyLocked: false,
      isActive: true,
    });
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json({ user: serializeAdminUser(updated) });
  });

  app.post("/api/admin/users/:id/deactivate", requireAuth, requireMainAdmin, async (req, res) => {
    const targetUserId = Number(req.params.id);
    const target = await storage.getUser(targetUserId);
    if (!target) return res.status(404).json({ error: "not found" });
    if (target.role === "main") return res.status(403).json({ error: "transfer main admin ownership first" });
    const updated = await storage.updateUser(target.id, { isActive: false });
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json({ user: serializeAdminUser(updated) });
  });

  app.post("/api/admin/users/:id/activate", requireAuth, requireMainAdmin, async (req, res) => {
    const targetUserId = Number(req.params.id);
    const target = await storage.getUser(targetUserId);
    if (!target) return res.status(404).json({ error: "not found" });
    const updated = await storage.updateUser(target.id, { isActive: true });
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json({ user: serializeAdminUser(updated) });
  });

  app.delete("/api/admin/users/:id", requireAuth, requireMainAdmin, async (req, res) => {
    const targetUserId = Number(req.params.id);
    const actorUserId = (req as any).userId;
    if (targetUserId === actorUserId) return res.status(400).json({ error: "cannot delete own account" });
    const target = await storage.getUser(targetUserId);
    if (!target) return res.status(404).json({ error: "not found" });
    if (target.role === "main") return res.status(403).json({ error: "transfer main admin ownership first" });
    await storage.deleteUser(target.id);
    res.json({ ok: true });
  });

  app.post("/api/admin/users/transfer-main", requireAuth, requireMainAdmin, async (req, res) => {
    const actorUserId = (req as any).userId;
    const { userId } = req.body || {};
    const nextMainUserId = Number(userId);
    if (!Number.isFinite(nextMainUserId)) return res.status(400).json({ error: "userId required" });
    if (nextMainUserId === actorUserId) return res.status(400).json({ error: "target must be a different user" });
    const nextUser = await storage.getUser(nextMainUserId);
    if (!nextUser) return res.status(404).json({ error: "target user not found" });
    if (!nextUser.isActive) return res.status(400).json({ error: "target user must be active" });
    await storage.transferMainOwnership(actorUserId, nextMainUserId);
    const users = await storage.listAdminUsers();
    res.json({ users });
  });

  /* ══════════════ PUBLIC ══════════════ */
  // Filter definitions (public subset) — drives dynamic frontend filters.
  app.get("/api/filters", async (_req, res) => {
    const defs = await storage.listFilterDefs(true);
    res.json(defs.map(d => ({ ...d, options: parseArr(d.options) })));
  });

  // Public spot list (published only). Supports month + tag filtering + sort by score.
  app.get("/api/spots", async (req, res) => {
    const admin = isAuthed(req) && req.query.preview === "1";
    const scoring = await storage.getScoringContent();
    const seasonConfig = scoring.published;
    const spots = (await storage.listSpots(!admin)).map(s => serializeSpot(s, admin));
    const monthly = (await storage.listAllMonthly(!admin)).map(m => serializeMonthly(m, admin));
    const query = ((req.query.q as string) || "").trim().toLowerCase();

    const months = toArray(req.query.month);
    const monthSet = new Set(months);
    const continents = toArray(req.query.continent);
    const continentSet = new Set(continents);
    const spotTypes = ([] as string[]).concat(req.query.spotType as any || []);
    const riderLevels = ([] as string[]).concat(req.query.riderLevel as any || []);
    const vibes = ([] as string[]).concat(req.query.vibe as any || []);
    const countries = toArray(req.query.country);
    const countrySet = new Set(countries);
    const windTypes = ([] as string[]).concat(req.query.windType as any || []);
    const waterStates = ([] as string[]).concat(req.query.waterState as any || []);
    const windMinRaw = req.query.windMin != null ? Number(req.query.windMin) : null;
    const windMaxRaw = req.query.windMax != null ? Number(req.query.windMax) : null;
    const windMin = windMinRaw != null && Number.isFinite(windMinRaw) ? windMinRaw : null;
    const windMax = windMaxRaw != null && Number.isFinite(windMaxRaw) ? windMaxRaw : null;
    const windRangeActive = windMin != null || windMax != null;

    let rows: any[] = spots.map(s => {
      const rankingMode = s.rankingMode;
      const spotMonthly = monthly.filter(m => m.spotId === s.id);
      const publicMonthly = admin ? spotMonthly : applyPublicSeasonLabels(spotMonthly, rankingMode, seasonConfig);
      const selectedMonthly = months.length ? spotMonthly.filter(m => monthSet.has(m.month)) : [];
      const monthsAvail = spotMonthly.map(m => m.month);
      const scoreSource = months.length ? selectedMonthly : spotMonthly;
      const scores = scoreSource
        .map(record => monthlyScoreForSpot(record, rankingMode))
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const bestScore = bestEvaluableScore(scores);
      const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      const rec = (months.length ? selectedMonthly : spotMonthly)
        .slice()
        .sort((a, b) => (monthlyScoreForSpot(b, rankingMode) ?? -1) - (monthlyScoreForSpot(a, rankingMode) ?? -1))[0] || null;
      // Compact season strip: 12 entries in fixed Jan→Dec order, each the season
      // label for that month or null when no published record exists. Lets result
      // cards render a season strip without a second request.
      const bySeason = new Map(publicMonthly.map(m => [m.month, m.seasonLabel]));
      const seasonByMonth = MONTH_ORDER.map(mn => bySeason.get(mn) ?? null);
      const publicRec = rec ? publicMonthly.find(m => m.month === rec.month) : null;
      const monthRecord = rec ? { ...rec, seasonLabel: publicRec?.seasonLabel ?? deriveSeasonLabelFromScore(monthlyScoreForSpot(rec, rankingMode), bestScore, seasonConfig) } : null;
      const searchHaystack = [s.name, s.country, s.region, s.slug, s.destinationSummary, s.teaserText]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (query && !searchHaystack.includes(query)) return null;
      // Compute per-spot average wind across the relevant month window (for wind-range filter).
      const windWindow = months.length ? selectedMonthly : spotMonthly;
      const windValues = windWindow
        .map(m => (m as any).avgKiteableWind10mKnots ?? (m as any).averageBaseWind)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      const avgWind = windValues.length ? windValues.reduce((a, b) => a + b, 0) / windValues.length : null;
      return { ...s, monthRecord, score, monthsAvailable: monthsAvail, seasonByMonth, _avgWind: avgWind, _spotMonthly: spotMonthly };
    });

    rows = rows.filter(Boolean);
    if (months.length) rows = rows.filter(r => months.some(m => r.monthsAvailable.includes(m)));
    if (spotTypes.length) rows = rows.filter(r => spotTypes.some(t => r.spotTypes.includes(t)));
    if (riderLevels.length) rows = rows.filter(r => riderLevels.some(t => r.riderLevels.includes(t)));
    if (vibes.length) rows = rows.filter(r => vibes.some(t => r.vibeTags.includes(t)));
    if (continents.length || countries.length) {
      rows = rows.filter(r => {
        if (countrySet.has(r.country)) return true;
        const continent = getContinentForCountry(r.country);
        return continent != null && continentSet.has(continent);
      });
    }

    if (windTypes.length) {
      rows = rows.filter(r => {
        const window: any[] = months.length
          ? r._spotMonthly.filter((m: any) => monthSet.has(m.month))
          : r._spotMonthly;
        return windTypes.some(wt =>
          window.some((m: any) => m.primaryWindType === wt || m.secondaryWindType === wt),
        );
      });
    }
    if (waterStates.length) {
      rows = rows.filter(r => waterStates.some(ws => (r.waterStates ?? []).includes(ws)));
    }
    if (windRangeActive) {
      rows = rows.filter(r => {
        const avg = r._avgWind;
        if (avg == null) return false; // no evaluable wind → fails active range filter
        if (windMin != null && avg < windMin) return false;
        if (windMax != null && avg > windMax) return false;
        return true;
      });
    }

    // Strip internal-only fields before sending response.
    rows = rows.map(({ _avgWind: _, _spotMonthly: __, ...rest }) => rest);

    rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    res.json(rows);
  });

  // Public single spot by slug with its monthly records.
  app.get("/api/spots/slug/:slug", async (req, res) => {
    const admin = isAuthed(req) && req.query.preview === "1";
    const scoring = await storage.getScoringContent();
    const seasonConfig = scoring.published;
    const requestedSlug = String(req.params.slug);
    let spot = await storage.getSpotBySlug(requestedSlug);
    if (!admin) {
      if (!spot || !spot.published) {
        const publishedSpots = await storage.listSpots(true);
        spot = publishedSpots.find(s => {
          if (s.slug === requestedSlug) return true;
          return publishedSnapshotSlug(s) === requestedSlug;
        });
      }
    }
    if (!spot || (!spot.published && !admin)) return res.status(404).json({ error: "not found" });
    const serializedSpot = serializeSpot(spot, admin);
    const monthly = (await storage.listMonthly(spot.id, !admin)).map(m => serializeMonthly(m, admin));
    const publicMonthly = admin ? monthly : applyPublicSeasonLabels(monthly, serializedSpot.rankingMode, seasonConfig);
    const schools = (await storage.listSchoolsForSpot(spot.id, !admin)).map(s => serializeLinked(s, admin));
    const stays = (await storage.listStaysForSpot(spot.id, !admin)).map(s => serializeLinked(s, admin));
    res.json({ ...serializedSpot, monthly: publicMonthly, schools, stays });
  });

  // list of distinct countries (for filter)
  app.get("/api/countries", async (_req, res) => {
    const spots = await storage.listSpots(true);
    const set = Array.from(new Set(spots.map(s => s.country).filter(Boolean))).sort();
    res.json(set);
  });

  app.get("/api/pages/:slug", async (req, res) => {
    const slug = String(req.params.slug);
    const legalSlug = asLegalSlug(slug);
    if (legalSlug) {
      const preview = isAuthed(req) && req.query.preview === "1";
      const legal = await storage.getLegalContent();
      const body = legalSlug === "privacy-policy"
        ? (preview ? legal.privacyPolicyDraft : legal.privacyPolicyPublished)
        : (preview ? legal.legalNoticeDraft : legal.legalNoticePublished);
      return res.json({ slug: legalSlug, title: LEGAL_PAGE_META[legalSlug].title, body });
    }

    const page = await storage.getSitePageBySlug(slug);
    if (!page) return res.status(404).json({ error: "not found" });
    res.json(page);
  });

  app.get("/api/seo", async (_req, res) => {
    const seo = await storage.getSeoContent();
    res.json({
      homepageTitle: seo.homepageTitlePublished,
      homepageDescription: seo.homepageDescriptionPublished,
      exploreTitle: seo.exploreTitlePublished,
      exploreDescription: seo.exploreDescriptionPublished,
      methodologyTitle: seo.methodologyTitlePublished,
      methodologyDescription: seo.methodologyDescriptionPublished,
      updatedAt: seo.updatedAt,
    });
  });

  app.get("/api/scoring", async (_req, res) => {
    const scoring = await storage.getScoringContent();
    res.json(scoring.published);
  });

  /* ══════════════ ADMIN (auth required) ══════════════ */
  app.get("/api/admin/spots", requireAuth, async (_req, res) => {
    const spots = (await storage.listSpots(false)).map(s => serializeSpot(s, true));
    const monthly = (await storage.listAllMonthly(false));
    const byId: Record<number, number> = {};
    monthly.forEach(m => { byId[m.spotId] = (byId[m.spotId] || 0) + 1; });
    res.json(spots.map(s => ({ ...s, monthlyCount: byId[s.id] || 0 })));
  });

  app.get("/api/admin/spots/:id", requireAuth, async (req, res) => {
    const spot = await storage.getSpot(Number(req.params.id));
    if (!spot) return res.status(404).json({ error: "not found" });
    const monthly = (await storage.listMonthly(spot.id, false)).map(m => serializeMonthly(m, true));
    const schools = (await storage.listSchoolsForSpot(spot.id, false)).map(s => serializeLinked(s, true));
    const stays = (await storage.listStaysForSpot(spot.id, false)).map(s => serializeLinked(s, true));
    res.json({ ...serializeSpot(spot, true), monthly, schools, stays });
  });

  app.post("/api/admin/spots", requireAuth, async (req, res) => {
    const parsed = insertSpotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    const created = await storage.createSpot(normalizeSpotInput(parsed.data) as any);
    res.json(serializeSpot(created));
  });

  app.patch("/api/admin/spots/:id", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const body = normalizeSpotInput(req.body);
    // If any weather-coord-relevant fields are changing, record that timestamp
    // so weatherStatus can show "Outdated" until data is refreshed.
    const touchesWeatherCoords = WEATHER_COORD_FIELDS.size > 0 &&
      Object.keys(req.body || {}).some(k => WEATHER_COORD_FIELDS.has(k));
    if (touchesWeatherCoords) {
      (body as any).weatherCoordUpdatedAt = new Date().toISOString();
    }
    const updated = await storage.updateSpot(id, body);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(serializeSpot(updated));
  });

  app.post("/api/admin/spots/:id/publish", requireAuth, async (req, res) => {
    const s = await storage.publishSpot(Number(req.params.id));
    if (!s) return res.status(404).json({ error: "not found" });
    res.json(serializeSpot(s));
  });

  app.post("/api/admin/spots/:id/publish-weather", requireAuth, async (req, res) => {
    const spotId = Number(req.params.id);
    const spot = await storage.getSpot(spotId);
    if (!spot) return res.status(404).json({ error: "not found" });
    const scoring = await storage.getScoringContent();
    const recalculatedRows = await recalculateScoresForSpotIds(scoring.published, [spotId], "spots recalculated");
    const publishedCount = await storage.publishAllMonthlyForSpot(spotId);
    await storage.resetWeatherManualChanges(spotId);
    const fresh = await storage.getSpot(spotId);
    res.json({ spot: serializeSpot(fresh!, true), publishedCount, recalculatedRows });
  });

  app.post("/api/admin/spots/:id/publish-content-weather", requireAuth, async (req, res) => {
    const spotId = Number(req.params.id);
    const spot = await storage.getSpot(spotId);
    if (!spot) return res.status(404).json({ error: "not found" });
    const publishedSpot = await storage.publishSpot(spotId);
    const scoring = await storage.getScoringContent();
    const recalculatedRows = await recalculateScoresForSpotIds(scoring.published, [spotId], "spots recalculated");
    const publishedCount = await storage.publishAllMonthlyForSpot(spotId);
    await storage.resetWeatherManualChanges(spotId);
    res.json({ spot: serializeSpot(publishedSpot!, true), publishedCount, recalculatedRows });
  });

  app.post("/api/admin/spots/publish-bulk", requireAuth, async (req, res) => {
    const mode = parseSpotPublishMode(req.body?.mode);
    const scopedIds = Array.from(new Set(parseSpotIds(req.body?.spotIds)));
    if (!scopedIds.length) return res.status(400).json({ error: "spotIds required" });
    const availableSpots = await storage.listSpots(false);
    const targetSpots = availableSpots.filter((spot) => scopedIds.includes(spot.id));
    if (!targetSpots.length) return res.status(404).json({ error: "no matching spots found" });

    let contentPublished = 0;
    let weatherPublished = 0;
    let recalculatedRows = 0;

    if (mode === "content" || mode === "content-weather") {
      for (const spot of targetSpots) {
        const out = await storage.publishSpot(spot.id);
        if (out) contentPublished++;
      }
    }
    if (mode === "weather" || mode === "content-weather") {
      const scoring = await storage.getScoringContent();
      recalculatedRows = await recalculateScoresForSpotIds(scoring.published, targetSpots.map((spot) => spot.id), "spots recalculated");
      for (const spot of targetSpots) {
        weatherPublished += await storage.publishAllMonthlyForSpot(spot.id);
        await storage.resetWeatherManualChanges(spot.id);
      }
    }

    res.json({
      mode,
      targetSpots: targetSpots.length,
      contentPublished,
      weatherPublished,
      recalculatedRows,
    });
  });

  app.delete("/api/admin/spots/:id", requireAuth, async (req, res) => {
    await storage.deleteSpot(Number(req.params.id));
    res.json({ ok: true });
  });

  // Weather enrichment (Open-Meteo). Writes DRAFTS; admin reviews + publishes.
  // Failure-safe: on API error nothing is overwritten and existing data stays.
  app.post("/api/admin/spots/:id/enrich", requireAuth, async (req, res) => {
    if (isExcelImportActive()) return res.status(409).json({ error: "Excel import is active" });
    if (weatherImportActive) return res.status(409).json({ error: "Weather import is already running" });
    weatherImportActive = true;
    try {
      const out = await enrichSpotById(Number(req.params.id));
      res.json(out);
    } catch (e: any) {
      if (e instanceof MissingCoordinatesError) return res.status(422).json({ error: e.message });
      if (/No spot with id/.test(e?.message ?? "")) return res.status(404).json({ error: e.message });
      // Upstream/API failure — surfaced to the admin; data left intact.
      res.status(502).json({ error: `Weather provider error: ${e?.message ?? "unknown"}` });
    } finally {
      weatherImportActive = false;
    }
  });

  app.post("/api/admin/data/refresh", requireAuth, async (req, res) => {
    if (isExcelImportActive()) return res.status(409).json({ error: "Excel import is active" });
    if (weatherImportActive) return res.status(409).json({ error: "Weather import is already running" });
    weatherImportActive = true;
    try {
      const scope = parseWeatherScope(req.body?.scope);
      const scopedIds = new Set(parseSpotIds(req.body?.spotIds));
      if ((scope === "selected" || scope === "filtered") && !scopedIds.size) {
        return res.status(400).json({ error: "spotIds required for selected/filtered scope" });
      }
      const spots = await storage.listSpots(false);
      const scopedSpots = spots.filter(spot => scopeMatchesSpot(scope, scopedIds, spot));
      const eligible = scopedSpots.filter(isEligibleForWeatherRefresh);
      const missingCoords = scopedSpots.length - eligible.length;
      const totalScoped = scopedSpots.length;
      await storage.setWeatherRefreshStatus({
        status: "Refreshing weather data",
        totalSpots: eligible.length,
        completedSpots: 0,
        message: `Refreshing ${eligible.length} spot(s)`,
        dismissible: false,
        dismissed: false,
      });
      if (!eligible.length) {
        const message = totalScoped
          ? "No selected spots have valid coordinates"
          : "No spots matched this refresh scope";
        await storage.setWeatherRefreshStatus({
          status: "Weather refresh completed",
          totalSpots: 0,
          completedSpots: 0,
          message,
          dismissible: true,
          dismissed: false,
        });
        return res.json({ scope, updated: 0, skipped: totalScoped, failed: 0, failures: [] });
      }

      let updated = 0;
      let skipped = missingCoords;
      const failures: { id: number; slug: string; error: string }[] = [];
      let windowStart = Date.now();
      let estimatedRequestsInWindow = 0;

      for (let i = 0; i < eligible.length; i++) {
        const spot = eligible[i];
        if (estimatedRequestsInWindow + ESTIMATED_REQUESTS_PER_SPOT_REFRESH > OPEN_METEO_MAX_REQUESTS_PER_MINUTE) {
          const waitMs = OPEN_METEO_WINDOW_MS - (Date.now() - windowStart);
          if (waitMs > 0) await sleep(waitMs);
          windowStart = Date.now();
          estimatedRequestsInWindow = 0;
        }
        try {
          await enrichSpotById(spot.id);
          updated++;
        } catch (e: any) {
          const errMsg = String(e?.message ?? e);
          failures.push({ id: spot.id, slug: spot.slug, error: errMsg });
          void logError("Weather Enrichment", `Weather refresh failed for spot "${spot.name}": ${errMsg}`, `spot:${spot.id}`);
        } finally {
          estimatedRequestsInWindow += ESTIMATED_REQUESTS_PER_SPOT_REFRESH;
          const completed = i + 1;
          await storage.setWeatherRefreshStatus({
            status: "Refreshing weather data",
            totalSpots: eligible.length,
            completedSpots: completed,
            message: `Refreshing weather data (${completed}/${eligible.length})`,
            dismissible: false,
            dismissed: false,
          });
          if (i < eligible.length - 1) await sleep(REFRESH_SPOT_DELAY_MS);
        }
      }

      if (failures.length) skipped += failures.length;
      await storage.setWeatherRefreshStatus({
        status: failures.length ? "Weather refresh failed" : "Weather refresh completed",
        totalSpots: eligible.length,
        completedSpots: eligible.length,
        message: failures.length
          ? `Completed with ${failures.length} failed spot(s)`
          : `Refreshed ${updated} spot(s)`,
        dismissible: true,
        dismissed: false,
      });
      res.json({ scope, updated, skipped, failed: failures.length, failures });
    } catch (error) {
      await storage.setWeatherRefreshStatus({
        status: "Weather refresh failed",
        message: error instanceof Error ? error.message : "Weather refresh failed",
        dismissible: true,
        dismissed: false,
      });
      throw error;
    } finally {
      weatherImportActive = false;
    }
  });

  app.post("/api/admin/data/publish", requireAuth, async (req, res) => {
    const rawScope = req.body?.scope;
    const scope = rawScope === "selected" || rawScope === "filtered" ? rawScope : "all";
    const scopedIds = new Set(parseSpotIds(req.body?.spotIds));
    if ((scope === "selected" || scope === "filtered") && !scopedIds.size) {
      return res.status(400).json({ error: "spotIds required for selected/filtered scope" });
    }
    const rowsBeforeRecalc = await storage.listAllMonthly(false);
    const scopedRowsBeforeRecalc = scope === "all" ? rowsBeforeRecalc : rowsBeforeRecalc.filter(row => scopedIds.has(row.spotId));
    const targetSpotIds = scope === "all"
      ? Array.from(new Set(scopedRowsBeforeRecalc.map((row) => row.spotId)))
      : Array.from(scopedIds);
    const spotsWithMonthlyRows = Array.from(new Set(scopedRowsBeforeRecalc.map((row) => row.spotId)));
    let recalculatedRows = 0;
    if (spotsWithMonthlyRows.length) {
      const scoring = await storage.getScoringContent();
      recalculatedRows = await recalculateScoresForSpotIds(scoring.published, spotsWithMonthlyRows, "spots recalculated");
    }

    const rowsAfterRecalc = await storage.listAllMonthly(false);
    const scopedRows = scope === "all" ? rowsAfterRecalc : rowsAfterRecalc.filter(row => scopedIds.has(row.spotId));
    const rowsToPublish = scopedRows.filter(row => !row.published || row.hasDraft);
    const alreadyPublished = scopedRows.length - rowsToPublish.length;
    const noMonthlyData = scope === "all"
      ? 0
      : targetSpotIds.filter(spotId => !scopedRows.some(row => row.spotId === spotId)).length;
    let published = 0;
    for (const row of rowsToPublish) {
      const next = await storage.publishMonthly(row.id);
      if (next) published++;
    }
    for (const spotId of spotsWithMonthlyRows) {
      await storage.resetWeatherManualChanges(spotId);
    }
    const skipped = alreadyPublished + noMonthlyData;
    res.json({ scope, published, skipped, alreadyPublished, noMonthlyData, scopedMonthlyRows: scopedRows.length, recalculatedRows });
  });

  app.get("/api/admin/data/refreshable-spots", requireAuth, async (_req, res) => {
    const spots = (await storage.listSpots(false)).map(s => serializeSpot(s, true));
    const rows = spots.map(s => ({
      ...s,
      monthlyCount: 0,
    })).sort((a, b) => {
      const rank = (status: DataStatus) => status === "missing" ? 0 : status === "dirty" ? 1 : 2;
      return rank(a.dataStatus || "missing") - rank(b.dataStatus || "missing") || a.name.localeCompare(b.name);
    });
    res.json(rows);
  });

  // Monthly records
  app.post("/api/admin/monthly", requireAuth, async (req, res) => {
    const parsed = insertMonthlySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    const created = await storage.createMonthly(parsed.data as any);
    res.json(serializeMonthly(created));
  });
  app.patch("/api/admin/monthly/:id", requireAuth, async (req, res) => {
    const updated = await storage.updateMonthly(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "not found" });
    // Mark the parent spot as having manual weather changes (spec §20.2 "Up to date · Manual changes").
    await storage.updateSpot(updated.spotId, { weatherHasManualChanges: true } as any);
    // For already-published spots, manual weather edits go live immediately (spec §19.3).
    const spot = await storage.getSpot(updated.spotId);
    if (spot?.published) {
      await storage.publishMonthly(updated.id);
    }
    res.json(serializeMonthly(updated));
  });
  app.post("/api/admin/monthly/:id/publish", requireAuth, async (req, res) => {
    const m = await storage.publishMonthly(Number(req.params.id));
    if (!m) return res.status(404).json({ error: "not found" });
    res.json(serializeMonthly(m));
  });
  app.post("/api/admin/spots/:id/monthly/publish", requireAuth, async (req, res) => {
    const spotId = Number(req.params.id);
    const spot = await storage.getSpot(spotId);
    if (!spot) return res.status(404).json({ error: "not found" });
    const scoring = await storage.getScoringContent();
    const recalculatedRows = await recalculateScoresForSpotIds(scoring.published, [spotId], "spots recalculated");
    const count = await storage.publishAllMonthlyForSpot(spotId);
    await storage.resetWeatherManualChanges(spotId);
    res.json({ publishedCount: count, recalculatedRows });
  });
  // Reset all manual weather changes for a spot (spec §19.4).
  app.post("/api/admin/spots/:id/weather/reset", requireAuth, async (req, res) => {
    const spotId = Number(req.params.id);
    const spot = await storage.getSpot(spotId);
    if (!spot) return res.status(404).json({ error: "not found" });
    await storage.resetWeatherManualChanges(spotId);
    const updated = await storage.getSpot(spotId);
    res.json(serializeSpot(updated!, true));
  });
  app.post("/api/admin/scores/recalculate", requireAuth, async (req, res) => {
    if (scoringRecalcActive) return res.status(409).json({ error: "score recalculation is already running" });
    const scoring = await storage.getScoringContent();
    const spotIds = parseSpotIds(req.body?.spotIds);
    if (spotIds.length) {
      const updated = await recalculateScoresForSpotIds(scoring.published, spotIds, "spots recalculated");
      return res.json({ updated, scoped: true, spots: spotIds.length });
    }
    const updated = await recalculateScoresForAllSpots(scoring.published, false);
    res.json({ updated, scoped: false });
  });
  app.delete("/api/admin/monthly/:id", requireAuth, async (req, res) => {
    await storage.deleteMonthly(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/admin/usage/open-meteo", requireAuth, async (_req, res) => {
    const { getOpenMeteoStats } = await import("./services/openMeteo");
    res.json(getOpenMeteoStats());
  });

  app.get("/api/admin/scoring", requireAuth, async (_req, res) => {
    res.json(await storage.getScoringContent());
  });

  app.patch("/api/admin/scoring", requireAuth, async (req, res) => {
    const next = { ...req.body } as ScoringConfig;
    const scoring = await storage.saveScoringDraft(next);
    res.json(scoring);
  });

  app.get("/api/admin/scoring/status", requireAuth, async (_req, res) => {
    res.json(await storage.getScoringStatus());
  });

  app.post("/api/admin/scoring/dismiss", requireAuth, async (_req, res) => {
    res.json(await storage.dismissScoringStatus());
  });

  app.get("/api/admin/weather-refresh/status", requireAuth, async (_req, res) => {
    res.json(await storage.getWeatherRefreshStatus());
  });

  app.post("/api/admin/weather-refresh/dismiss", requireAuth, async (_req, res) => {
    res.json(await storage.dismissWeatherRefreshStatus());
  });

  app.post("/api/admin/scoring/publish", requireAuth, async (req, res) => {
    if (scoringRecalcActive) return res.status(409).json({ error: "score recalculation is already running" });
    const next = { ...req.body } as ScoringConfig;
    const scoring = await storage.saveScoringDraft(next);
    void recalculateScoresForAllSpots(scoring.draft, true).catch((error) => {
      void logError("Scoring Publish", `Score recalculation failed: ${error instanceof Error ? error.message : String(error)}`, null);
    });
    res.json({ ok: true });
  });

  // ── Global listing admin: Schools ──
  app.get("/api/admin/listings/schools", requireAuth, async (req, res) => {
    const q = req.query;
    const filter: ListingsFilter = {
      search: (q.search as string) || undefined,
      published: q.published !== undefined ? q.published === "true" : undefined,
      spotId: q.spotId ? Number(q.spotId) : undefined,
      missingWebsite: q.missingWebsite === "true" ? true : undefined,
      missingMap: q.missingMap === "true" ? true : undefined,
      offersLessons: q.offersLessons !== undefined ? q.offersLessons === "true" : undefined,
      offersRental: q.offersRental !== undefined ? q.offersRental === "true" : undefined,
      sports: q.sports ? ([] as string[]).concat(q.sports as any) : undefined,
      sortBy: (q.sortBy as any) || "updatedAt",
      sortDir: (q.sortDir as any) || "desc",
      page: q.page ? Number(q.page) : 1,
      perPage: q.perPage ? Number(q.perPage) : 50,
    };
    const result = await storage.listAllSchools(filter);
    res.json({ ...result, items: result.items.map(s => ({ ...s, sports: parseArr(s.sports) })) });
  });

  app.post("/api/admin/listings/schools", requireAuth, async (req, res) => {
    const { name, ...rest } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const created = await storage.createSchool({ name, ...rest } as any);
    res.json({ ...created, sports: parseArr(created.sports) });
  });

  app.patch("/api/admin/listings/schools/:id", requireAuth, async (req, res) => {
    const updated = await storage.updateSchool(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json({ ...updated, sports: parseArr(updated.sports) });
  });

  app.post("/api/admin/listings/schools/:id/publish", requireAuth, async (req, res) => {
    const row = await storage.publishSchool(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ ...row, sports: parseArr(row.sports) });
  });

  app.delete("/api/admin/listings/schools/:id", requireAuth, async (req, res) => {
    await storage.deleteSchool(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Global listing admin: Stays ──
  app.get("/api/admin/listings/stays", requireAuth, async (req, res) => {
    const q = req.query;
    const filter: ListingsFilter = {
      search: (q.search as string) || undefined,
      published: q.published !== undefined ? q.published === "true" : undefined,
      spotId: q.spotId ? Number(q.spotId) : undefined,
      missingWebsite: q.missingWebsite === "true" ? true : undefined,
      missingMap: q.missingMap === "true" ? true : undefined,
      type: (q.type as string) || undefined,
      sortBy: (q.sortBy as any) || "updatedAt",
      sortDir: (q.sortDir as any) || "desc",
      page: q.page ? Number(q.page) : 1,
      perPage: q.perPage ? Number(q.perPage) : 50,
    };
    const result = await storage.listAllStays(filter);
    res.json(result);
  });

  app.post("/api/admin/listings/stays", requireAuth, async (req, res) => {
    const { name, ...rest } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const created = await storage.createStay({ name, ...rest } as any);
    res.json(created);
  });

  app.patch("/api/admin/listings/stays/:id", requireAuth, async (req, res) => {
    const updated = await storage.updateStay(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  });

  app.post("/api/admin/listings/stays/:id/publish", requireAuth, async (req, res) => {
    const row = await storage.publishStay(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  });

  app.delete("/api/admin/listings/stays/:id", requireAuth, async (req, res) => {
    await storage.deleteStay(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Spot–school assignment endpoints ──
  // List assignments for a spot
  app.get("/api/admin/spots/:id/school-assignments", requireAuth, async (req, res) => {
    const rows = await storage.listSchoolsForSpot(Number(req.params.id), false);
    res.json(rows.map(s => ({ ...s, sports: parseArr(s.sports) })));
  });

  // Assign existing school to spot
  app.post("/api/admin/spots/:id/school-assignments/assign", requireAuth, async (req, res) => {
    const spotId = Number(req.params.id);
    const schoolId = Number(req.body?.schoolId);
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });
    try {
      await storage.assignSchool(spotId, schoolId);
    } catch (e: any) {
      if (/UNIQUE/.test(e?.message ?? "")) return res.status(409).json({ error: "already assigned" });
      throw e;
    }
    const rows = await storage.listSchoolsForSpot(spotId, false);
    res.json(rows.map(s => ({ ...s, sports: parseArr(s.sports) })));
  });

  // Create new school and assign to spot
  app.post("/api/admin/spots/:id/school-assignments/create-and-assign", requireAuth, async (req, res) => {
    const spotId = Number(req.params.id);
    const { name, ...rest } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const created = await storage.createSchool({ name, ...rest } as any);
    await storage.assignSchool(spotId, created.id);
    const rows = await storage.listSchoolsForSpot(spotId, false);
    res.json(rows.map(s => ({ ...s, sports: parseArr(s.sports) })));
  });

  // Unassign school from spot
  app.delete("/api/admin/spots/:id/school-assignments/:schoolId", requireAuth, async (req, res) => {
    await storage.unassignSchool(Number(req.params.id), Number(req.params.schoolId));
    res.json({ ok: true });
  });

  // Reorder school assignments for a spot
  app.patch("/api/admin/spots/:id/school-assignments/reorder", requireAuth, async (req, res) => {
    const spotId = Number(req.params.id);
    const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map(Number) : [];
    await storage.reorderSchoolAssignments(spotId, orderedIds);
    const rows = await storage.listSchoolsForSpot(spotId, false);
    res.json(rows.map(s => ({ ...s, sports: parseArr(s.sports) })));
  });

  // ── Spot–stay assignment endpoints ──
  app.get("/api/admin/spots/:id/stay-assignments", requireAuth, async (req, res) => {
    const rows = await storage.listStaysForSpot(Number(req.params.id), false);
    res.json(rows);
  });

  app.post("/api/admin/spots/:id/stay-assignments/assign", requireAuth, async (req, res) => {
    const spotId = Number(req.params.id);
    const stayId = Number(req.body?.stayId);
    if (!stayId) return res.status(400).json({ error: "stayId required" });
    try {
      await storage.assignStay(spotId, stayId);
    } catch (e: any) {
      if (/UNIQUE/.test(e?.message ?? "")) return res.status(409).json({ error: "already assigned" });
      throw e;
    }
    res.json(await storage.listStaysForSpot(spotId, false));
  });

  app.post("/api/admin/spots/:id/stay-assignments/create-and-assign", requireAuth, async (req, res) => {
    const spotId = Number(req.params.id);
    const { name, ...rest } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const created = await storage.createStay({ name, ...rest } as any);
    await storage.assignStay(spotId, created.id);
    res.json(await storage.listStaysForSpot(spotId, false));
  });

  app.delete("/api/admin/spots/:id/stay-assignments/:stayId", requireAuth, async (req, res) => {
    await storage.unassignStay(Number(req.params.id), Number(req.params.stayId));
    res.json({ ok: true });
  });

  app.patch("/api/admin/spots/:id/stay-assignments/reorder", requireAuth, async (req, res) => {
    const spotId = Number(req.params.id);
    const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map(Number) : [];
    await storage.reorderStayAssignments(spotId, orderedIds);
    res.json(await storage.listStaysForSpot(spotId, false));
  });

  // ── Legacy school/stay routes (kept for backward compat with import/export) ──
  app.post("/api/admin/schools", requireAuth, async (req, res) => {
    const { spotId, ...rest } = req.body || {};
    if (!rest.name) return res.status(400).json({ error: "name required" });
    const created = await storage.createSchool({ ...rest } as any);
    if (spotId) await storage.assignSchool(Number(spotId), created.id);
    res.json({ ...created, sports: parseArr(created.sports) });
  });
  app.patch("/api/admin/schools/:id", requireAuth, async (req, res) => {
    const updated = await storage.updateSchool(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json({ ...updated, sports: parseArr(updated.sports) });
  });
  app.post("/api/admin/schools/:id/publish", requireAuth, async (req, res) => {
    const row = await storage.publishSchool(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ ...row, sports: parseArr(row.sports) });
  });
  app.delete("/api/admin/schools/:id", requireAuth, async (req, res) => {
    await storage.deleteSchool(Number(req.params.id));
    res.json({ ok: true });
  });

  app.post("/api/admin/stays", requireAuth, async (req, res) => {
    const { spotId, ...rest } = req.body || {};
    if (!rest.name) return res.status(400).json({ error: "name required" });
    const created = await storage.createStay({ ...rest } as any);
    if (spotId) await storage.assignStay(Number(spotId), created.id);
    res.json(created);
  });
  app.patch("/api/admin/stays/:id", requireAuth, async (req, res) => {
    const updated = await storage.updateStay(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  });
  app.post("/api/admin/stays/:id/publish", requireAuth, async (req, res) => {
    const row = await storage.publishStay(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  });
  app.delete("/api/admin/stays/:id", requireAuth, async (req, res) => {
    await storage.deleteStay(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/admin/spots/:id/export", requireAuth, async (req, res) => {
    const spot = await storage.getSpot(Number(req.params.id));
    if (!spot) return res.status(404).json({ error: "not found" });
    const monthly = await storage.listMonthly(spot.id, false);
    const schools = await storage.listSchoolsForSpot(spot.id, false);
    const stays = await storage.listStaysForSpot(spot.id, false);
    res.json({ spot: serializeSpot(spot, true), monthly, schools, stays });
  });

  app.post("/api/admin/spots/:id/import", requireAuth, async (req, res) => {
    const spotId = Number(req.params.id);
    const spot = await storage.getSpot(spotId);
    if (!spot) return res.status(404).json({ error: "not found" });

    const payload = req.body || {};
    if (!payload?.spot) return res.status(400).json({ error: "spot export payload required" });

    const importedSpot = payload.spot as any;
    const importedMonthly = Array.isArray(payload.monthly) ? payload.monthly : [];
    const importedSchools = Array.isArray(payload.schools) ? payload.schools : [];
    const importedStays = Array.isArray(payload.stays) ? payload.stays : [];

    await db.transaction(async tx => {
      const { id: _id, publicId: _publicId, createdAt: _createdAt, updatedAt: _updatedAt, publishedSnapshot: _snapshot, monthly: _monthly, schools: _schools, stays: _stays, slug: _slug, ...restSpot } = importedSpot;
      await tx.update(spots).set({ ...restSpot, hasDraft: true, updatedAt: new Date().toISOString() } as any).where(eq(spots.id, spotId));

      await tx.delete(monthlyRecords).where(eq(monthlyRecords.spotId, spotId));
      for (const m of importedMonthly) {
        const { id: _mid, spotId: _sid, createdAt: _mCreatedAt, updatedAt: _mUpdatedAt, publishedSnapshot: _mSnapshot, ...restMonthly } = m as any;
        await tx.insert(monthlyRecords).values({
          ...restMonthly, spotId,
          published: !!restMonthly.published, hasDraft: !!restMonthly.hasDraft,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          publishedSnapshot: JSON.stringify(restMonthly),
        } as any);
      }
    });

    // Re-create school/stay assignments from imported data (create new entities, assign)
    for (const s of importedSchools) {
      const { id: _sid, spotId: _ss, createdAt: _c, updatedAt: _u, publishedSnapshot: _ps, ...restSchool } = s as any;
      const created = await storage.createSchool(restSchool);
      await storage.assignSchool(spotId, created.id);
    }
    for (const s of importedStays) {
      const { id: _sid, spotId: _ss, createdAt: _c, updatedAt: _u, publishedSnapshot: _ps, ...restStay } = s as any;
      const created = await storage.createStay(restStay);
      await storage.assignStay(spotId, created.id);
    }

    const updatedSpot = await storage.getSpot(spotId);
    const monthly = (await storage.listMonthly(spotId, false)).map(m => serializeMonthly(m, true));
    const schoolsOut = (await storage.listSchoolsForSpot(spotId, false)).map(s => serializeLinked(s, true));
    const staysOut = (await storage.listStaysForSpot(spotId, false)).map(s => serializeLinked(s, true));
    res.json({ ...serializeSpot(updatedSpot!, true), monthly, schools: schoolsOut, stays: staysOut });
  });

  // Filter defs admin
  app.get("/api/admin/filters", requireAuth, async (_req, res) => {
    const defs = await storage.listFilterDefs(false);
    res.json(defs.map(d => ({ ...d, options: parseArr(d.options) })));
  });

  app.get("/api/admin/legal", requireAuth, async (_req, res) => {
    const legal = await storage.getLegalContent();
    res.json({
      ...legal,
      privacyPolicy: LEGAL_PAGE_META["privacy-policy"],
      legalNotice: LEGAL_PAGE_META["legal-notice"],
      canPublish: legal.privacyPolicyDraft.trim().length > 0 && legal.legalNoticeDraft.trim().length > 0,
    });
  });

  app.patch("/api/admin/legal", requireAuth, async (req, res) => {
    const privacyPolicyDraft = String(req.body?.privacyPolicyDraft ?? "");
    const legalNoticeDraft = String(req.body?.legalNoticeDraft ?? "");
    const legal = await storage.saveLegalDraft(privacyPolicyDraft, legalNoticeDraft);
    res.json({
      ...legal,
      privacyPolicy: LEGAL_PAGE_META["privacy-policy"],
      legalNotice: LEGAL_PAGE_META["legal-notice"],
      canPublish: legal.privacyPolicyDraft.trim().length > 0 && legal.legalNoticeDraft.trim().length > 0,
    });
  });

  app.post("/api/admin/legal/publish", requireAuth, async (_req, res) => {
    const current = await storage.getLegalContent();
    if (!current.privacyPolicyDraft.trim() || !current.legalNoticeDraft.trim()) {
      return res.status(400).json({ error: "Both legal texts must be non-empty before publish." });
    }
    const legal = await storage.publishLegalDraft();
    res.json({
      ...legal,
      privacyPolicy: LEGAL_PAGE_META["privacy-policy"],
      legalNotice: LEGAL_PAGE_META["legal-notice"],
      canPublish: legal.privacyPolicyDraft.trim().length > 0 && legal.legalNoticeDraft.trim().length > 0,
    });
  });

  app.get("/api/admin/seo", requireAuth, async (_req, res) => {
    const seo = await storage.getSeoContent();
    res.json({
      ...seo,
      canPublish: allSeoDraftFieldsFilled({
        homepageTitleDraft: seo.homepageTitleDraft,
        homepageDescriptionDraft: seo.homepageDescriptionDraft,
        exploreTitleDraft: seo.exploreTitleDraft,
        exploreDescriptionDraft: seo.exploreDescriptionDraft,
        methodologyTitleDraft: seo.methodologyTitleDraft,
        methodologyDescriptionDraft: seo.methodologyDescriptionDraft,
      }),
    });
  });

  app.patch("/api/admin/seo", requireAuth, async (req, res) => {
    const next = seoDraftPayload(req.body);
    if (!allSeoDraftFieldsFilled(next)) {
      return res.status(400).json({ error: "All six SEO fields are required." });
    }
    const seo = await storage.saveSeoDraft(next);
    res.json({
      ...seo,
      canPublish: allSeoDraftFieldsFilled(next),
    });
  });

  app.post("/api/admin/seo/publish", requireAuth, async (_req, res) => {
    const current = await storage.getSeoContent();
    const draft = {
      homepageTitleDraft: current.homepageTitleDraft,
      homepageDescriptionDraft: current.homepageDescriptionDraft,
      exploreTitleDraft: current.exploreTitleDraft,
      exploreDescriptionDraft: current.exploreDescriptionDraft,
      methodologyTitleDraft: current.methodologyTitleDraft,
      methodologyDescriptionDraft: current.methodologyDescriptionDraft,
    };
    if (!allSeoDraftFieldsFilled(draft)) {
      return res.status(400).json({ error: "All six SEO fields are required before publish." });
    }
    const seo = await storage.publishSeoDraft();
    res.json({
      ...seo,
      canPublish: allSeoDraftFieldsFilled({
        homepageTitleDraft: seo.homepageTitleDraft,
        homepageDescriptionDraft: seo.homepageDescriptionDraft,
        exploreTitleDraft: seo.exploreTitleDraft,
        exploreDescriptionDraft: seo.exploreDescriptionDraft,
        methodologyTitleDraft: seo.methodologyTitleDraft,
        methodologyDescriptionDraft: seo.methodologyDescriptionDraft,
      }),
    });
  });

  app.get("/api/admin/pages/:slug", requireAuth, async (req, res) => {
    const page = await storage.getSitePageBySlug(String(req.params.slug));
    if (!page) return res.status(404).json({ error: "not found" });
    res.json(page);
  });

  app.patch("/api/admin/pages/:slug", requireAuth, async (req, res) => {
    const slug = req.params.slug;
    const body = String(req.body?.body ?? "").trim();
    const title = String(req.body?.title ?? slug).trim() || slug;
    if (!body) return res.status(400).json({ error: "body required" });
    const page = await storage.upsertSitePage({ slug, title, body } as any);
    res.json(page);
  });

  // ── Trash: soft-delete lifecycle (spec §28) ──
  const TRASH_CATEGORIES = new Set<TrashCategory>(["spots", "schools", "stays"]);
  function isTrashCategory(v: string): v is TrashCategory { return TRASH_CATEGORIES.has(v as TrashCategory); }

  app.get("/api/admin/trash", requireAuth, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const items = await storage.listTrash();
    res.json(items);
  });

  app.get("/api/admin/trash/:category/:id/restore-info", requireAuth, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const category = req.params.category as string;
    if (!isTrashCategory(category)) return res.status(400).json({ error: "invalid category" });
    const id = Number(req.params.id);
    const info = await storage.getRestoreInfo(category, id);
    if (!info) return res.status(404).json({ error: "not found in trash" });
    res.json(info);
  });

  app.post("/api/admin/trash/:category/:id/restore", requireAuth, async (req, res) => {
    const category = req.params.category as string;
    if (!isTrashCategory(category)) return res.status(400).json({ error: "invalid category" });
    const id = Number(req.params.id);
    const info = await storage.getRestoreInfo(category, id);
    if (!info) return res.status(404).json({ error: "not found in trash" });
    await storage.restoreEntity(category, id);
    res.json({ ok: true, category, id });
  });

  app.delete("/api/admin/trash/:category/:id", requireAuth, async (req, res) => {
    const category = req.params.category as string;
    if (!isTrashCategory(category)) return res.status(400).json({ error: "invalid category" });
    const id = Number(req.params.id);
    const info = await storage.getRestoreInfo(category, id);
    if (!info) return res.status(404).json({ error: "not found in trash" });
    await storage.permanentDeleteEntity(category, id);
    res.json({ ok: true });
  });

  // ── Redirects admin (spec §29) ──
  app.get("/api/admin/redirects", requireAuth, async (_req, res) => {
    const items = await storage.listRedirects();
    const spotIds = Array.from(new Set(items.filter(r => r.spotId != null).map(r => r.spotId!)));
    const spotNames: Record<number, string> = {};
    if (spotIds.length) {
      const placeholders = spotIds.map(() => "?").join(",");
      const rows = sqlite.prepare(`SELECT id, name FROM spots WHERE id IN (${placeholders})`).all(...spotIds) as { id: number; name: string }[];
      rows.forEach(r => { spotNames[r.id] = r.name; });
    }
    res.json(items.map(r => ({ ...r, spotName: r.spotId != null ? (spotNames[r.spotId] ?? null) : null })));
  });

  app.post("/api/admin/redirects", requireAuth, async (req, res) => {
    const { fromPath, toUrl, targetType, spotId } = req.body || {};
    if (!fromPath || !toUrl || !targetType) return res.status(400).json({ error: "fromPath, toUrl, targetType required" });
    if (targetType !== "spot" && targetType !== "manual") return res.status(400).json({ error: "targetType must be 'spot' or 'manual'" });
    const conflict = await storage.checkRedirectConflicts(String(fromPath), String(toUrl));
    if (conflict) return res.status(409).json({ error: conflict.reason });
    const created = await storage.createRedirect({ fromPath: String(fromPath), toUrl: String(toUrl), targetType, spotId: spotId != null ? Number(spotId) : null });
    const spotNameRow = created.spotId != null ? sqlite.prepare(`SELECT name FROM spots WHERE id = ?`).get(created.spotId) as { name: string } | undefined : undefined;
    res.json({ ...created, spotName: spotNameRow?.name ?? null });
  });

  app.patch("/api/admin/redirects/:id", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const { fromPath, toUrl, targetType, spotId } = req.body || {};
    if (!fromPath || !toUrl || !targetType) return res.status(400).json({ error: "fromPath, toUrl, targetType required" });
    if (targetType !== "spot" && targetType !== "manual") return res.status(400).json({ error: "targetType must be 'spot' or 'manual'" });
    const conflict = await storage.checkRedirectConflicts(String(fromPath), String(toUrl), id);
    if (conflict) return res.status(409).json({ error: conflict.reason });
    const updated = await storage.updateRedirect(id, { fromPath: String(fromPath), toUrl: String(toUrl), targetType, spotId: spotId != null ? Number(spotId) : null });
    if (!updated) return res.status(404).json({ error: "not found" });
    const spotNameRow = updated.spotId != null ? sqlite.prepare(`SELECT name FROM spots WHERE id = ?`).get(updated.spotId) as { name: string } | undefined : undefined;
    res.json({ ...updated, spotName: spotNameRow?.name ?? null });
  });

  app.delete("/api/admin/redirects/:id", requireAuth, async (req, res) => {
    await storage.deleteRedirect(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Admin Errors (spec §33) ──
  app.get("/api/admin/errors/count", requireAuth, async (_req, res) => {
    const open = await storage.countOpenAdminErrors();
    res.json({ open });
  });

  app.get("/api/admin/errors", requireAuth, async (req, res) => {
    const statusParam = req.query.status as string | undefined;
    const validStatuses: AdminErrorStatus[] = ["Open", "Resolved", "Dismissed"];
    const filter = validStatuses.includes(statusParam as AdminErrorStatus)
      ? { status: statusParam as AdminErrorStatus }
      : undefined;
    const rows = await storage.listAdminErrors(filter);
    res.json(rows.map(r => ({
      id: r.id,
      area: r.area,
      recordId: r.record_id ?? null,
      summary: r.summary,
      errorId: r.error_id,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })));
  });

  app.post("/api/admin/errors/:id/dismiss", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    await storage.dismissAdminError(id);
    res.json({ ok: true });
  });

  /* ══════════════ DEPLOYMENT ══════════════ */
  // Deploy the latest code from GitHub: git pull → npm ci → npm run build → pm2 restart
  app.post("/api/admin/deploy", requireAuth, async (req, res) => {
    try {
      log("Starting deployment...");
      
      // Run deployment commands synchronously with timeout
      const commands = [
        "git pull origin main",
        "npm ci",
        "npm run build",
        "pm2 restart kite-compass",
      ];

      const results: string[] = [];
      for (const cmd of commands) {
        log(`Executing: ${cmd}`);
        try {
          const output = execSync(cmd, { 
            cwd: process.cwd(),
            stdio: 'pipe',
            timeout: 5 * 60 * 1000,
            encoding: 'utf-8',
          });
          results.push(`✓ ${cmd}`);
          log(`✓ ${cmd}`);
        } catch (error: any) {
          const errorMsg = error.stderr || error.stdout || String(error);
          results.push(`✗ ${cmd}: ${errorMsg.substring(0, 200)}`);
          log(`✗ ${cmd}: ${errorMsg.substring(0, 200)}`);
          throw new Error(`Deployment failed at "${cmd}": ${errorMsg.substring(0, 500)}`);
        }
      }

      log("✓ Deployment completed successfully");
      res.json({ 
        ok: true, 
        message: "Deployment successful",
        steps: results,
      });
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`✗ Deployment failed: ${errorMsg}`);
      res.status(500).json({ 
        error: errorMsg,
        message: "Deployment failed",
      });
    }
  });

  return httpServer;
}
