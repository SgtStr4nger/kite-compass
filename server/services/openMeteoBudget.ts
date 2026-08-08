/**
 * Open-Meteo billing-aware budget limiter
 * ------------------------------------------------------------------
 * Open-Meteo's free/non-commercial tier is metered by WEIGHTED "API calls",
 * not raw request counts. The published formula is:
 *
 *     weight = nLocations × (nDays / 14) × (nVariables / 10)
 *
 * Published limits: 600/minute, 5,000/hour, 10,000/day.
 *
 * This module is the single source of truth for pacing EVERY enrichment path
 * (CLI, admin batch, per-spot button, scoring re-enrich). State is in-memory
 * per process, mirroring `openMeteoStats` in openMeteo.ts — no storage
 * dependency. The admin dashboard reads current usage + wait state from here.
 *
 * A request is recorded only when Open-Meteo actually accepts it (HTTP 2xx);
 * 429/5xx responses do not consume billable quota, so they are not counted
 * against the meters (they do still surface through openMeteoStats.failed).
 */

export const OPEN_METEO_WEIGHT_LIMITS = { minute: 600, hour: 5_000, day: 10_000 } as const;
const NORMALIZE_DAYS = 14;
const NORMALIZE_VARS = 10;

// Historical window — mirrors server/services/openMeteo.ts (keep in sync).
const HISTORY_START_YEAR = 2015;
const HISTORY_END_YEAR = 2024;
const WINDOW_START = `${HISTORY_START_YEAR}-01-01`;
const WINDOW_END = `${HISTORY_END_YEAR}-12-31`;

// The two real URL shapes used by enrichCoordinate() in openMeteo.ts.
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const ARCHIVE_VARIABLES = ["wind_speed_10m", "sunrise", "sunset"];
const MARINE_VARIABLES = ["wave_height_max", "wave_period_max", "wave_direction_dominant"];

type WindowKey = keyof typeof OPEN_METEO_WEIGHT_LIMITS;
const WINDOW_MS: Record<WindowKey, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };
const WINDOW_KEYS: WindowKey[] = ["minute", "hour", "day"];

// ── Weight computation ──────────────────────────────────────────────────────

function paramsOf(url: string): URLSearchParams {
  return new URLSearchParams((url.split("?")[1] ?? "").toString());
}

/** Inclusive day count of an Open-Meteo URL's start_date/end_date window. */
function daysInWindow(url: string): number {
  const sp = paramsOf(url);
  const s = sp.get("start_date");
  const e = sp.get("end_date");
  if (s && e && /^\d{4}-\d{2}-\d{2}$/.test(s) && /^\d{4}-\d{2}-\d{2}$/.test(e)) {
    const days = (Date.parse(`${e}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / 86_400_000 + 1;
    if (Number.isFinite(days) && days > 0) return Math.round(days);
  }
  return Math.round((Date.parse(`${WINDOW_END}T00:00:00Z`) - Date.parse(`${WINDOW_START}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Number of variables requested by a URL (hourly= + daily= + current=). */
function variableCount(url: string): number {
  const sp = paramsOf(url);
  let count = 0;
  for (const key of ["hourly", "daily", "current"]) {
    const val = sp.get(key);
    if (val) count += val.split(",").filter(Boolean).length;
  }
  return count || 1;
}

/** Weighted API-call cost of a single request URL (nLocations = 1). */
export function requestWeight(url: string): number {
  return (daysInWindow(url) / NORMALIZE_DAYS) * (variableCount(url) / NORMALIZE_VARS);
}

/** Weighted cost of a single full spot enrichment (archive + marine). */
export function perSpotCost(): {
  nDays: number;
  archive: { weight: number; variables: number };
  marine: { weight: number; variables: number };
  total: number;
} {
  const archiveUrl = `${ARCHIVE_URL}?start_date=${WINDOW_START}&end_date=${WINDOW_END}&hourly=${ARCHIVE_VARIABLES[0]}&daily=${ARCHIVE_VARIABLES.slice(1).join(",")}`;
  const marineUrl = `${MARINE_URL}?start_date=${WINDOW_START}&end_date=${WINDOW_END}&daily=${MARINE_VARIABLES.join(",")}`;
  const nDays = daysInWindow(archiveUrl);
  const archive = { weight: requestWeight(archiveUrl), variables: ARCHIVE_VARIABLES.length };
  const marine = { weight: requestWeight(marineUrl), variables: MARINE_VARIABLES.length };
  return { nDays, archive, marine, total: archive.weight + marine.weight };
}

// ── Rolling budget tracker ──────────────────────────────────────────────────

interface WeightRecord { t: number; weight: number; }
const records: WeightRecord[] = [];
/** Windows forced to count as exhausted until the given epoch-aligned rollover. */
const overrides = new Map<WindowKey, number>();

/** End of the current epoch-aligned window bucket (rolling-window approximation). */
const bucketEnd = (window: WindowKey, now: number) => Math.ceil(now / WINDOW_MS[window]) * WINDOW_MS[window];

function prune(now: number) {
  const cutoff = now - WINDOW_MS.day;
  while (records.length && records[0].t < cutoff) records.shift();
}

function usageForWindow(window: WindowKey, now: number): { used: number; limit: number; resetsAt: number } {
  const limit = OPEN_METEO_WEIGHT_LIMITS[window];
  const cutoff = now - WINDOW_MS[window];
  let used = 0;
  for (const r of records) if (r.t >= cutoff) used += r.weight;
  const overrideUntil = overrides.get(window) ?? 0;
  if (overrideUntil > now) used = Math.max(used, limit); // count as full until rollover
  return { used, limit, resetsAt: bucketEnd(window, now) };
}

/** Record an accepted (billable) request so it counts against the window meters. */
export function recordRequest(url: string, status: number): void {
  if (status < 200 || status >= 300) return; // only billable responses consume quota
  const now = Date.now();
  records.push({ t: now, weight: requestWeight(url) });
  prune(now);
}

/** Force the current minute/hour/day windows to count as exhausted until they roll over. */
export function markWindowFull(): void {
  const now = Date.now();
  for (const w of WINDOW_KEYS) overrides.set(w, bucketEnd(w, now));
}

/** Current weighted consumption per window, plus the limits and rollover time. */
export function currentUsage(): Record<WindowKey, { used: number; limit: number; resetsAt: number }> {
  const now = Date.now();
  prune(now);
  return {
    minute: usageForWindow("minute", now),
    hour: usageForWindow("hour", now),
    day: usageForWindow("day", now),
  };
}

// ── Wait state + listener (for the admin dashboard / status banner) ─────────

export interface WaitInfo {
  window: WindowKey;
  waitMs: number;
  resumesAt: string; // ISO timestamp
}

export interface BudgetWaitState {
  active: boolean;
  window?: WindowKey;
  waitMs?: number;
  resumesAt?: string;
}

type WaitListener = (info: WaitInfo | null) => void;

let waitState: BudgetWaitState = { active: false };
let waitListener: WaitListener | null = null;
let lastListenerAt = 0;

/** Register a callback fired when a long wait begins (info) or ends (null). Throttled internally. */
export function setBudgetWaitListener(fn: WaitListener | null): void {
  waitListener = fn;
}

export function getWaitState(): BudgetWaitState {
  return waitState;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * If adding `requestWeight(url)` would exceed any window limit, sleep until the
 * latest-ending blocking window rolls over and return the reason (for the UI).
 * Returns null when the request can proceed immediately.
 */
export async function waitForBudget(url: string): Promise<WaitInfo | null> {
  const weight = requestWeight(url);
  const now = Date.now();
  let blocking: WindowKey | null = null;
  let resetsAt = 0;
  for (const w of WINDOW_KEYS) {
    const info = usageForWindow(w, now);
    if (info.used + weight > info.limit && info.resetsAt > resetsAt) {
      resetsAt = info.resetsAt;
      blocking = w;
    }
  }
  if (!blocking) return null;

  const waitMs = Math.max(0, resetsAt - now) + 1000; // small buffer past rollover
  const info: WaitInfo = { window: blocking, waitMs, resumesAt: new Date(resetsAt).toISOString() };

  waitState = { active: true, window: blocking, waitMs, resumesAt: info.resumesAt };
  if (waitListener && waitMs > 5000) {
    const t = Date.now();
    if (t - lastListenerAt >= 10_000) {
      lastListenerAt = t;
      waitListener(info);
    }
  }
  await sleep(waitMs);
  waitState = { active: false };
  if (waitListener) waitListener(null);
  return info;
}

// ── Aggregate view used by openMeteo.ts to build the extended stats payload ─

export interface OpenMeteoBudgetView {
  perSpotCost: ReturnType<typeof perSpotCost>;
  limits: typeof OPEN_METEO_WEIGHT_LIMITS;
  usage: ReturnType<typeof currentUsage>;
  waitState: BudgetWaitState;
  pacing: {
    mode: "auto-budget";
    effectiveSpotsPerMinute: number;
    effectiveSpotsPerHour: number;
    effectiveSpotsPerDay: number;
  };
}

export function getOpenMeteoBudget(): OpenMeteoBudgetView {
  const cost = perSpotCost();
  return {
    perSpotCost: cost,
    limits: OPEN_METEO_WEIGHT_LIMITS,
    usage: currentUsage(),
    waitState,
    pacing: {
      mode: "auto-budget",
      effectiveSpotsPerMinute: OPEN_METEO_WEIGHT_LIMITS.minute / cost.total,
      effectiveSpotsPerHour: OPEN_METEO_WEIGHT_LIMITS.hour / cost.total,
      effectiveSpotsPerDay: OPEN_METEO_WEIGHT_LIMITS.day / cost.total,
    },
  };
}
