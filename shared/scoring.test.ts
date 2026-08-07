import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateAutoMonthlyScore,
  redistributeOmittedWeight,
  scoringConfigSchema,
  DEFAULT_SCORING_CONFIG,
} from "@shared/scoring";

// ── Test 1: hand-computed spec anchor (§14.8), gustiness missing ──
// July 2015–2024 (31 days average), 15 kiteable days → 4.8387;
// 5 kiteable hours/day → 8.3333; 25 kn wind → 10; gustiness null → its 0.1
// weight redistributed (0.5 / 0.2778 / 0.2222) → score 6.9564 → round 7.0.
test("gustiness missing: month stays evaluable and matches the hand-computed spec example", () => {
  const score = calculateAutoMonthlyScore({
    month: "July",
    avgKiteableWind10mKnots: 25,
    kiteableDaysCount: 15,
    avgKiteableHoursPerDay: 5,
    gustLoadMeanPct: null,
    gustLoadP90Pct: null,
  });
  assert.ok(score != null, "month with missing gustiness must still produce a score");
  assert.ok(Math.abs(score - 7.0) < 1e-9, `expected 7.0, got ${score}`);
});

// ── Test 2: gustiness available → configured weights used unchanged (§14.7) ──
test("gustiness available: four configured weights used unchanged", () => {
  const score = calculateAutoMonthlyScore({
    month: "July",
    avgKiteableWind10mKnots: 25,
    kiteableDaysCount: 15,
    avgKiteableHoursPerDay: 5,
    gustLoadMeanPct: 20,
    gustLoadP90Pct: 30,
  });
  // evaluated = 0.7*20 + 0.3*30 = 23 ≤ 25 → gust score 10
  // (4.8387*0.45 + 8.3333*0.25 + 10*0.2 + 10*0.1) / 1.0 = 7.2608 → 7.3
  assert.ok(score != null);
  assert.ok(Math.abs(score - 7.3) < 1e-9, `expected 7.3, got ${score}`);
});

// ── Test 3: redistribution equivalence ──
test("redistributeOmittedWeight applies weight × (g / (1 - g))", () => {
  const redistributed = redistributeOmittedWeight([0.45, 0.25, 0.2], 0.1);
  assert.ok(Math.abs(redistributed[0] - 0.5) < 1e-9);
  assert.ok(Math.abs(redistributed[1] - 0.2777777777777778) < 1e-9);
  assert.ok(Math.abs(redistributed[2] - 0.2222222222222222) < 1e-9);
  const total = redistributed.reduce((sum, w) => sum + w, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `redistributed weights must sum to 1, got ${total}`);
});

test("explicit redistribution equals pure renormalization for arbitrary weight vectors", () => {
  const cases: Array<{ weights: number[]; gustWeight: number; scores: number[] }> = [
    { weights: [0.45, 0.25, 0.2], gustWeight: 0.1, scores: [4.8387, 8.3333, 10] },
    { weights: [0.5, 0.2, 0.1], gustWeight: 0.2, scores: [3, 9, 10] },
    { weights: [0.2, 0.3, 0.2], gustWeight: 0.1, scores: [5, 4, 8] },
    { weights: [0.8, 0.1, 0.05], gustWeight: 0.05, scores: [2.5, 6.25, 9.75] },
  ];
  for (const { weights, gustWeight, scores } of cases) {
    const redistributed = redistributeOmittedWeight(weights, gustWeight);
    const explicit =
      scores.reduce((sum, s, i) => sum + s * redistributed[i], 0) /
      redistributed.reduce((sum, w) => sum + w, 0);
    const pure =
      scores.reduce((sum, s, i) => sum + s * weights[i], 0) /
      weights.reduce((sum, w) => sum + w, 0);
    assert.ok(Math.abs(explicit - pure) < 1e-9, `explicit ${explicit} !== pure ${pure}`);
  }
});

// ── Test 4: non-evaluability preserved (§14.8/14.9) ──
test("missing core metric returns null (month non-evaluable)", () => {
  assert.equal(
    calculateAutoMonthlyScore({
      month: "July",
      avgKiteableWind10mKnots: null,
      kiteableDaysCount: 15,
      avgKiteableHoursPerDay: 5,
    }),
    null
  );
});

test("zero kiteable days returns 0", () => {
  assert.equal(
    calculateAutoMonthlyScore({
      month: "July",
      avgKiteableWind10mKnots: 25,
      kiteableDaysCount: 0,
      avgKiteableHoursPerDay: 5,
    }),
    0
  );
});

// ── Test 5: degenerate config guards ──
test("gustinessWeight >= 1 with gustiness missing stays finite (no NaN/Infinity)", () => {
  const score = calculateAutoMonthlyScore(
    {
      month: "July",
      avgKiteableWind10mKnots: 25,
      kiteableDaysCount: 15,
      avgKiteableHoursPerDay: 5,
      gustLoadMeanPct: null,
      gustLoadP90Pct: null,
    },
    { gustinessWeight: 1 }
  );
  assert.ok(score != null);
  assert.ok(Number.isFinite(score), `expected finite score, got ${score}`);
});

test("gustinessWeight 0 leaves the three-component average unchanged", () => {
  const base = {
    month: "July",
    avgKiteableWind10mKnots: 25,
    kiteableDaysCount: 15,
    avgKiteableHoursPerDay: 5,
  };
  const score = calculateAutoMonthlyScore({ ...base, gustLoadMeanPct: null, gustLoadP90Pct: null }, { gustinessWeight: 0 });
  // Pure 3-component average: (4.8387*0.45 + 8.3333*0.25 + 10*0.2) / 0.9 = 6.2607/0.9 ≈ 6.9564 → 7.0
  assert.ok(score != null);
  assert.ok(Math.abs(score - 7.0) < 1e-9, `expected 7.0, got ${score}`);
  // Equivalence: with gustinessWeight 0 the result must match the default config's
  // redistributed result (no boost applied either way) — both round to 7.0.
  const defaultScore = calculateAutoMonthlyScore({ ...base, gustLoadMeanPct: null, gustLoadP90Pct: null });
  assert.ok(defaultScore != null);
  assert.ok(Math.abs(score - defaultScore) < 1e-9, `expected equivalence, got ${score} vs ${defaultScore}`);
});

// ── Test 6: scoringConfigSchema (sum-to-100%) ──
test("scoringConfigSchema accepts the default config (float tolerance for 1.0000000000000002)", () => {
  const result = scoringConfigSchema.safeParse(DEFAULT_SCORING_CONFIG);
  assert.ok(result.success, result.success ? "" : JSON.stringify(result.error.issues));
});

test("scoringConfigSchema rejects weights summing to 90% or 110%", () => {
  const ninetyPct = { ...DEFAULT_SCORING_CONFIG, kiteableDaysWeight: 0.35 }; // sum = 0.9
  const hundredTenPct = { ...DEFAULT_SCORING_CONFIG, gustinessWeight: 0.2 }; // sum = 1.1
  assert.ok(!scoringConfigSchema.safeParse(ninetyPct).success);
  assert.ok(!scoringConfigSchema.safeParse(hundredTenPct).success);
});
