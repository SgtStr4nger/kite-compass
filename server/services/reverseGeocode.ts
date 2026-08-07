/**
 * Country reverse-geocoding service
 * ------------------------------------------------------------------
 * Resolves the country for a spot's coordinates via Nominatim (OpenStreetMap).
 *
 * Provider: Nominatim / OpenStreetMap — https://nominatim.openstreetmap.org/
 *   • Free public service; no API key required.
 *   • MUST send an identifying User-Agent header (set below).
 *   • MUST NOT exceed 1 request per second (enforced by waitForRequestSlot).
 *   • Attribution is required: the site footer shows "© OpenStreetMap
 *     contributors" linking to https://www.openstreetmap.org/copyright
 *     (see client/src/components/SiteChrome.tsx).
 *
 * Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 *   • Volume is tiny — lookups run only on admin spot saves, never in the
 *     public request path — so the shared 1 req/s throttle is trivially
 *     compliant.
 *   • No API key or secret is stored anywhere; nothing is added to .env.
 *
 * Errors are split so callers can distinguish:
 *   • `null`            → the lookup succeeded but no country resolved
 *                         (e.g. mid-ocean coordinates).
 *   • ReverseGeocodeError → network/HTTP/timeout failure (upstream problem).
 */

import { ISO2_TO_COUNTRY } from "@shared/locations";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const REQUEST_TIMEOUT_MS = 10_000;
/** Nominatim usage policy: max 1 request/second. */
const MIN_REQUEST_GAP_MS = 1100;
const USER_AGENT = "KiteCompass/1.0 (https://github.com/SgtStr4nger/kite-compass)";

let lastRequestAt = 0;

async function waitForRequestSlot(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, lastRequestAt + MIN_REQUEST_GAP_MS - now);
  if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
  lastRequestAt = Date.now();
}

export class ReverseGeocodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReverseGeocodeError";
  }
}

export interface ReverseGeocodeResult {
  /** Uppercase ISO-2 country code (e.g. "GR"). */
  code: string;
  /** English country display name. */
  name: string;
}

/**
 * Resolve the country for a coordinate pair.
 * Returns `{ code, name }` on success, `null` when the lookup succeeds but no
 * country can be resolved (mid-ocean), and throws `ReverseGeocodeError` on
 * network/HTTP/timeout failures so callers can distinguish the two.
 */
export async function reverseGeocodeCountry(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeResult | null> {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "3",            // country resolution only (no street-level detail)
    "accept-language": "en",
  });
  const url = `${NOMINATIM_URL}?${params.toString()}`;

  await waitForRequestSlot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
  } catch (e: any) {
    throw new ReverseGeocodeError(
      `Nominatim request failed: ${e?.name === "AbortError" ? "timeout" : (e?.message ?? "network error")}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new ReverseGeocodeError(`Nominatim HTTP ${res.status}: ${res.statusText}`);
  }

  const data = await res.json().catch(() => null);
  const rawCode = data?.address?.country_code;
  if (typeof rawCode !== "string" || !/^[a-zA-Z]{2}$/.test(rawCode)) return null;

  const code = rawCode.toUpperCase();
  const name = ISO2_TO_COUNTRY[code] ?? data?.address?.country ?? code;
  return { code, name };
}
