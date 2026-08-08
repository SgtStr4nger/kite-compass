// Shared spot draft/publish + data-freshness status helpers.
// Used by the admin API (server routes + storage) so filtering/ranking and
// serialization agree on the same status values.

export type DataStatus = "fresh" | "dirty" | "missing";
// Spec §20.1 content status
export type ContentStatus = "unpublished" | "published" | "published-draft";

export function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Data-freshness status: "missing" when never refreshed, "dirty" when the spot
 * was edited after the last refresh, otherwise "fresh".
 */
export function spotDataStatus(spot: {
  dataLastRefreshedAt?: string | null;
  updatedAt?: string | null;
}): DataStatus {
  if (!spot.dataLastRefreshedAt) return "missing";
  const refreshedAt = parseIsoMs(spot.dataLastRefreshedAt);
  const updatedAt = parseIsoMs(spot.updatedAt);
  if (refreshedAt == null) return "missing";
  if (updatedAt != null && updatedAt > refreshedAt) return "dirty";
  return "fresh";
}

/** Spec §20.1 content status derived from published + hasDraft flags. */
export function computeContentStatus(spot: {
  published?: boolean | null;
  hasDraft?: boolean | null;
}): ContentStatus {
  if (!spot.published) return "unpublished";
  if (spot.hasDraft) return "published-draft";
  return "published";
}
