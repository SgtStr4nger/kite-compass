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
  // Open-Meteo enriched metrics (wind in knots, waves in metres, period in seconds)
  avgKiteableWind10mKnots: number | null;
  kiteableDaysCount: number | null;
  avgKiteableHoursPerDay: number | null;
  avgWaveHeightM: number | null;
  maxWaveHeightM: number | null;
  avgWavePeriodS: number | null;
  dominantWaveDirectionDeg: number | null;
  primaryWindType: string | null;
  secondaryWindType: string | null;
  windSourceName: string;
  windSourceUrl: string;
  internalNotes: string;
  published: boolean;
  hasDraft: boolean;
}

export interface School {
  id: number;
  name: string;
  sports: string[];
  websiteUrl: string;
  mapUrl: string;
  offersRental: boolean;
  offersLessons: boolean;
  shortDescription: string;
  notes: string;
  favorite: boolean;
  published: boolean;
  hasDraft: boolean;
  updatedAt?: string;
  createdAt?: string;
  // only present in global listing admin response
  assignedSpotsCount?: number;
}

export interface Stay {
  id: number;
  name: string;
  type: string;
  websiteUrl: string;
  mapUrl: string;
  shortDescription: string;
  notes: string;
  favorite: boolean;
  published: boolean;
  hasDraft: boolean;
  updatedAt?: string;
  createdAt?: string;
  // only present in global listing admin response
  assignedSpotsCount?: number;
}

export interface SitePage {
  id: number;
  slug: string;
  title: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LegalPageConfig {
  title: string;
  seoTitle: string;
  seoDescription: string;
}

export interface LegalAdminState {
  privacyPolicyDraft: string;
  legalNoticeDraft: string;
  privacyPolicyPublished: string;
  legalNoticePublished: string;
  hasDraft: boolean;
  publishedAt: string | null;
  updatedAt: string | null;
  canPublish: boolean;
  privacyPolicy: LegalPageConfig;
  legalNotice: LegalPageConfig;
}

export interface AdminUser {
  id: number;
  email: string;
  role: "main" | "standard";
  isActive: boolean;
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  temporaryLockUntil: string | null;
  isFullyLocked: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Spot {
  id: number;
  publicId: string;
  slug: string;
  name: string;
  country: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  dataSource?: string;
  dataLastRefreshedAt?: string | null;
  dataQualityNote?: string;
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
  waterStates: string[];
  internalNotes: string;
  sourceNotes: string;
  rankingMode: string; // manual|auto
  createdAt?: string;
  updatedAt?: string;
  dataStatus?: "fresh" | "dirty" | "missing";
  dataNeedsRefresh?: boolean;
  published: boolean;
  hasDraft: boolean;
}

export interface SpotListItem extends Spot {
  monthRecord: MonthlyRecord | null;
  score: number | null;
  monthsAvailable: string[];
  /** 12 entries in fixed Jan→Dec order (see MONTHS); season label per month or null. */
  seasonByMonth: (string | null)[];
}

export interface SpotDetail extends Spot {
  monthly: MonthlyRecord[];
  schools: School[];
  stays: Stay[];
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

export const SCHOOL_SPORTS = ["Kitesurfing", "Wingfoiling", "Kitefoiling", "Surfing"] as const;
export const STAY_TYPES = ["Hotel", "Hostel", "Apartment", "Guesthouse", "Resort"] as const;

export interface ListingsPage<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const SEASON_META: Record<string, { label: string; color: string; dot: string }> = {
  peak: { label: "Peak", color: "text-emerald-900 bg-emerald-100", dot: "bg-emerald-600" },
  side: { label: "Side", color: "text-sky-900 bg-sky-100", dot: "bg-sky-500" },
  off: { label: "Off", color: "text-stone-700 bg-stone-200", dot: "bg-stone-400" },
};

export function tagLabel(t: string): string {
  return t.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
