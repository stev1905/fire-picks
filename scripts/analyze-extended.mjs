/**
 * Extended Hit & HR Model Analysis — last 30 days
 *
 * Sections:
 *   A) Hit score calibration + park factor correlation with hits
 *   B) HR score calibration + feature correlations for HR outcomes
 *   C) Logistic regression optimal weights for HIT
 *   D) Logistic regression optimal weights for HR
 *   E) hitRate20/hitRate30 correlation with actual hit outcomes
 *   F) baVsBreaking / chasePct correlation analysis
 *   G) Park factor impact binned by tier
 *   H) Consistency metrics: hitRate10 vs hitRate20 vs hitRate30
 *   I) Self-improving model proposal
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://dshrvzwpdixzhvoncgwi.supabase.co",
  "sb_publishable_8_pzcyPHYW3FIDJ1d0oKQQ_F2sGq6Ek"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, max) { return Math.min(max, Math.max(0, v)); }
function fmt3(v) {
  if (v === null || v === undefined || isNaN(v)) return " ---";
  return v.toFixed(3).replace(/^0/, "");
}
function mean(arr) {
  const valid = arr.filter(v => v !== null && v !== undefined && !isNaN(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}
function pointBiserial(values, outcomes) {
  // outcomes = 0 or 1
  const paired = values.map((v, i) => [v, outcomes[i]]).filter(([v]) => v !== null && v !== undefined && !isNaN(v));
  if (paired.length < 20) return null;
  const vals = paired.map(p => p[0]);
  const outs = paired.map(p => p[1]);
  const n = vals.length;
  const mu = vals.reduce((a, b) => a + b, 0) / n;
  const sigma = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / n) || 1;
  const hitVals = paired.filter(p => p[1] === 1).map(p => p[0]);
  const noVals  = paired.filter(p => p[1] === 0).map(p => p[0]);
  if (hitVals.length === 0 || noVals.length === 0) return null;
  const hitMean = hitVals.reduce((a, b) => a + b, 0) / hitVals.length;
  const noMean  = noVals.reduce((a, b) => a + b, 0) / noVals.length;
  const pHit = hitVals.length / n;
  return ((hitMean - noMean) / sigma) * Math.sqrt(pHit * (1 - pHit));
}

// ── Pre-game feature extractor ─────────────────────────────────────────────────

function calcPreGameFeatures(batter, pitcher, snapshotDate, parkFactor) {
  const priorGames = (batter.last10Games ?? []).filter(g => g.date !== snapshotDate);
  const recent3    = priorGames.slice(0, 3);
  const recent10   = priorGames.slice(0, 10);

  const windowAvg = (games) => {
    const ab = games.reduce((s, g) => s + (g.atBats ?? 0), 0);
    const h  = games.reduce((s, g) => s + (g.hits  ?? 0), 0);
    return ab > 0 ? h / ab : null;
  };

  const last3AVG  = windowAvg(recent3);
  const last10AVG = windowAvg(recent10);
  const hitRate10 = recent10.length > 0 ? recent10.filter(g => g.hits > 0).length / recent10.length : null;

  // Pre-game streak — consecutive games with a hit before today
  let hittingStreak = 0;
  for (const g of priorGames) {
    if ((g.hits ?? 0) > 0) hittingStreak++;
    else break;
  }

  const pitcherHand    = pitcher?.hand ?? null;
  const avgVsHand      = pitcherHand === "L" ? batter.avgVsLeft : batter.avgVsRight;
  const slgVsHand      = pitcherHand === "L" ? batter.slgVsLeft : batter.slgVsRight;
  const situationalAvg = batter.isHome ? batter.homeAVG : batter.awayAVG;

  // Recent HR windows
  const last10HRCount = recent10.reduce((s, g) => s + (g.hr ?? 0), 0);

  return {
    last3AVG,
    last10AVG,
    hitRate10,
    hitRate20:     batter.hitRate20 ?? null,
    hitRate30:     batter.hitRate30 ?? null,
    seasonAVG:     batter.seasonAVG  ?? null,
    seasonSLG:     batter.seasonSLG  ?? null,
    avgVsHand:     avgVsHand ?? null,
    slgVsHand:     slgVsHand ?? null,
    pitcherHand,
    isHome:        batter.isHome ?? null,
    situationalAvg: (situationalAvg && situationalAvg > 0) ? situationalAvg : null,
    hittingStreak,
    xBA:           batter.xBA        ?? null,
    barrelPct:     batter.barrelPct  ?? null,
    hardHitPct:    batter.hardHitPct ?? null,
    chasePct:      batter.chasePct   ?? null,
    baVsBreaking:  batter.baVsBreaking ?? null,
    baVsFastball:  batter.baVsFastball ?? null,
    last3HitsAllowed: pitcher?.last3HitsAllowed ?? null,
    last3HRAllowed:   pitcher?.last3HRAllowed   ?? null,
    last3InningsPitched: pitcher?.last3InningsPitched ?? null,
    seasonHRAllowed: pitcher?.seasonHRAllowed  ?? null,
    seasonERA:     pitcher?.seasonERA ?? null,
    whiffPct:      pitcher?.whiffPct  ?? null,
    kPct:          pitcher?.kPct      ?? null,
    hardHitAllowedPct: pitcher?.hardHitAllowedPct ?? null,
    h2hAVG:        (batter.vsCurrentPitcher?.atBats ?? 0) >= 5 ? batter.vsCurrentPitcher.avg : null,
    h2hHR:         (batter.vsCurrentPitcher?.atBats ?? 0) >= 8 ? batter.vsCurrentPitcher.hr  : null,
    h2hAB:         batter.vsCurrentPitcher?.atBats ?? 0,
    parkFactor:    parkFactor ?? 1.0,
    last10HRCount,
    last6HR:       batter.last6HR  ?? 0,
    last3HR:       batter.last3HR  ?? 0,
    last10SLG:     batter.last10SLG ?? null,
  };
}

// ── Hit score (mirrors scores.ts) ─────────────────────────────────────────────

function computeHitScore(feat) {
  let score = 0;
  score += clamp(((feat.last10AVG ?? 0) / 0.380) * 14 + ((feat.last3AVG ?? 0) / 0.480) * 8, 22);
  score += clamp((feat.hitRate10 ?? 0) * 9, 9);
  score += clamp(((feat.avgVsHand ?? 0) / 0.360) * 15, 15);
  if (feat.situationalAvg !== null) score += clamp((feat.situationalAvg / 0.340) * 7, 7);
  score += clamp(feat.hittingStreak * 0.85, 7);
  if (feat.xBA !== null) score += clamp((feat.xBA / 0.340) * 10, 10);
  if (feat.hardHitPct !== null) score += clamp((feat.hardHitPct / 55) * 4, 4);
  if (feat.last3HitsAllowed !== null) {
    const softness = Math.max(0, (feat.last3HitsAllowed - 4) / 11);
    score += clamp(softness * 7, 7);
  }
  if (feat.h2hAVG !== null) score += clamp((feat.h2hAVG / 0.300) * 5, 5);
  return Math.min(100, Math.max(0, Math.round(score)));
}

// ── HR score (mirrors scores.ts) ──────────────────────────────────────────────

function computeHRScore(feat) {
  let score = 0;
  const recentHR =
    clamp(((feat.last10HRCount ?? 0) / 4) * 10, 10) +
    clamp(((feat.last6HR  ?? 0) / 3) * 6, 6) +
    clamp(((feat.last3HR  ?? 0) / 2) * 4, 4);
  score += recentHR;
  score += clamp(((feat.seasonSLG ?? 0) / 0.620) * 15, 15);
  if (feat.slgVsHand !== null) score += clamp((feat.slgVsHand / 0.680) * 13, 13);
  score += clamp(((feat.parkFactor - 0.88) / (1.24 - 0.88)) * 8, 8);
  if (feat.last10SLG !== null) score += clamp((feat.last10SLG / 0.700) * 7, 7);
  if (feat.barrelPct !== null) score += clamp((feat.barrelPct / 20) * 10, 10);
  if (feat.last3HRAllowed !== null && feat.last3InningsPitched !== null) {
    const ip = feat.last3InningsPitched;
    const hrPer9 = ip > 0 ? (feat.last3HRAllowed / ip) * 9 : (feat.seasonHRAllowed ?? 0) / 30;
    score += clamp((hrPer9 / 2.0) * 8, 8);
  }
  if (feat.h2hHR !== null && feat.h2hAB >= 8) {
    score += clamp((feat.h2hHR / feat.h2hAB) * 40, 4);
  }
  return Math.min(100, Math.max(0, Math.round(score)));
}

// ── Logistic regression in pure JS ────────────────────────────────────────────

function logisticRegression(data, featureKeys, outcomeKey, epochs = 2000, lr = 0.05) {
  // Use all rows; impute missing values with feature mean
  const rows = data.filter(d => d[outcomeKey] !== null && d[outcomeKey] !== undefined);
  if (rows.length < 50) {
    return { error: `Only ${rows.length} rows — need ≥ 50`, rows: rows.length };
  }

  // Compute per-feature mean (for imputation) and min/max (for normalization)
  const mins = {}, maxs = {}, ranges = {}, featureMeans = {};
  for (const k of featureKeys) {
    const valid = rows.map(r => r[k]).filter(v => v !== null && v !== undefined && !isNaN(v));
    featureMeans[k] = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
    mins[k]   = valid.length ? Math.min(...valid) : 0;
    maxs[k]   = valid.length ? Math.max(...valid) : 1;
    ranges[k] = (maxs[k] - mins[k]) || 1;
  }

  // Normalize features to [0,1], imputing nulls with feature mean
  const X = rows.map(r => featureKeys.map(k => {
    const v = (r[k] !== null && r[k] !== undefined && !isNaN(r[k])) ? r[k] : featureMeans[k];
    return (v - mins[k]) / ranges[k];
  }));
  const y = rows.map(r => r[outcomeKey] ? 1 : 0);
  const n = X.length;
  const m = featureKeys.length;

  // Initialize weights
  let weights = new Array(m).fill(0);
  let bias = 0;

  const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(m).fill(0);
    let gradB = 0;
    let loss = 0;

    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((s, x, j) => s + x * weights[j], bias);
      const p = sigmoid(z);
      const err = p - y[i];
      for (let j = 0; j < m; j++) gradW[j] += err * X[i][j];
      gradB += err;
      loss += -(y[i] * Math.log(p + 1e-15) + (1 - y[i]) * Math.log(1 - p + 1e-15));
    }

    for (let j = 0; j < m; j++) weights[j] -= (lr / n) * gradW[j];
    bias -= (lr / n) * gradB;
  }

  // Compute AUC-ROC approximation (Wilcoxon statistic)
  const preds = X.map((xi, i) => {
    const z = xi.reduce((s, x, j) => s + x * weights[j], bias);
    return { prob: 1 / (1 + Math.exp(-z)), label: y[i] };
  });
  const pos = preds.filter(p => p.label === 1);
  const neg = preds.filter(p => p.label === 0);
  let auc = 0;
  for (const p of pos) for (const q of neg) {
    if (p.prob > q.prob) auc++;
    else if (p.prob === q.prob) auc += 0.5;
  }
  auc = auc / (pos.length * neg.length || 1);

  // Scale coefficients × range for interpretability
  const scaledWeights = featureKeys.map((k, j) => ({
    feature: k,
    coeff:   weights[j],
    range:   ranges[k],
    scaled:  weights[j] * ranges[k],
    min:     mins[k],
    max:     maxs[k],
  }));
  scaledWeights.sort((a, b) => Math.abs(b.scaled) - Math.abs(a.scaled));

  return { weights: scaledWeights, bias, auc, n: rows.length };
}

// ── Fetch data ─────────────────────────────────────────────────────────────────

console.log("Fetching last 30 MLB snapshots from Supabase...\n");

const { data: rows, error } = await sb
  .from("snapshots")
  .select("date, data")
  .like("date", "____-__-__")
  .order("date", { ascending: false })
  .limit(30);

if (error) { console.error(error); process.exit(1); }
console.log(`Got ${rows.length} snapshots: ${rows[rows.length-1]?.date} → ${rows[0]?.date}\n`);

// ── Build observation sets ─────────────────────────────────────────────────────

const hitObs = [];  // for hit model
const hrObs  = [];  // for HR model

for (const row of rows) {
  const date  = row.date;
  const games = row.data?.games ?? [];

  for (const game of games) {
    const parkFactor  = game.parkFactor ?? 1.0;
    const homePitcher = game.homeStartingPitcher;
    const awayPitcher = game.awayStartingPitcher;

    for (const [lineup, opposingPitcher] of [
      [game.homeLineup, awayPitcher],
      [game.awayLineup, homePitcher],
    ]) {
      for (const batter of (lineup ?? [])) {
        const todayGame = batter.last10Games?.[0];
        if (!todayGame || todayGame.date !== date) continue;
        if ((todayGame.atBats ?? 0) === 0) continue;

        const feat     = calcPreGameFeatures(batter, opposingPitcher, date, parkFactor);
        const hitScore = computeHitScore(feat);
        const hrScore  = computeHRScore(feat);

        const gotHit = (todayGame.hits ?? 0) > 0;
        const gotHR  = (todayGame.hr   ?? 0) > 0;

        hitObs.push({ date, name: batter.name, team: batter.teamAbbreviation ?? "", gotHit, gotHR, atBats: todayGame.atBats, hits: todayGame.hits, hr: todayGame.hr, hitScore, hrScore, feat });
        hrObs.push({ date, name: batter.name, team: batter.teamAbbreviation ?? "", gotHit, gotHR, atBats: todayGame.atBats, hits: todayGame.hits, hr: todayGame.hr, hitScore, hrScore, feat });
      }
    }
  }
}

console.log(`Total batter-game observations: ${hitObs.length}`);
const totalHits = hitObs.filter(o => o.gotHit).length;
const totalHRs  = hitObs.filter(o => o.gotHR).length;
console.log(`Overall hit rate: ${totalHits}/${hitObs.length} = ${(totalHits/hitObs.length*100).toFixed(1)}%`);
console.log(`Overall HR  rate: ${totalHRs}/${hitObs.length}  = ${(totalHRs/hitObs.length*100).toFixed(1)}%\n`);

const sep = () => console.log("═══════════════════════════════════════════════════════════════");

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A — Hit Score Calibration + Park Factor Correlation
// ─────────────────────────────────────────────────────────────────────────────

sep();
console.log(" A. HIT SCORE CALIBRATION + PARK FACTOR CORRELATION");
sep();

const hitBands = [
  { label: "80–100 (elite)",  min: 80, max: 100 },
  { label: "70–79  (strong)", min: 70, max: 79  },
  { label: "60–69  (good)",   min: 60, max: 69  },
  { label: "50–59  (avg+)",   min: 50, max: 59  },
  { label: "40–49  (avg-)",   min: 40, max: 49  },
  { label: "< 40   (weak)",   min:  0, max: 39  },
];

console.log("\n  Hit Score Calibration:");
for (const band of hitBands) {
  const sub = hitObs.filter(o => o.hitScore >= band.min && o.hitScore <= band.max);
  if (sub.length === 0) continue;
  const hits = sub.filter(o => o.gotHit).length;
  const rate = hits / sub.length;
  const bar  = "█".repeat(Math.round(rate * 20));
  console.log(`  ${band.label.padEnd(20)} ${bar.padEnd(20)} ${(rate*100).toFixed(1)}%  (n=${sub.length})`);
}

console.log("\n  Park Factor Correlation with Hits:");
const pfBins = [
  { label: "< 0.95 (pitcher park)",   filter: pf => pf < 0.95 },
  { label: "0.95–1.04 (neutral)",     filter: pf => pf >= 0.95 && pf < 1.05 },
  { label: "1.05–1.14 (hitter park)", filter: pf => pf >= 1.05 && pf < 1.15 },
  { label: "≥ 1.15 (extreme hitter)", filter: pf => pf >= 1.15 },
];
for (const bin of pfBins) {
  const sub  = hitObs.filter(o => bin.filter(o.feat.parkFactor));
  if (sub.length < 10) continue;
  const rate = sub.filter(o => o.gotHit).length / sub.length;
  console.log(`  ${bin.label.padEnd(36)} ${(rate*100).toFixed(1)}%  (n=${sub.length})`);
}

// PB correlation: parkFactor vs gotHit
const pfCorr = pointBiserial(hitObs.map(o => o.feat.parkFactor), hitObs.map(o => o.gotHit ? 1 : 0));
console.log(`\n  Point-biserial r (parkFactor vs gotHit): ${pfCorr?.toFixed(4) ?? "—"}`);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B — HR Score Calibration + Feature Correlations for HR
// ─────────────────────────────────────────────────────────────────────────────

sep();
console.log(" B. HR SCORE CALIBRATION + FEATURE CORRELATIONS");
sep();

console.log("\n  HR Score Calibration:");
const hrBands = [
  { label: "70–100 (elite)",  min: 70, max: 100 },
  { label: "55–69  (strong)", min: 55, max: 69  },
  { label: "40–54  (avg+)",   min: 40, max: 54  },
  { label: "25–39  (avg-)",   min: 25, max: 39  },
  { label: "< 25   (weak)",   min:  0, max: 24  },
];
for (const band of hrBands) {
  const sub = hrObs.filter(o => o.hrScore >= band.min && o.hrScore <= band.max);
  if (sub.length === 0) continue;
  const hrs = sub.filter(o => o.gotHR).length;
  const rate = hrs / sub.length;
  const bar  = "█".repeat(Math.round(rate * 60));
  console.log(`  ${band.label.padEnd(20)} ${bar.padEnd(12)} ${(rate*100).toFixed(1)}%  (n=${sub.length})`);
}

console.log("\n  Feature Point-Biserial Correlations with HR outcome:");
const hrFeatureKeys = ["barrelPct","last10HRCount","last3HR","last6HR","seasonSLG","slgVsHand","parkFactor","last3HRAllowed","hardHitPct","last10SLG","xBA"];
for (const k of hrFeatureKeys) {
  const vals = hrObs.map(o => o.feat[k]);
  const outs = hrObs.map(o => o.gotHR ? 1 : 0);
  const r = pointBiserial(vals, outs);
  if (r === null) continue;
  console.log(`    ${k.padEnd(26)}  r = ${r >= 0 ? " " : ""}${r.toFixed(4)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION C — Logistic Regression: HIT
// ─────────────────────────────────────────────────────────────────────────────

sep();
console.log(" C. LOGISTIC REGRESSION — HIT PREDICTION");
sep();

const hitFeatureKeys = [
  "last3AVG", "last10AVG", "hitRate10", "avgVsHand", "situationalAvg",
  "hittingStreak", "xBA", "hardHitPct", "last3HitsAllowed", "h2hAVG",
  "parkFactor", "hitRate20", "hitRate30", "chasePct", "baVsBreaking", "barrelPct"
];

// Build flat observations for LR (need features from feat object + outcome)
const hitLRData = hitObs.map(o => ({ ...o.feat, gotHit: o.gotHit ? 1 : 0 }));

console.log("\n  Running gradient descent logistic regression (2000 epochs, lr=0.05)...");
const hitLR = logisticRegression(hitLRData, hitFeatureKeys, "gotHit", 2000, 0.05);

if (hitLR.error) {
  console.log(`  Error: ${hitLR.error}`);
} else {
  console.log(`  Training rows: ${hitLR.n}   AUC-ROC: ${hitLR.auc.toFixed(4)}\n`);
  console.log("  " + "Feature".padEnd(26) + "  Coeff".padEnd(12) + "  Scaled (coeff×range)  Current Weight (est)");
  // Current weights (estimated max pts in current score)
  const currentWeights = {
    last3AVG: 8, last10AVG: 14, hitRate10: 9, avgVsHand: 15, situationalAvg: 7,
    hittingStreak: 7, xBA: 10, hardHitPct: 4, last3HitsAllowed: 7, h2hAVG: 5,
    parkFactor: 6, hitRate20: 0, hitRate30: 0, chasePct: 0, baVsBreaking: 0, barrelPct: 0
  };
  for (const w of hitLR.weights) {
    const cur = currentWeights[w.feature] ?? 0;
    console.log(`  ${w.feature.padEnd(26)}  ${w.coeff.toFixed(4).padEnd(12)}  ${w.scaled.toFixed(4).padEnd(22)} current=${cur}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION D — Logistic Regression: HR
// ─────────────────────────────────────────────────────────────────────────────

sep();
console.log(" D. LOGISTIC REGRESSION — HR PREDICTION");
sep();

const hrFeatureKeysLR = [
  "last3HR", "last6HR", "last10HRCount", "seasonSLG", "slgVsHand",
  "parkFactor", "barrelPct", "hardHitPct", "last3HRAllowed", "last10SLG",
  "xBA", "chasePct", "baVsBreaking"
];
const hrLRData = hrObs.map(o => ({ ...o.feat, gotHR: o.gotHR ? 1 : 0 }));

console.log("\n  Running gradient descent logistic regression (2000 epochs, lr=0.05)...");
const hrLR = logisticRegression(hrLRData, hrFeatureKeysLR, "gotHR", 2000, 0.05);

if (hrLR.error) {
  console.log(`  Error: ${hrLR.error}`);
} else {
  console.log(`  Training rows: ${hrLR.n}   AUC-ROC: ${hrLR.auc.toFixed(4)}\n`);
  console.log("  " + "Feature".padEnd(26) + "  Coeff".padEnd(12) + "  Scaled (coeff×range)");
  const currentHRWeights = {
    last3HR: 4, last6HR: 6, last10HRCount: 10, seasonSLG: 15, slgVsHand: 13,
    parkFactor: 8, barrelPct: 10, hardHitPct: 0, last3HRAllowed: 8, last10SLG: 7,
    xBA: 0, chasePct: 0, baVsBreaking: 0
  };
  for (const w of hrLR.weights) {
    const cur = currentHRWeights[w.feature] ?? 0;
    console.log(`  ${w.feature.padEnd(26)}  ${w.coeff.toFixed(4).padEnd(12)}  ${w.scaled.toFixed(4).padEnd(22)} current=${cur}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION E — hitRate20/hitRate30 Correlation
// ─────────────────────────────────────────────────────────────────────────────

sep();
console.log(" E. hitRate20 / hitRate30 CORRELATION WITH HIT OUTCOMES");
sep();

for (const key of ["hitRate10", "hitRate20", "hitRate30"]) {
  const obs = hitObs.filter(o => o.feat[key] !== null && o.feat[key] !== undefined);
  const r = pointBiserial(obs.map(o => o.feat[key]), obs.map(o => o.gotHit ? 1 : 0));
  console.log(`\n  ${key} (n=${obs.length}):  r = ${r?.toFixed(4) ?? "—"}`);

  // Bucket analysis
  const buckets = [
    { label: "≥ 0.80", filter: v => v >= 0.80 },
    { label: "0.60–0.79", filter: v => v >= 0.60 && v < 0.80 },
    { label: "0.40–0.59", filter: v => v >= 0.40 && v < 0.60 },
    { label: "< 0.40",   filter: v => v < 0.40 },
  ];
  for (const b of buckets) {
    const sub = obs.filter(o => b.filter(o.feat[key]));
    if (sub.length < 10) continue;
    const rate = sub.filter(o => o.gotHit).length / sub.length;
    console.log(`    ${b.label.padEnd(14)}  ${(rate*100).toFixed(1)}%  (n=${sub.length})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION F — baVsBreaking / chasePct Analysis
// ─────────────────────────────────────────────────────────────────────────────

sep();
console.log(" F. baVsBreaking / chasePct CORRELATION ANALYSIS");
sep();

for (const key of ["baVsBreaking", "chasePct", "baVsFastball"]) {
  const obs = hitObs.filter(o => o.feat[key] !== null && o.feat[key] !== undefined);
  if (obs.length < 20) { console.log(`\n  ${key}: insufficient data (n=${obs.length})`); continue; }
  const r = pointBiserial(obs.map(o => o.feat[key]), obs.map(o => o.gotHit ? 1 : 0));
  console.log(`\n  ${key} (n=${obs.length}):  r = ${r?.toFixed(4) ?? "—"}`);

  if (key === "baVsBreaking") {
    const buckets = [
      { label: "≥ .280 (strong)",   filter: v => v >= 0.280 },
      { label: ".240–.279 (avg)",   filter: v => v >= 0.240 && v < 0.280 },
      { label: ".200–.239 (below)", filter: v => v >= 0.200 && v < 0.240 },
      { label: "< .200 (weak)",     filter: v => v < 0.200 },
    ];
    for (const b of buckets) {
      const sub = obs.filter(o => b.filter(o.feat[key]));
      if (sub.length < 10) continue;
      const rate = sub.filter(o => o.gotHit).length / sub.length;
      console.log(`    ${b.label.padEnd(22)}  ${(rate*100).toFixed(1)}%  (n=${sub.length})`);
    }
  } else if (key === "chasePct") {
    const buckets = [
      { label: "< 22% (disciplined)",   filter: v => v < 22 },
      { label: "22–28% (avg)",          filter: v => v >= 22 && v < 28 },
      { label: "28–34% (above avg)",    filter: v => v >= 28 && v < 34 },
      { label: "≥ 34% (high chaser)",   filter: v => v >= 34 },
    ];
    for (const b of buckets) {
      const sub = obs.filter(o => b.filter(o.feat[key]));
      if (sub.length < 10) continue;
      const rate = sub.filter(o => o.gotHit).length / sub.length;
      console.log(`    ${b.label.padEnd(26)}  ${(rate*100).toFixed(1)}%  (n=${sub.length})`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION G — Park Factor Impact by Tier
// ─────────────────────────────────────────────────────────────────────────────

sep();
console.log(" G. PARK FACTOR IMPACT — hit rate and HR rate by tier");
sep();

const parkTiers = [
  { label: "< 0.95    (pitcher park)",   filter: pf => pf < 0.95 },
  { label: "0.95–1.04 (neutral)",        filter: pf => pf >= 0.95 && pf < 1.05 },
  { label: "1.05–1.14 (hitter park)",    filter: pf => pf >= 1.05 && pf < 1.15 },
  { label: "≥ 1.15   (extreme hitter)",  filter: pf => pf >= 1.15 },
];

console.log("\n  " + "Tier".padEnd(36) + "  Hit%    HR%     n");
for (const tier of parkTiers) {
  const sub = hitObs.filter(o => tier.filter(o.feat.parkFactor));
  if (sub.length < 10) continue;
  const hitRate = sub.filter(o => o.gotHit).length / sub.length;
  const hrRate  = sub.filter(o => o.gotHR).length  / sub.length;
  console.log(`  ${tier.label.padEnd(36)}  ${(hitRate*100).toFixed(1).padStart(5)}%  ${(hrRate*100).toFixed(1).padStart(5)}%  ${sub.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION H — Consistency Metrics Comparison
// ─────────────────────────────────────────────────────────────────────────────

sep();
console.log(" H. CONSISTENCY METRICS — hitRate10 vs hitRate20 vs hitRate30");
sep();

console.log("\n  Point-biserial correlations with gotHit:");
for (const key of ["hitRate10", "hitRate20", "hitRate30"]) {
  const obs = hitObs.filter(o => o.feat[key] !== null && o.feat[key] !== undefined);
  const r = pointBiserial(obs.map(o => o.feat[key]), obs.map(o => o.gotHit ? 1 : 0));
  const coverage = (obs.length / hitObs.length * 100).toFixed(1);
  console.log(`  ${key.padEnd(12)}  r = ${r?.toFixed(4) ?? "—"}   coverage = ${coverage}%  (n=${obs.length})`);
}

console.log("\n  hitRate10 vs hitRate20 delta (longer window vs shorter):");
const both = hitObs.filter(o => o.feat.hitRate10 !== null && o.feat.hitRate20 !== null);
if (both.length > 50) {
  const agrees   = both.filter(o => Math.sign(o.feat.hitRate20 - 0.5) === Math.sign(o.feat.hitRate10 - 0.5));
  const disagrees = both.filter(o => Math.sign(o.feat.hitRate20 - 0.5) !== Math.sign(o.feat.hitRate10 - 0.5));
  console.log(`  Agree (both above/below 50%):   ${agrees.length}   Hit rate: ${(agrees.filter(o => o.gotHit).length/agrees.length*100).toFixed(1)}%`);
  console.log(`  Disagree:                        ${disagrees.length}   Hit rate: ${disagrees.length ? (disagrees.filter(o => o.gotHit).length/disagrees.length*100).toFixed(1) : "—"}%`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION I — Self-Improving Model Proposal
// ─────────────────────────────────────────────────────────────────────────────

sep();
console.log(" I. SELF-IMPROVING MODEL PROPOSAL");
sep();

console.log(`
  WHAT TO STORE (in Supabase or a new predictions table):
  ┌─────────────────────────────────────────────────────────────────┐
  │ predictions table:                                              │
  │   date         TEXT      — YYYY-MM-DD                          │
  │   player_id    INT       — batter MLB id                        │
  │   player_name  TEXT                                             │
  │   hit_score    FLOAT     — pre-game computed score              │
  │   hr_score     FLOAT                                            │
  │   features     JSONB     — all pre-game features stored         │
  │   got_hit      BOOLEAN   — filled post-game                     │
  │   got_hr       BOOLEAN                                          │
  │   at_bats      INT                                              │
  └─────────────────────────────────────────────────────────────────┘

  HOW TO RETRAIN (automated daily):
  1. After each game day, insert prediction rows with outcomes
  2. Weekly: pull last 90 days from predictions table
  3. Run logistic regression (this script) on the accumulated data
  4. Update lib/model-weights.ts with new coefficients via a CI step
  5. The sync function (netlify/functions/sync-mlb-data.ts) can trigger
     the retraining job after each snapshot is stored

  KEY SIGNALS RANKED BY CURRENT DATA (from logistic regression above):
  - For HITS:   last10AVG, avgVsHand, xBA, hitRate10/20, last3HitsAllowed
  - For HRs:    barrelPct, slgVsHand, last10SLG, last3HR/last6HR, parkFactor

  IMPROVEMENT IDEAS:
  1. Add hitRate20/hitRate30 to hit score (currently unused but predictive)
  2. Fix null avgVsHand — use seasonAVG fallback to avoid scoring 0
  3. Logarithmic streak curve: most value from streaks 5–10, not linear
  4. baVsBreaking: weak predictor alone; combine with chasePct for matchup
  5. Store park factor by park type (HR/H separately — Coors high H but not
     #1 HR park; Yankee Stadium HR-friendly but pitcher-heavy for H)
`);

// ─────────────────────────────────────────────────────────────────────────────
// Summary of LR weights for model-weights.ts
// ─────────────────────────────────────────────────────────────────────────────

sep();
console.log(" SUMMARY — Recommended weights for model-weights.ts");
sep();

if (!hitLR.error) {
  // Normalize hit weights to sum to 85
  const hitPositive = hitLR.weights.filter(w => w.scaled > 0);
  const hitTotal = hitPositive.reduce((s, w) => s + Math.abs(w.scaled), 0) || 1;
  const TARGET_HIT = 85;

  console.log("\n  HIT_WEIGHTS (proportional to |scaled coeff|, sum ≈ 85):");
  const hitMap = {};
  for (const w of hitLR.weights) {
    if (w.scaled > 0) hitMap[w.feature] = Math.round((w.scaled / hitTotal) * TARGET_HIT * 10) / 10;
  }
  console.log(JSON.stringify(hitMap, null, 4));
}

if (!hrLR.error) {
  const hrPositive = hrLR.weights.filter(w => w.scaled > 0);
  const hrTotal = hrPositive.reduce((s, w) => s + Math.abs(w.scaled), 0) || 1;
  const TARGET_HR = 85;

  console.log("\n  HR_WEIGHTS (proportional to |scaled coeff|, sum ≈ 85):");
  const hrMap = {};
  for (const w of hrLR.weights) {
    if (w.scaled > 0) hrMap[w.feature] = Math.round((w.scaled / hrTotal) * TARGET_HR * 10) / 10;
  }
  console.log(JSON.stringify(hrMap, null, 4));
}

console.log("\nDone.\n");
