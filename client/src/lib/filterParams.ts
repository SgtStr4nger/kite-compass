import { FilterState, emptyFilters } from "@/components/Filters";
import { EXPLORE_CONTINENTS, type ExploreContinent } from "@shared/locations";

// Build the query string for /api/spots and for the results URL.
export function filtersToParams(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.query) p.set("q", f.query);
  (f.months ?? []).forEach(v => p.append("month", v));
  (f.continents ?? []).forEach(v => p.append("continent", v));
  (f.countries ?? []).forEach(v => p.append("country", v));
  (f.spotType ?? []).forEach(v => p.append("spotType", v));
  (f.riderLevel ?? []).forEach(v => p.append("riderLevel", v));
  (f.vibe ?? []).forEach(v => p.append("vibe", v));
  if (f.windMin != null) p.set("windMin", String(f.windMin));
  if (f.windMax != null) p.set("windMax", String(f.windMax));
  return p;
}

export function paramsToFilters(search: string): FilterState {
  const p = new URLSearchParams(search);
  const windMinStr = p.get("windMin");
  const windMaxStr = p.get("windMax");
  const continentValues = new Set<string>(EXPLORE_CONTINENTS);
  return {
    ...emptyFilters,
    query: p.get("q") || "",
    months: p.getAll("month"),
    continents: p.getAll("continent").filter((value): value is ExploreContinent => continentValues.has(value)),
    countries: p.getAll("country"),
    spotType: p.getAll("spotType"),
    riderLevel: p.getAll("riderLevel"),
    vibe: p.getAll("vibe"),
    windMin: windMinStr != null ? Number(windMinStr) : null,
    windMax: windMaxStr != null ? Number(windMaxStr) : null,
  };
}

// wouter hash-location aware: read the query part of the hash.
export function getHashSearch(): string {
  const h = window.location.hash; // like #/results?month=July
  const i = h.indexOf("?");
  return i >= 0 ? h.slice(i) : "";
}
