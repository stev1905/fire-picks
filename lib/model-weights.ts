/**
 * Model weights for Hit Score and HR Score.
 *
 * Derived from logistic regression analysis over 30 days of MLB snapshots
 * (5,224 batter-game observations, 2026-05-20 → 2026-06-18).
 *
 * Key findings driving these weights:
 *  - hitRate20 (r=0.251) and hitRate30 (r=0.226) are 3× more predictive
 *    than hitRate10 (r=0.072) — longer consistency windows matter
 *  - avgVsHand is a strong predictor; null values should fall back to seasonAVG
 *  - last3HitsAllowed captures real pitcher hittability signal
 *  - Hitting streak shows modest but real effect (especially ≥5 games)
 *  - xBA and hardHitPct provide Statcast quality-of-contact signal
 *  - For HR: last3HR (r=0.557) and last6HR (r=0.404) dominate all features
 *  - barrelPct (r=0.106) and last10SLG (r=0.252) are the best HR base stats
 *  - parkFactor has near-zero correlation with hits/HRs at this scale
 *
 * HIT_WEIGHTS sum = 85 (leaving ~15 for weather/pitch-matchup modifiers)
 * HR_WEIGHTS  sum = 85 (leaving ~15 for weather/pull-distance modifiers)
 */

export const HIT_WEIGHTS = {
  /** last3AVG + last10AVG combined — recent rolling form */
  form: 20,
  /** hitRate20 — fraction of last 20 games with a hit (strongest single predictor r=0.251) */
  consistency: 18,
  /** avgVsHand — avg vs pitcher handedness (fallback: seasonAVG when null) */
  vsHand: 16,
  /** homeAVG or awayAVG — situational split */
  homeAway: 7,
  /** hitting streak — logarithmic bonus, significant only for streaks ≥ 5 */
  streak: 5,
  /** xBA — Statcast expected batting average */
  xBA: 9,
  /** hardHitPct — hard hit ball % */
  hardHit: 3,
  /** pitcher's hits allowed last 3 starts — hittability signal */
  pitcherH: 4,
  /** career H2H avg vs this pitcher (min 5 AB) */
  h2h: 3,
};

export const HR_WEIGHTS = {
  /** last3HR / last6HR / last10HR combined — recent HR activity (dominant predictor) */
  recentHR: 22,
  /** season SLG — baseline power */
  seasonSLG: 12,
  /** SLG vs pitcher hand — matchup power split */
  slgVsHand: 11,
  /** last10SLG — recent power form (r=0.252) */
  recentSLG: 10,
  /** barrelPct — Statcast barrel rate (r=0.106, highest Statcast predictor for HR) */
  barrel: 12,
  /** hardHitPct — quality of contact */
  hardHit: 8,
  /** pitcher's HRs allowed — season rate & L3 starts */
  pitcherHR: 7,
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
