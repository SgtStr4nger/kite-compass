import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import crypto from 'node:crypto';
import { and, eq } from "drizzle-orm";
import { db, storage } from "./storage";
import type { ListingsFilter, SeoContent } from "./storage";
import { enrichSpotById, MissingCoordinatesError } from "./services/enrichment";
import { calculateAutoMonthlyScore, deriveSeasonLabelFromScore, resolveMonthlyScore } from "@shared/scoring";
import { insertSpotSchema, insertMonthlySchema, monthlyRecords, schools, spots, stays } from "@shared/schema";
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

const REFRESH_SPOT_DELAY_MS = 900;
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

function applyPublicSeasonLabels(monthly: any[], rankingMode?: string | null): any[] {
  return monthly.map(m => ({
    ...m,
    seasonLabel: deriveSeasonLabelFromScore(monthlyScoreForSpot(m, rankingMode)),
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
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
    const spots = (await storage.listSpots(!admin)).map(s => serializeSpot(s, admin));
    const monthly = (await storage.listAllMonthly(!admin)).map(m => serializeMonthly(m, admin));
    const query = ((req.query.q as string) || "").trim().toLowerCase();

    const months = toArray(req.query.month);
    const monthSet = new Set(months);
    const spotTypes = ([] as string[]).concat(req.query.spotType as any || []);
    const riderLevels = ([] as string[]).concat(req.query.riderLevel as any || []);
    const vibes = ([] as string[]).concat(req.query.vibe as any || []);
    const country = (req.query.country as string) || null;
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
      const publicMonthly = admin ? spotMonthly : applyPublicSeasonLabels(spotMonthly, rankingMode);
      const selectedMonthly = months.length ? spotMonthly.filter(m => monthSet.has(m.month)) : [];
      const monthsAvail = spotMonthly.map(m => m.month);
      const scoreSource = months.length ? selectedMonthly : spotMonthly;
      const scores = scoreSource
        .map(record => monthlyScoreForSpot(record, rankingMode))
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
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
      const monthRecord = rec ? { ...rec, seasonLabel: publicRec?.seasonLabel ?? deriveSeasonLabelFromScore(monthlyScoreForSpot(rec, rankingMode)) } : null;
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
    if (country) rows = rows.filter(r => r.country === country);

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
    const publicMonthly = admin ? monthly : applyPublicSeasonLabels(monthly, serializedSpot.rankingMode);
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

  app.delete("/api/admin/spots/:id", requireAuth, async (req, res) => {
    await storage.deleteSpot(Number(req.params.id));
    res.json({ ok: true });
  });

  // Weather enrichment (Open-Meteo). Writes DRAFTS; admin reviews + publishes.
  // Failure-safe: on API error nothing is overwritten and existing data stays.
  app.post("/api/admin/spots/:id/enrich", requireAuth, async (req, res) => {
    try {
      const out = await enrichSpotById(Number(req.params.id));
      res.json(out);
    } catch (e: any) {
      if (e instanceof MissingCoordinatesError) return res.status(422).json({ error: e.message });
      if (/No spot with id/.test(e?.message ?? "")) return res.status(404).json({ error: e.message });
      // Upstream/API failure — surfaced to the admin; data left intact.
      res.status(502).json({ error: `Weather provider error: ${e?.message ?? "unknown"}` });
    }
  });

  app.post("/api/admin/data/refresh", requireAuth, async (req, res) => {
    const scope = req.body?.scope === "all" ? "all" : "missing";
    const spots = await storage.listSpots(false);
    const eligible = spots.filter(spot => {
      if (!spot.latitude || !spot.longitude) return false;
      return scope === "all" ? true : !spot.dataLastRefreshedAt;
    });

    let updated = 0;
    let skipped = spots.length - eligible.length;
    const failures: { id: number; slug: string; error: string }[] = [];

    for (const spot of eligible) {
      try {
        await enrichSpotById(spot.id);
        updated++;
      } catch (e: any) {
        failures.push({ id: spot.id, slug: spot.slug, error: String(e?.message ?? e) });
      } finally {
        if (spot !== eligible[eligible.length - 1]) await sleep(REFRESH_SPOT_DELAY_MS);
      }
    }

    if (failures.length) skipped += failures.length;
    res.json({ scope, updated, skipped, failed: failures.length, failures });
  });

  app.post("/api/admin/data/publish", requireAuth, async (_req, res) => {
    const rows = await storage.listAllMonthly(false);
    let published = 0;
    for (const row of rows) {
      if (row.published) continue;
      const next = await storage.publishMonthly(row.id);
      if (next) published++;
    }
    res.json({ published });
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
    const count = await storage.publishAllMonthlyForSpot(spotId);
    res.json({ publishedCount: count });
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
  app.post("/api/admin/scores/recalculate", requireAuth, async (_req, res) => {
    const rows = await storage.listAllMonthly(false);
    const spotRows = await storage.listSpots(false);
    const rankingModeBySpotId = new Map(spotRows.map(spot => [spot.id, spot.rankingMode]));
    let updated = 0;
    for (const row of rows) {
      const rankingMode = rankingModeBySpotId.get(row.spotId);
      if (rankingMode !== "auto") continue;
      const score = calculateAutoMonthlyScore(row);
      await storage.updateMonthly(row.id, {
        automaticWindScore: score,
        seasonLabel: deriveSeasonLabelFromScore(score),
      } as any);
      updated++;
    }
    res.json({ updated });
  });
  app.delete("/api/admin/monthly/:id", requireAuth, async (req, res) => {
    await storage.deleteMonthly(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/admin/usage/open-meteo", requireAuth, async (_req, res) => {
    const { getOpenMeteoStats } = await import("./services/openMeteo");
    res.json(getOpenMeteoStats());
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

  return httpServer;
}
