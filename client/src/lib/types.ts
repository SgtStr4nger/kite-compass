export interface MonthlyRecord {
  id: number;
  spotId: number;
  month: string;
  manualScore: number | null;
  automaticWindScore: number | null;
  averageBaseWind: number | null;
  gusts: number | null;
  windDays: number | null;
  seasonLabel: string; // peak|good|okay|off
  windSourceName: string;
  windSourceUrl: string;
  internalNotes: string;
  published: boolean;
  hasDraft: boolean;
}

export interface Spot {
  id: number;
  slug: string;
  name: string;
  country: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string;
  windyUrl: string;
  windfinderUrl: string;
  destinationSummary: string;
  destinationDescription: string;
  kiteContextDescription: string;
  teaserText: string;
  heroImageUrl: string;
  nearestAirportName: string;
  nearestAirportCode: string;
  airportTransferTime: string;
  transportNote: string;
  beginnerFriendly: boolean;
  spotTypes: string[];
  riderLevels: string[];
  vibeTags: string[];
  internalNotes: string;
  sourceNotes: string;
  rankingMode: string; // manual|auto
  published: boolean;
  hasDraft: boolean;
}

export interface SpotListItem extends Spot {
  monthRecord: MonthlyRecord | null;
  score: number | null;
  monthsAvailable: string[];
}

export interface SpotDetail extends Spot {
  monthly: MonthlyRecord[];
}

export interface AdminSpotListItem extends Spot {
  monthlyCount: number;
}

export interface FilterDef {
  id: number;
  key: string;
  label: string;
  field: string;
  type: string; // multiselect|boolean|select
  options: string[];
  isPublic: boolean;
  sortOrder: number;
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const SEASON_META: Record<string, { label: string; color: string; dot: string }> = {
  peak: { label: "Peak season", color: "text-emerald-800 bg-emerald-100", dot: "bg-emerald-500" },
  good: { label: "Good", color: "text-teal-800 bg-teal-100", dot: "bg-teal-500" },
  okay: { label: "Okay", color: "text-amber-800 bg-amber-100", dot: "bg-amber-500" },
  off: { label: "Off season", color: "text-stone-600 bg-stone-200", dot: "bg-stone-400" },
};

export function tagLabel(t: string): string {
  return t.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
