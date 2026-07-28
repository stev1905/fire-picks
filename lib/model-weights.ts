/**
 * Model weights for Hit Score and HR Score.
 *
 * Validated via backtest over 45 days / 7,967 batter-game observations
 * (2026-05-19 → 2026-07-02). Production H/9 normalization confirmed correct.
 *
 * Feature correlations (point-biserial r vs got_hit, from backtest):
 *  - h2hAVG         r=0.139 — strongest per-PA predictor (36% coverage)
 *  - avgVsHand      r=0.135 — 100% coverage, top overall discriminator
 *  - pitcherH (H/9) r=0.132 — 21.7pp spread elite→hittable; stays dominant
 *  - homeAway       r=0.107 — 9.8pp spread; was underweighted at 1 → raised to 4
 *  - xBA            r=0.058 — 100% coverage; was underweighted at 1 → raised to 4
 *  - streak         r=0.031 — real but nonlinear; effect flattens below streak=5
 *  - hitRate20      r=0.251 (training data) — longer windows more predictive
 *  - parkFactor: near-zero correlation confirmed; removed from sum
 *
 * Changes from prior weights (sum still = 85):
 *  homeAway:  1 →  4  (+3)  signal confirmed, was effectively ignored
 *  xBA:       1 →  4  (+3)  100% coverage, decent signal
 *  streak:   10 →  7  (-3)  overweighted vs data (effect flattens <streak 5)
 *  form:      3 →  2  (-1)  r=0.01-0.03 — near-useless
 *  h2h:      11 →  9  (-2)  strong signal; slight trim vs 36.5% coverage
 *
 * HIT_WEIGHTS sum = 85 (leaving ~15 for weather/pitch-matchup modifiers)
 * HR_WEIGHTS  sum = 85 (leaving ~15 for weather/pull-distance modifiers)
 */

export const HIT_WEIGHTS = {
  /** last3AVG + last10AVG — recent rolling form (r=0.01-0.03 — weak, confirmed) */
  form: 2,
  /** hitRate20 — 20-game hit consistency (r=0.251 in training — longer windows matter) */
  consistency: 9,
  /** avgVsHand — avg vs pitcher handedness (r=0.135, 100% coverage — top discriminator) */
  vsHand: 23,
  /** homeAVG or awayAVG — situational split (r=0.107, 9.8pp spread; raised from 1) */
  homeAway: 4,
  /** hitting streak — logarithmic bonus; real signal ≥5 games (r=0.031 overall) */
  streak: 7,
  /** xBA — Statcast expected BA (r=0.058, 100% coverage; raised from 1) */
  xBA: 4,
  /** hardHitPct — hard hit ball % (weak r but covers contact quality) */
  hardHit: 2,
  /** pitcher H/9 last 3 starts — strong predictor (r=0.132, 21.7pp elite→hittable spread) */
  pitcherH: 25,
  /** career H2H avg vs this pitcher (min 5 AB) — r=0.139, 36.5% coverage */
  h2h: 9,
};

export const HR_WEIGHTS = {
  /** last3HR / last6HR / last10HR combined — recent HR activity (dominant predictor) */
  recentHR: 20,
  /** season SLG — baseline power */
  seasonSLG: 9,
  /** SLG vs pitcher hand — matchup power split */
  slgVsHand: 9,
  /** last10SLG — recent power form */
  recentSLG: 7,
  /** barrelPct — Statcast barrel rate (highest Statcast predictor for HR) */
  barrel: 11,
  /** hardHitPct — quality of contact */
  hardHit: 6,
  /** pitcher's HRs allowed per 9 vs batter's hand (L/R) */
  pitcherHR: 6,
  /** xwOBA — expected weighted OBA; captures full power spectrum including doubles/HR */
  xwOBA: 8,
  /** flyBallRate — fly ball tendency (fbld / total batted balls); strong HR correlate */
  flyBall: 6,
  /** park factor — binned park adjustment */
  park: 3,
};

// Verify totals at import time (development guard)
const hitTotal = Object.values(HIT_WEIGHTS).reduce((a, b) => a + b, 0);
const hrTotal  = Object.values(HR_WEIGHTS).reduce((a, b)  => a + b, 0);
if (hitTotal !== 85) {
  console.warn(`[model-weights] HIT_WEIGHTS sum = ${hitTotal}, expected 85`);
}
if (hrTotal !== 85) {
  console.warn(`[model-weights] HR_WEIGHTS sum = ${hrTotal}, expected 85`);
}
