import { FilterState, emptyFilters } from "@/components/Filters";

// Build the query string for /api/spots and for the results URL.
export function filtersToParams(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.month) p.set("month", f.month);
  f.spotType.forEach(v => p.append("spotType", v));
  f.riderLevel.forEach(v => p.append("riderLevel", v));
  f.vibe.forEach(v => p.append("vibe", v));
  if (f.beginner) p.set("beginner", "1");
  if (f.country) p.set("country", f.country);
  return p;
}

export function paramsToFilters(search: string): FilterState {
  const p = new URLSearchParams(search);
  return {
    ...emptyFilters,
    month: p.get("month"),
    spotType: p.getAll("spotType"),
    riderLevel: p.getAll("riderLevel"),
    vibe: p.getAll("vibe"),
    beginner: p.get("beginner") === "1",
    country: p.get("country"),
  };
}

// wouter hash-location aware: read the query part of the hash.
export function getHashSearch(): string {
  const h = window.location.hash; // like #/results?month=July
  const i = h.indexOf("?");
  return i >= 0 ? h.slice(i) : "";
}
