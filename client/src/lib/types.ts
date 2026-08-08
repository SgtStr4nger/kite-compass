import type { ReactNode } from "react";

export interface MonthlyRecord {
  id: number;
  spotId: number;
  month: string;
  manualScore: number | null;
  automaticWindScore: number | null;
  averageBaseWind: number | null;
  gusts: number | null;
  windDays: number | null;
  seasonLabel: string; // peak|side|off
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
  publishedSlug?: string;
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

export interface PublicSeoState {
  homepageTitle: string;
  homepageDescription: string;
  exploreTitle: string;
  exploreDescription: string;
  methodologyTitle: string;
  methodologyDescription: string;
  updatedAt: string | null;
}

export interface SeoAdminState {
  homepageTitleDraft: string;
  homepageDescriptionDraft: string;
  exploreTitleDraft: string;
  exploreDescriptionDraft: string;
  methodologyTitleDraft: string;
  methodologyDescriptionDraft: string;
  homepageTitlePublished: string;
  homepageDescriptionPublished: string;
  exploreTitlePublished: string;
  exploreDescriptionPublished: string;
  methodologyTitlePublished: string;
  methodologyDescriptionPublished: string;
  hasDraft: boolean;
  publishedAt: string | null;
  updatedAt: string | null;
  canPublish: boolean;
}

export interface ScoringConfig {
  startYear: number;
  endYear: number;
  kiteableDaysWeight: number;
  kiteableHoursWeight: number;
  windStrengthWeight: number;
  gustinessWeight: number;
  kiteableHoursMax: number;
  kiteableDayMinHours: number;
  windMinKnots: number;
  windBestStartKnots: number;
  windBestEndKnots: number;
  windCutoffKnots: number;
  gustMeanWeight: number;
  gustGoodThresholdPct: number;
  gustBadThresholdPct: number;
  seasonPeakThreshold: number;
  seasonSideThreshold: number;
}

export interface ScoringAdminState {
  draft: ScoringConfig;
  published: ScoringConfig;
  hasDraft: boolean;
  publishedAt: string | null;
  updatedAt: string | null;
  canPublish: boolean;
}

export interface ScoringStatus {
  status: "Idle" | "Recalculating scores" | "Scores published" | "Failed";
  totalSpots: number;
  completedSpots: number;
  message: string;
  dismissible: boolean;
  dismissed: boolean;
  updatedAt: string | null;
  active: boolean;
  visible: boolean;
}

export interface WeatherRefreshStatus {
  status: "Idle" | "Refreshing weather data" | "Weather refresh completed" | "Weather refresh failed";
  totalSpots: number;
  completedSpots: number;
  message: string;
  dismissible: boolean;
  dismissed: boolean;
  updatedAt: string | null;
  active: boolean;
  visible: boolean;
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
  spotTypes: string[];
  riderLevels: string[];
  vibeTags: string[];
  internalNotes: string;
  sourceNotes: string;
  seoTitleOverride: string;
  seoDescriptionOverride: string;
  rankingMode: string; // manual|auto
  /** true when the country was set manually (auto-derived from coords otherwise) */
  countryManual?: boolean;
  createdAt?: string;
  updatedAt?: string;
  dataStatus?: "fresh" | "dirty" | "missing";
  dataNeedsRefresh?: boolean;
  published: boolean;
  hasDraft: boolean;
  publishedSlug?: string;
  publishedAt?: string | null;
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

// ── Generic AdminDataTable types (shared by Spots / Kite Schools / Stays) ──

export type ColumnFilterType = "text" | "select" | "boolean" | "multiselect" | "dateRange";

export interface AdminFilterOption {
  value: string;
  label: string;
}

/** Value stored for a single column's filter inside `AdminTableFilters`. */
export type ColumnFilterValue =
  | string
  | boolean
  | string[]
  | { from?: string; to?: string }
  | undefined;

/** Filter state keyed by column `key`. */
export interface AdminTableFilters {
  [key: string]: ColumnFilterValue;
}

export interface AdminTableColumn<T> {
  /** Stable identifier; also the key used in `AdminTableFilters`. */
  key: string;
  header: string;
  sortable?: boolean;
  filterable?: boolean;
  filterType?: ColumnFilterType;
  /** Options for `select` / `boolean` / `multiselect` filters. */
  filterOptions?: AdminFilterOption[];
  width?: string;
  className?: string;
  headerClassName?: string;
  renderCell: (row: T) => ReactNode;
}

export interface AdminDataTableProps<T> {
  columns: AdminTableColumn<T>[];
  rows: T[];
  keyField?: keyof T;
  total: number;
  page: number;
  perPage: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  filters?: AdminTableFilters;
  selectedIds?: Array<string | number>;
  loading?: boolean;
  emptyMessage?: string;
  perPageOptions?: number[];
  /** Rendered above the table (bulk actions, import/export, etc.). */
  toolbar?: ReactNode;
  onSortChange?: (key: string) => void;
  onFilterChange?: (key: string, value: ColumnFilterValue) => void;
  onPageChange?: (page: number) => void;
  onPerPageChange?: (perPage: number) => void;
  onSelect?: (id: string | number, checked: boolean) => void;
  onSelectAll?: (ids: Array<string | number>) => void;
  onRowClick?: (row: T) => void;
}

export type ExcelCategory = "spots" | "schools" | "stays";
export type ExcelImportRowKind = "new" | "update" | "error_id_not_found" | "error_invalid_data";
export type ExcelImportAction = "create_update" | "create_only";

export interface ExcelImportStatus {
  status: string;
  category: ExcelCategory | null;
  runId: number | null;
  message: string;
  active: boolean;
  dismissible: boolean;
  dismissed: boolean;
  visible: boolean;
  updatedAt: string | null;
}

export interface ExcelImportPreviewResponse {
  previewId: string;
  summary: {
    newCount: number;
    updateCount: number;
    errorIdNotFoundCount: number;
    errorInvalidDataCount: number;
  };
  rows: Array<{
    rowNumber: number;
    kind: ExcelImportRowKind;
    internalId: number | null;
    error: string | null;
  }>;
  files: {
    updatesFileName: string;
    updatesFileBase64: string;
    errorsFileName: string;
    errorsFileBase64: string;
  };
}

export interface ExcelImportHistoryItem {
  id: number;
  category: ExcelCategory;
  file_name: string;
  status: string;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  new_count: number;
  update_count: number;
  error_id_not_found_count: number;
  error_invalid_data_count: number;
  start_at: string | null;
  end_at: string | null;
  duration_ms: number | null;
  technical_error: string | null;
  rollback_notice: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TrashItem {
  category: "spots" | "schools" | "stays";
  id: number;
  name: string;
  deletedAt: string;
  daysRemaining: number;
  expiresAt: string;
}

export interface RestoreInfo {
  category: "spots" | "schools" | "stays";
  id: number;
  name: string;
  totalAssignments: number;
  recoverableAssignments: number;
  unrecoverableAssignments: number;
  affectedItems: Array<{ id: number; name: string; recoverable: boolean }>;
}

export interface AdminError {
  id: number;
  area: string;
  recordId: string | null;
  summary: string;
  errorId: string;
  status: "Open" | "Resolved" | "Dismissed";
  createdAt: string;
  updatedAt: string;
}

export interface Redirect {
  id: number;
  fromPath: string;
  toUrl: string;
  targetType: 'spot' | 'manual';
  spotId: number | null;
  spotName: string | null;
  isBroken: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const SEASON_META: Record<string, { label: string; color: string; dot: string }> = {
  peak: { label: "Peak", color: "text-emerald-900 bg-emerald-100", dot: "bg-emerald-600" },
  side: { label: "Mid", color: "text-amber-900 bg-amber-100", dot: "bg-amber-500" },
  off: { label: "Off", color: "text-stone-700 bg-stone-200", dot: "bg-stone-400" },
};

export function tagLabel(t: string): string {
  return t.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
