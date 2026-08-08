/**
 * AI content enrichment service (spec #74)
 * ------------------------------------------------------------------
 * Generates draft spot copy via the DeepSeek V4 Flash chat-completions API
 * (OpenAI-SDK-compatible, JSON-mode output). The AI only ever fills EMPTY text
 * fields / enum tags; existing content is never overwritten, and results are
 * written as drafts (via storage.updateSpot → hasDraft: true) for review before
 * publish.
 *
 * No external SDK — Node's global fetch is sufficient, so no new dependency and
 * no build externals entry is needed (the dead `openai` allowlist entry is
 * removed from script/build.ts).
 */

import { z } from "zod";
import { storage } from "../storage";
import type { Spot } from "@shared/schema";

// ── Configuration (provider connection comes from ai_settings; these are defaults) ──
export const AI_DEFAULT_MODEL = "deepseek-v4-flash";
export const AI_DEFAULT_BASE_URL = "https://api.deepseek.com";
const AI_TIMEOUT_MS = 60_000;
const AI_TEMPERATURE = 0.8;
const AI_MAX_TOKENS = 2000;
/** Politeness floor between sequential requests to the provider. */
const AI_REQUEST_GAP_MS = 300;
let lastRequestAt = 0;

// Enum value sets. These mirror the canonical sets in server/routes.ts (SPOT_TYPES /
// RIDER_LEVELS / VIBE_TAGS). Kept in sync manually — see the routes.ts copies.
export const SPOT_TYPES = ["flat-water", "chop", "waves", "lagoon", "foil", "freestyle"] as const;
export const RIDER_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const VIBE_TAGS = ["city", "town", "village", "remote", "touristy", "local-scene", "family-friendly", "nightlife"] as const;

/** The 8 target keys the AI may write (all optional spot columns). */
export const AI_FILLABLE_FIELDS = [
  "destinationSummary",
  "destinationDescription",
  "kiteContextDescription",
  "teaserText",
  "transportNote",
  "spotTypes",
  "riderLevels",
  "vibeTags",
] as const;
export type AiFillableField = (typeof AI_FILLABLE_FIELDS)[number];

/** All 8 keys required in the AI response so partial JSON counts as a failure. */
export const aiSpotContentSchema = z.object({
  destinationSummary: z.string(),
  destinationDescription: z.string(),
  kiteContextDescription: z.string(),
  teaserText: z.string(),
  transportNote: z.string(),
  spotTypes: z.array(z.enum(SPOT_TYPES)),
  riderLevels: z.array(z.enum(RIDER_LEVELS)),
  vibeTags: z.array(z.enum(VIBE_TAGS)),
});
export type AiSpotContent = z.infer<typeof aiSpotContentSchema>;

export class AiNotConfiguredError extends Error {}
export class AiProviderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AiProviderError";
  }
}

/** Array fields arrive as JSON text from the DB row — parse before checking. */
function parseArrField(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") {
    try {
      const a = JSON.parse(value);
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Whether a fillable field is considered empty (string: whitespace-only;
 * array: empty / missing). Reads from the raw DB row, so arrays are parsed.
 */
export function isFieldEmpty(spot: Spot, key: AiFillableField): boolean {
  const value = (spot as any)[key];
  if (key === "spotTypes" || key === "riderLevels" || key === "vibeTags") {
    return parseArrField(value).length === 0;
  }
  return typeof value !== "string" || value.trim().length === 0;
}

/** Current non-empty values of the fillable fields (context for the AI, tone only). */
function currentFillableValues(spot: Spot): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of AI_FILLABLE_FIELDS) {
    const value = (spot as any)[key];
    if (!isFieldEmpty(spot, key)) {
      out[key] = key === "spotTypes" || key === "riderLevels" || key === "vibeTags"
        ? parseArrField(value).join(", ")
        : String(value);
    }
  }
  return out;
}

async function waitForRequestSlot(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, lastRequestAt + AI_REQUEST_GAP_MS - now);
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
  lastRequestAt = Date.now();
}

/**
 * Call DeepSeek (OpenAI-compatible) and return the validated JSON content.
 * Throws AiNotConfiguredError (no key), AiProviderError (HTTP/parse/zod failure).
 */
export async function generateSpotContent(spot: Spot): Promise<AiSpotContent> {
  const settings = await storage.getAiSettings();
  if (!settings.apiKey || !settings.apiKey.trim()) {
    throw new AiNotConfiguredError("AI provider not configured");
  }

  const model = settings.model?.trim() || AI_DEFAULT_MODEL;
  const baseUrl = (settings.baseUrl?.trim() || AI_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const known = {
    name: spot.name || "",
    country: spot.country || "",
    region: spot.region || "",
    latitude: spot.latitude ?? null,
    longitude: spot.longitude ?? null,
  };
  const current = currentFillableValues(spot);

  const system = [
    "You are a professional kitesurf travel writer for Kite Compass, a destination ranking website.",
    "Write concise, factual, kite-travel-oriented copy in English based only on the spot facts provided.",
    "Never invent factual claims about wind, weather, or geography beyond what is given.",
    "destinationDescription should be 3-5 sentences; destinationSummary and teaserText should each be 1-2 sentences.",
    "spotTypes, riderLevels and vibeTags must use ONLY the exact enum values listed. Return them as JSON arrays.",
    "Respond with ONLY a single JSON object (no markdown, no commentary) containing all 8 keys.",
  ].join("\n");

  const user = [
    `Spot facts:`,
    `- Name: ${known.name || "unknown"}`,
    known.country ? `- Country: ${known.country}` : null,
    known.region ? `- Region: ${known.region}` : null,
    known.latitude != null && known.longitude != null ? `- Coordinates: ${known.latitude}, ${known.longitude}` : null,
    ``,
    `Allowed enum values:`,
    `- spotTypes: ${SPOT_TYPES.join(" | ")}`,
    `- riderLevels: ${RIDER_LEVELS.join(" | ")}`,
    `- vibeTags: ${VIBE_TAGS.join(" | ")}`,
    ``,
    Object.keys(current).length
      ? `Existing content (context only — do not repeat it verbatim or change it; only provide values for the EMPTY fields):\n${JSON.stringify(current, null, 2)}`
      : `All fillable fields are currently empty — generate fresh content for all of them.`,
    ``,
    `Write the 8 fields as a single JSON object. Use exactly this shape: {"destinationSummary":"...","destinationDescription":"...","kiteContextDescription":"...","teaserText":"...","transportNote":"...","spotTypes":["..."],"riderLevels":["..."],"vibeTags":["..."]}`,
  ].filter((line): line is string => line !== null).join("\n");

  await waitForRequestSlot();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: AI_TEMPERATURE,
        max_tokens: AI_MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new AiProviderError(502, `AI request failed: ${e?.message ?? "unknown"}`);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new AiProviderError(response.status, `AI provider returned ${response.status}: ${bodyText.slice(0, 300)}`);
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new AiProviderError(422, "Invalid AI response: not JSON");
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new AiProviderError(422, "Invalid AI response: no message content");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiProviderError(422, "Invalid AI response: content is not valid JSON");
  }
  const result = aiSpotContentSchema.safeParse(parsed);
  if (!result.success) {
    throw new AiProviderError(422, "Invalid AI response: schema validation failed");
  }
  return result.data;
}

/**
 * Enrich one spot: call the AI, then server-side merge — write a field only if it
 * was empty (and validates for enum keys). Persists via updateSpot (draft only).
 * Returns which fields were written/skipped. Does NOT call the API when no field
 * is empty.
 */
export async function enrichOneSpot(spot: Spot): Promise<{ writtenFields: string[]; skippedFields: string[] }> {
  const writtenFields: string[] = [];
  const skippedFields: string[] = [];

  for (const key of AI_FILLABLE_FIELDS) {
    if (isFieldEmpty(spot, key)) writtenFields.push(key);
    else skippedFields.push(key);
  }
  // Nothing to fill → skip the API call entirely.
  if (!writtenFields.length) return { writtenFields: [], skippedFields };

  const content = await generateSpotContent(spot);

  const patch: Record<string, unknown> = {};
  for (const key of AI_FILLABLE_FIELDS) {
    if (!isFieldEmpty(spot, key)) continue; // never overwrite
    const value = (content as any)[key];
    if (value === undefined) {
      skippedFields.push(key);
      continue;
    }
    if (key === "spotTypes" || key === "riderLevels" || key === "vibeTags") {
      patch[key] = JSON.stringify(value);
    } else {
      patch[key] = String(value).trim();
    }
    writtenFields.push(key);
  }

  await storage.updateSpot(spot.id, patch as any);
  return { writtenFields, skippedFields };
}
