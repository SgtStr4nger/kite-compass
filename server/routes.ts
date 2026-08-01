import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import crypto from 'node:crypto';
import { and, eq } from "drizzle-orm";
import { db, storage } from "./storage";
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
function makeToken(userId: number): string {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${userId}.${exp}`;
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}
function verifyToken(token: string): number | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const [userId, exp, sig] = decoded.split(".");
    const payload = `${userId}.${exp}`;
    const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    if (Date.now() > Number(exp)) return null;
    return Number(userId);
  } catch { return null; }
}
function getBearer(req: Request): string | null {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getBearer(req);
  const uid = token ? verifyToken(token) : null;
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  (req as any).userId = uid;
  next();
}
function isAuthed(req: Request): boolean {
  const token = getBearer(req);
  return !!(token && verifyToken(token));
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
    contentStatus: computeContentStatus(s),
    weatherStatus: computeWeatherStatus(s as any),
    published: !!s.published,
    hasDraft: !!s.hasDraft,
    // never expose the raw snapshot blob to clients
    publishedSnapshot: undefined,
  };
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

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  /* ══════════════ AUTH ══════════════ */
  // Setup: create the first admin (only allowed when no users exist).
  app.post("/api/auth/setup", async (req, res) => {
    const count = await storage.countUsers();
    if (count > 0) return res.status(403).json({ error: "setup already complete" });
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 6)
      return res.status(400).json({ error: "email and password (min 6 chars) required" });
    const user = await storage.createUser({ email, passwordHash: hashPassword(password) });
    return res.json({ token: makeToken(user.id), email: user.email });
  });

  app.get("/api/auth/status", async (_req, res) => {
    res.json({ needsSetup: (await storage.countUsers()) === 0 });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    const user = email ? await storage.getUserByEmail(email) : undefined;
    if (!user || !verifyPassword(password || "", user.passwordHash))
      return res.status(401).json({ error: "invalid credentials" });
    res.json({ token: makeToken(user.id), email: user.email });
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const u = await storage.getUser((req as any).userId);
    res.json({ email: u?.email });
  });

  // Create additional admin (multi-user readiness) — requires auth.
  app.post("/api/admin/users", requireAuth, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 6)
      return res.status(400).json({ error: "email and password (min 6 chars) required" });
    if (await storage.getUserByEmail(email)) return res.status(409).json({ error: "email exists" });
    const user = await storage.createUser({ email, passwordHash: hashPassword(password) });
    res.json({ email: user.email });
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
    const spot = await storage.getSpotBySlug(req.params.slug);
    if (!spot || (!spot.published && !admin)) return res.status(404).json({ error: "not found" });
    const serializedSpot = serializeSpot(spot, admin);
    const monthly = (await storage.listMonthly(spot.id, !admin)).map(m => serializeMonthly(m, admin));
    const publicMonthly = admin ? monthly : applyPublicSeasonLabels(monthly, serializedSpot.rankingMode);
    const schools = (await storage.listSchools(spot.id, !admin)).map(s => serializeLinked(s, admin));
    const stays = (await storage.listStays(spot.id, !admin)).map(s => serializeLinked(s, admin));
    res.json({ ...serializedSpot, monthly: publicMonthly, schools, stays });
  });

  // list of distinct countries (for filter)
  app.get("/api/countries", async (_req, res) => {
    const spots = await storage.listSpots(true);
    const set = Array.from(new Set(spots.map(s => s.country).filter(Boolean))).sort();
    res.json(set);
  });

  app.get("/api/pages/:slug", async (req, res) => {
    const page = await storage.getSitePageBySlug(String(req.params.slug));
    if (!page) return res.status(404).json({ error: "not found" });
    res.json(page);
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
    const schools = (await storage.listSchools(spot.id, false)).map(s => serializeLinked(s, true));
    const stays = (await storage.listStays(spot.id, false)).map(s => serializeLinked(s, true));
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

  // Linked schools
  app.post("/api/admin/schools", requireAuth, async (req, res) => {
    const { spotId, ...rest } = req.body || {};
    if (!spotId || !rest.name) return res.status(400).json({ error: "spotId and name required" });
    const created = await storage.createSchool({ spotId: Number(spotId), ...rest } as any);
    res.json(created);
  });
  app.patch("/api/admin/schools/:id", requireAuth, async (req, res) => {
    const updated = await storage.updateSchool(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  });
  app.post("/api/admin/schools/:id/publish", requireAuth, async (req, res) => {
    const row = await storage.publishSchool(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  });
  app.delete("/api/admin/schools/:id", requireAuth, async (req, res) => {
    await storage.deleteSchool(Number(req.params.id));
    res.json({ ok: true });
  });

  // Linked stays
  app.post("/api/admin/stays", requireAuth, async (req, res) => {
    const { spotId, ...rest } = req.body || {};
    if (!spotId || !rest.name) return res.status(400).json({ error: "spotId and name required" });
    const created = await storage.createStay({ spotId: Number(spotId), ...rest } as any);
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
    const schools = await storage.listSchools(spot.id, false);
    const stays = await storage.listStays(spot.id, false);
    res.json({
      spot: serializeSpot(spot, true),
      monthly,
      schools,
      stays,
    });
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
          ...restMonthly,
          spotId,
          published: !!restMonthly.published,
          hasDraft: !!restMonthly.hasDraft,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedSnapshot: JSON.stringify(restMonthly),
        } as any);
      }

      await tx.delete(schools).where(eq(schools.spotId, spotId));
      for (const s of importedSchools) {
        const { id: _sid, spotId: _ss, createdAt: _sCreatedAt, updatedAt: _sUpdatedAt, publishedSnapshot: _sSnapshot, ...restSchool } = s as any;
        await tx.insert(schools).values({
          ...restSchool,
          spotId,
          published: !!restSchool.published,
          hasDraft: !!restSchool.hasDraft,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedSnapshot: JSON.stringify(restSchool),
        } as any);
      }

      await tx.delete(stays).where(eq(stays.spotId, spotId));
      for (const s of importedStays) {
        const { id: _sid, spotId: _ss, createdAt: _sCreatedAt, updatedAt: _sUpdatedAt, publishedSnapshot: _sSnapshot, ...restStay } = s as any;
        await tx.insert(stays).values({
          ...restStay,
          spotId,
          published: !!restStay.published,
          hasDraft: !!restStay.hasDraft,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedSnapshot: JSON.stringify(restStay),
        } as any);
      }
    });

    const updatedSpot = await storage.getSpot(spotId);
    const monthly = (await storage.listMonthly(spotId, false)).map(m => serializeMonthly(m, true));
    const schoolsOut = (await storage.listSchools(spotId, false)).map(s => serializeLinked(s, true));
    const staysOut = (await storage.listStays(spotId, false)).map(s => serializeLinked(s, true));
    res.json({ ...serializeSpot(updatedSpot!, true), monthly, schools: schoolsOut, stays: staysOut });
  });

  // Filter defs admin
  app.get("/api/admin/filters", requireAuth, async (_req, res) => {
    const defs = await storage.listFilterDefs(false);
    res.json(defs.map(d => ({ ...d, options: parseArr(d.options) })));
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
