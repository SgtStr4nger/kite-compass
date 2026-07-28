import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import crypto from 'node:crypto';
import { storage } from "./storage";
import { enrichSpotById, MissingCoordinatesError } from "./services/enrichment";
import { insertSpotSchema, insertMonthlySchema } from "@shared/schema";
import type { Spot, MonthlyRecord } from "@shared/schema";

// Fixed Jan→Dec order for compact season strips (server-side; mirrors client MONTHS).
const MONTH_ORDER = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

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
  return {
    ...v,
    spotTypes: parseArr(v.spotTypes),
    riderLevels: parseArr(v.riderLevels),
    vibeTags: parseArr(v.vibeTags),
    beginnerFriendly: !!v.beginnerFriendly,
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
// stringify array fields before writing
function normalizeSpotInput(body: any) {
  const out = { ...body };
  for (const k of ["spotTypes", "riderLevels", "vibeTags"]) {
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

    const month = (req.query.month as string) || null;
    const spotTypes = ([] as string[]).concat(req.query.spotType as any || []);
    const riderLevels = ([] as string[]).concat(req.query.riderLevel as any || []);
    const vibes = ([] as string[]).concat(req.query.vibe as any || []);
    const beginner = req.query.beginner === "1";
    const country = (req.query.country as string) || null;

    let rows = spots.map(s => {
      const rec = month ? monthly.find(m => m.spotId === s.id && m.month === month) : undefined;
      const spotMonthly = monthly.filter(m => m.spotId === s.id);
      const monthsAvail = spotMonthly.map(m => m.month);
      // Compact season strip: 12 entries in fixed Jan→Dec order, each the season
      // label for that month or null when no published record exists. Lets result
      // cards render a season strip without a second request.
      const bySeason = new Map(spotMonthly.map(m => [m.month, m.seasonLabel]));
      const seasonByMonth = MONTH_ORDER.map(mn => bySeason.get(mn) ?? null);
      const score = rec
        ? (s.rankingMode === "auto" ? rec.automaticWindScore : rec.manualScore)
        : null;
      return { ...s, monthRecord: rec || null, score, monthsAvailable: monthsAvail, seasonByMonth };
    });

    if (month) rows = rows.filter(r => r.monthsAvailable.includes(month));
    if (spotTypes.length) rows = rows.filter(r => spotTypes.some(t => r.spotTypes.includes(t)));
    if (riderLevels.length) rows = rows.filter(r => riderLevels.some(t => r.riderLevels.includes(t)));
    if (vibes.length) rows = rows.filter(r => vibes.some(t => r.vibeTags.includes(t)));
    if (beginner) rows = rows.filter(r => r.beginnerFriendly);
    if (country) rows = rows.filter(r => r.country === country);

    rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    res.json(rows);
  });

  // Public single spot by slug with its monthly records.
  app.get("/api/spots/slug/:slug", async (req, res) => {
    const admin = isAuthed(req) && req.query.preview === "1";
    const spot = await storage.getSpotBySlug(req.params.slug);
    if (!spot || (!spot.published && !admin)) return res.status(404).json({ error: "not found" });
    const monthly = (await storage.listMonthly(spot.id, !admin)).map(m => serializeMonthly(m, admin));
    res.json({ ...serializeSpot(spot, admin), monthly });
  });

  // list of distinct countries (for filter)
  app.get("/api/countries", async (_req, res) => {
    const spots = await storage.listSpots(true);
    const set = Array.from(new Set(spots.map(s => s.country).filter(Boolean))).sort();
    res.json(set);
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
    res.json({ ...serializeSpot(spot, true), monthly });
  });

  app.post("/api/admin/spots", requireAuth, async (req, res) => {
    const parsed = insertSpotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    const created = await storage.createSpot(normalizeSpotInput(parsed.data) as any);
    res.json(serializeSpot(created));
  });

  app.patch("/api/admin/spots/:id", requireAuth, async (req, res) => {
    const updated = await storage.updateSpot(Number(req.params.id), normalizeSpotInput(req.body));
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
    res.json(serializeMonthly(updated));
  });
  app.post("/api/admin/monthly/:id/publish", requireAuth, async (req, res) => {
    const m = await storage.publishMonthly(Number(req.params.id));
    if (!m) return res.status(404).json({ error: "not found" });
    res.json(serializeMonthly(m));
  });
  app.delete("/api/admin/monthly/:id", requireAuth, async (req, res) => {
    await storage.deleteMonthly(Number(req.params.id));
    res.json({ ok: true });
  });

  // Filter defs admin
  app.get("/api/admin/filters", requireAuth, async (_req, res) => {
    const defs = await storage.listFilterDefs(false);
    res.json(defs.map(d => ({ ...d, options: parseArr(d.options) })));
  });

  return httpServer;
}
