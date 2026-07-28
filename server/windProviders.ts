/**
 * Wind-provider abstraction.
 *
 * Kite Compass ranks spots on a curated MANUAL score today. A future
 * "automatic" ranking mode will derive a score from real wind data pulled
 * from external providers (Windy, Windfinder, …).
 *
 * Per the current scope we DO NOT make any real network calls. This module
 * only defines the abstraction — a stable interface plus a provider registry —
 * so that wiring a real API later is a localized change (implement `fetchMonthly`
 * for a provider and register it) that does not ripple through the codebase.
 *
 * How the pieces connect:
 *   - Each monthly record already stores `windSourceName` / `windSourceUrl`
 *     (attribution) and `automaticWindScore` (currently null).
 *   - Spots store `windyUrl` / `windfinderUrl` for the public "check the live
 *     forecast" buttons — those are plain outbound links, not API integrations.
 *   - When automatic ranking is enabled, a scheduled job would call
 *     `getProvider(name).fetchMonthly(...)` and write `automaticWindScore`.
 */

export interface WindObservation {
  /** Average baseline wind for the month, in knots. */
  averageBaseWind: number | null;
  /** Typical gust strength, in knots. */
  gusts: number | null;
  /** Rideable days in the month. */
  windDays: number | null;
  /** Provider attribution. */
  sourceName: string;
  sourceUrl: string;
}

export interface WindProvider {
  /** Stable identifier used in the provider registry and admin UI. */
  readonly name: string;
  /** Human-readable label. */
  readonly label: string;
  /**
   * Fetch monthly wind stats for a coordinate. NOT IMPLEMENTED yet — real
   * network integration is intentionally out of scope for this version.
   */
  fetchMonthly(params: {
    latitude: number;
    longitude: number;
    month: string; // e.g. "July"
  }): Promise<WindObservation>;
}

/** Shared behaviour for the not-yet-implemented providers. */
abstract class StubProvider implements WindProvider {
  abstract readonly name: string;
  abstract readonly label: string;
  async fetchMonthly(): Promise<WindObservation> {
    throw new Error(
      `${this.label} integration is not implemented in this version. ` +
        `Automatic wind scoring is planned; only the abstraction exists today.`,
    );
  }
}

class WindyProvider extends StubProvider {
  readonly name = "windy";
  readonly label = "Windy";
}

class WindfinderProvider extends StubProvider {
  readonly name = "windfinder";
  readonly label = "Windfinder";
}

const registry: Record<string, WindProvider> = {
  windy: new WindyProvider(),
  windfinder: new WindfinderProvider(),
};

/** List available providers (for admin UI / configuration). */
export function listProviders(): WindProvider[] {
  return Object.values(registry);
}

/** Look up a provider by name. Throws if unknown. */
export function getProvider(name: string): WindProvider {
  const p = registry[name];
  if (!p) throw new Error(`Unknown wind provider: ${name}`);
  return p;
}

/**
 * Placeholder for the future automatic score. Given monthly observations this
 * would compute a 0–10 score. Kept pure and dependency-free so it is trivial to
 * unit test once real inputs exist. Returns null today (manual mode only).
 */
export function computeAutomaticScore(_obs: WindObservation): number | null {
  return null;
}
