export type RankingMode = "manual" | "auto";
export type SeasonLabel = "peak" | "side" | "off";
export interface ScoringConfig {
  startYear: number;
  endYear: number;
  kiteableDaysWeight: number;
  kiteableHoursWeight: number;
  windStrengthWeight: number;
  gustinessWeight: number;
  kiteableHoursMax: number;
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

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  startYear: 2015,
  endYear: 2024,
  kiteableDaysWeight: 0.45,
  kiteableHoursWeight: 0.25,
  windStrengthWeight: 0.2,
  gustinessWeight: 0.1,
  kiteableHoursMax: 6,
  windMinKnots: 15,
  windBestStartKnots: 22,
  windBestEndKnots: 35,
  windCutoffKnots: 50,
  gustMeanWeight: 0.7,
  gustGoodThresholdPct: 25,
  gustBadThresholdPct: 125,
  seasonPeakThreshold: 0.8,
  seasonSideThreshold: 0.5,
};

export interface MonthlyScoreInput {
  month?: string | null;
  manualScore?: number | null;
  automaticWindScore?: number | null;
  avgKiteableWind10mKnots?: number | null;
  averageBaseWind?: number | null;
  kiteableDaysCount?: number | null;
  windDays?: number | null;
  avgKiteableHoursPerDay?: number | null;
  gustLoadMeanPct?: number | null;
  gustLoadP90Pct?: number | null;
}

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function monthIndexFromName(month?: string | null): number | null {
  if (!month) return null;
  return MONTH_INDEX[month.trim().toLowerCase()] ?? null;
}

function daysInMonthForYear(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function averageDaysInMonth(monthIndex: number, startYear: number, endYear: number): number {
  let totalDays = 0;
  let yearCount = 0;
  for (let year = startYear; year <= endYear; year++) {
    totalDays += daysInMonthForYear(year, monthIndex);
    yearCount++;
  }
  return yearCount > 0 ? totalDays / yearCount : 30.4375;
}

function scoreKiteableDays(days: number, monthIndex: number, cfg: ScoringConfig): number {
  const avgDays = averageDaysInMonth(monthIndex, cfg.startYear, cfg.endYear);
  if (avgDays <= 0) return 0;
  return clamp((days / avgDays) * 10, 0, 10);
}

function scoreKiteableHours(hours: number, cfg: ScoringConfig): number {
  if (cfg.kiteableHoursMax <= 0) return 0;
  return clamp((hours / cfg.kiteableHoursMax) * 10, 0, 10);
}

function scoreWindStrength(windKnots: number, cfg: ScoringConfig): number {
  if (windKnots <= cfg.windMinKnots) return 0;
  if (windKnots < cfg.windBestStartKnots) {
    const progress = (windKnots - cfg.windMinKnots) / (cfg.windBestStartKnots - cfg.windMinKnots);
    return clamp(progress * 10, 0, 10);
  }
  if (windKnots <= cfg.windBestEndKnots) return 10;
  if (windKnots >= cfg.windCutoffKnots) return 0;
  const progress = (windKnots - cfg.windBestEndKnots) / (cfg.windCutoffKnots - cfg.windBestEndKnots);
  return clamp((1 - progress) * 10, 0, 10);
}

function scoreGustiness(meanPct: number | null, p90Pct: number | null, cfg: ScoringConfig): number | null {
  if (meanPct == null || p90Pct == null) return null;
  const evaluated = cfg.gustMeanWeight * meanPct + (1 - cfg.gustMeanWeight) * p90Pct;
  if (evaluated <= cfg.gustGoodThresholdPct) return 10;
  if (evaluated >= cfg.gustBadThresholdPct) return 0;
  const progress = (evaluated - cfg.gustGoodThresholdPct) / (cfg.gustBadThresholdPct - cfg.gustGoodThresholdPct);
  return clamp((1 - progress) * 10, 0, 10);
}

export function calculateAutoMonthlyScore(row: MonthlyScoreInput, config: Partial<ScoringConfig> = {}): number | null {
  const cfg: ScoringConfig = { ...DEFAULT_SCORING_CONFIG, ...config };
  const wind = toFiniteNumber(row.avgKiteableWind10mKnots ?? row.averageBaseWind);
  const days = toFiniteNumber(row.kiteableDaysCount ?? row.windDays);
  const hours = toFiniteNumber(row.avgKiteableHoursPerDay);

  if (days === 0) return 0;
  if (wind == null || days == null || hours == null) return null;

  const monthIndex = monthIndexFromName(row.month) ?? 0;
  const componentScores: Array<{ score: number; weight: number }> = [
    { score: scoreKiteableDays(days, monthIndex, cfg), weight: cfg.kiteableDaysWeight },
    { score: scoreKiteableHours(hours, cfg), weight: cfg.kiteableHoursWeight },
    { score: scoreWindStrength(wind, cfg), weight: cfg.windStrengthWeight },
  ];

  const gustiness = scoreGustiness(toFiniteNumber(row.gustLoadMeanPct), toFiniteNumber(row.gustLoadP90Pct), cfg);
  if (gustiness != null) {
    componentScores.push({ score: gustiness, weight: cfg.gustinessWeight });
  }

  const totalWeight = componentScores.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight <= 0) return null;
  const weightedScore = componentScores.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight;
  return round1(weightedScore);
}

export function resolveMonthlyScore(row: MonthlyScoreInput, rankingModeRaw?: string | null): number | null {
  const rankingMode: RankingMode = rankingModeRaw === "manual" ? "manual" : "auto";
  if (rankingMode === "manual") {
    return toFiniteNumber(row.manualScore);
  }
  const stored = toFiniteNumber(row.automaticWindScore);
  return stored != null ? stored : calculateAutoMonthlyScore(row);
}

export function bestEvaluableScore(scores: Array<number | null | undefined>): number | null {
  const evaluableScores = scores.filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  if (!evaluableScores.length) return null;
  return Math.max(...evaluableScores);
}

export function deriveSeasonLabelFromScore(score: number | null, bestScore: number | null, config: Pick<ScoringConfig, "seasonPeakThreshold" | "seasonSideThreshold"> = DEFAULT_SCORING_CONFIG): SeasonLabel {
  if (score == null || bestScore == null) return "off";
  if (score >= bestScore * config.seasonPeakThreshold) return "peak";
  if (score >= bestScore * config.seasonSideThreshold) return "side";
  return "off";
}
