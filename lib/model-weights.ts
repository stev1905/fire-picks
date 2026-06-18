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
  /** last3AVG + last10AVG — recent rolling form (r=0.026 — weak signal, confirmed) */
  form: 3,
  /** hitRate20 — 20-game hit consistency (r=0.251 — 3× stronger than hitRate10) */
  consistency: 9,
  /** avgVsHand — avg vs pitcher handedness (strongest predictor, r=0.155) */
  vsHand: 23,
  /** homeAVG or awayAVG — situational split (new, needs more data to stabilize) */
  homeAway: 1,
  /** hitting streak — logarithmic bonus; streaks ≥5 carry real signal */
  streak: 10,
  /** xBA — Statcast quality metric (modest daily signal) */
  xBA: 1,
  /** hardHitPct — hard hit ball % */
  hardHit: 2,
  /** pitcher's hits allowed last 3 starts — 2nd strongest signal (15pp lift confirmed) */
  pitcherH: 25,
  /** career H2H avg vs this pitcher (min 5 AB) — surprisingly predictive (r=0.155) */
  h2h: 11,
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
