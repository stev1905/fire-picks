/**
 * Monthly model recalibration — scheduled background function.
 * Reads the last 90 days from batter_outcomes, runs logistic regression
 * for hit and HR outcomes, then stores the new optimal weights in model_config.
 *
 * Schedule: 1st of each month at 4 AM ET (cron: "0 8 1 * *" UTC)
 * Trigger manually: POST /.netlify/functions/recalibrate-model-background
 *
 * After this runs, pull the new weights into the codebase:
 *   node scripts/apply-weights.mjs
 */

import { createClient } from "@supabase/supabase-js";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// ── Logistic regression (gradient descent) ────────────────────────────────────

function sigmoid(z: number) { return 1 / (1 + Math.exp(-z)); }

function trainLogistic(
  X: number[][],
  y: number[],
  epochs = 3000,
  lr = 0.05,
): { weights: number[]; bias: number; aucRoc: number } {
  const n = X.length;
  const m = X[0].length;
  const w = new Array<number>(m).fill(0);
  let b = 0;

  for (let e = 0; e < epochs; e++) {
    const dw = new Array<number>(m).fill(0);
    let db = 0;
    for (let i = 0; i < n; i++) {
      const z    = w.reduce((s, wi, j) => s + wi * X[i][j], b);
      const pred = sigmoid(z);
      const err  = pred - y[i];
      for (let j = 0; j < m; j++) dw[j] += (err * X[i][j]) / n;
      db += err / n;
    }
    for (let j = 0; j < m; j++) w[j] -= lr * dw[j];
    b -= lr * db;
  }

  // AUC-ROC approximation (Wilcoxon-Mann-Whitney)
  const scores = X.map((xi, i) => ({
    score: sigmoid(w.reduce((s, wi, j) => s + wi * xi[j], b)),
    label: y[i],
  }));
  const pos = scores.filter(s => s.label === 1);
  const neg = scores.filter(s => s.label === 0);
  let wins = 0;
  for (const p of pos) for (const n2 of neg) {
    if (p.score > n2.score) wins++;
    else if (p.score === n2.score) wins += 0.5;
  }
  const aucRoc = pos.length > 0 && neg.length > 0
    ? wins / (pos.length * neg.length)
    : 0.5;

  return { weights: w, bias: b, aucRoc };
}

/** Normalize a column of values to [0, 1] range */
function normalizeColumn(values: number[]): { norm: number[]; min: number; range: number } {
  const min   = Math.min(...values);
  const max   = Math.max(...values);
  const range = max - min || 1;
  return { norm: values.map(v => (v - min) / range), min, range };
}

/** Convert raw logistic coefficients → named component weights summing to budget */
function coeffsToWeights(
  featureNames: string[],
  rawCoeffs: number[],
  groupMap: Record<string, string>, // featureName → weightKey
  budget: number,
): Record<string, number> {
  // Group coefficients by weight key, summing absolute values
  const grouped: Record<string, number> = {};
  for (let i = 0; i < featureNames.length; i++) {
    const key = groupMap[featureNames[i]] ?? featureNames[i];
    grouped[key] = (grouped[key] ?? 0) + Math.abs(rawCoeffs[i]);
  }

  // Scale to budget
  const total = Object.values(grouped).reduce((a, b) => a + b, 0);
  if (total === 0) return grouped;

  const scaled: Record<string, number> = {};
  for (const [k, v] of Object.entries(grouped)) {
    scaled[k] = Math.max(1, Math.round((v / total) * budget));
  }

  // Correct rounding drift
  const scaledTotal = Object.values(scaled).reduce((a, b) => a + b, 0);
  const drift = budget - scaledTotal;
  if (drift !== 0) {
    const largest = Object.entries(scaled).sort((a, b) => b[1] - a[1])[0][0];
    scaled[largest] += drift;
  }

  return scaled;
}

// ── Feature extraction from stored rows ───────────────────────────────────────

type OutcomeRow = {
  got_hit: boolean;
  got_hr: boolean;
  hit_score: number;
  hr_score: number;
  features: Record<string, number | null>;
};

const HIT_FEATURE_NAMES = [
  "last3AVG", "last10AVG", "hitRate20", "avgVsHand",
  "situationalAVG", "hittingStreak", "xBA", "hardHitPct",
  "last3HitsAllowed", "h2hAVG",
] as const;

const HR_FEATURE_NAMES = [
  "last3HR", "last6HR", "last10HR", "seasonSLG",
  "slgVsHand", "last10SLG", "barrelPct", "hardHitPct",
] as const;

const HIT_GROUP_MAP: Record<string, string> = {
  last3AVG:         "form",
  last10AVG:        "form",
  hitRate20:        "consistency",
  avgVsHand:        "vsHand",
  situationalAVG:   "homeAway",
  hittingStreak:    "streak",
  xBA:              "xBA",
  hardHitPct:       "hardHit",
  last3HitsAllowed: "pitcherH",
  h2hAVG:           "h2h",
};

const HR_GROUP_MAP: Record<string, string> = {
  last3HR:    "recentHR",
  last6HR:    "recentHR",
  last10HR:   "recentHR",
  seasonSLG:  "seasonSLG",
  slgVsHand:  "slgVsHand",
  last10SLG:  "recentSLG",
  barrelPct:  "barrel",
  hardHitPct: "hardHit",
};

function buildMatrix(rows: OutcomeRow[], featureNames: readonly string[]) {
  // Compute column means for imputation
  const means: Record<string, number> = {};
  for (const name of featureNames) {
    const vals = rows.map(r => r.features[name]).filter(v => v !== null) as number[];
    means[name] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  const raw: number[][] = rows.map(r =>
    featureNames.map(name => {
      const v = r.features[name];
      return v !== null && v !== undefined ? v : means[name];
    })
  );

  // Normalize each column to [0,1]
  const X: number[][] = raw[0].map((_, col) => {
    const { norm } = normalizeColumn(raw.map(row => row[col]));
    return norm;
  }).reduce((matrix: number[][], col, colIdx) => {
    col.forEach((val, rowIdx) => {
      if (!matrix[rowIdx]) matrix[rowIdx] = [];
      matrix[rowIdx][colIdx] = val;
    });
    return matrix;
  }, []);

  return X;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler() {
  const sb = supabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  console.log(`[recalibrate] Loading outcomes since ${cutoffDate}...`);

  const { data: rawRows, error } = await sb
    .from("batter_outcomes")
    .select("got_hit, got_hr, hit_score, hr_score, features")
    .gte("date", cutoffDate);

  if (error) { console.error("[recalibrate] Fetch error:", error.message); return; }
  if (!rawRows || rawRows.length < 100) {
    console.warn(`[recalibrate] Only ${rawRows?.length ?? 0} observations — need ≥100 to retrain. Skipping.`);
    return;
  }

  const rows = rawRows as OutcomeRow[];
  const n = rows.length;
  console.log(`[recalibrate] Training on ${n} observations...`);

  // ── Hit model ──────────────────────────────────────────────────────────────
  const hitY  = rows.map(r => r.got_hit ? 1 : 0);
  const hitX  = buildMatrix(rows, HIT_FEATURE_NAMES);
  const { weights: hitW, aucRoc: hitAUC } = trainLogistic(hitX, hitY);

  const hitWeights = coeffsToWeights(
    [...HIT_FEATURE_NAMES], hitW, HIT_GROUP_MAP, 85,
  );
  console.log(`[recalibrate] HIT model  AUC-ROC: ${hitAUC.toFixed(4)}`);
  console.log("[recalibrate] HIT weights:", hitWeights);

  // ── HR model ───────────────────────────────────────────────────────────────
  const hrY  = rows.map(r => r.got_hr ? 1 : 0);
  const hrX  = buildMatrix(rows, HR_FEATURE_NAMES);
  const { weights: hrW, aucRoc: hrAUC } = trainLogistic(hrX, hrY);

  const hrWeights = coeffsToWeights(
    [...HR_FEATURE_NAMES], hrW, HR_GROUP_MAP, 85,
  );
  console.log(`[recalibrate] HR  model  AUC-ROC: ${hrAUC.toFixed(4)}`);
  console.log("[recalibrate] HR  weights:", hrWeights);

  // ── Store results ──────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);

  const { error: upsertErr } = await sb
    .from("model_config")
    .upsert([
      { model: "hit", weights: hitWeights, trained_on: today, n_observations: n, auc_roc: hitAUC, updated_at: new Date().toISOString() },
      { model: "hr",  weights: hrWeights,  trained_on: today, n_observations: n, auc_roc: hrAUC,  updated_at: new Date().toISOString() },
    ], { onConflict: "model" });

  if (upsertErr) {
    console.error("[recalibrate] Failed to save weights:", upsertErr.message);
  } else {
    console.log(`[recalibrate] ✓ Weights updated in model_config. Run 'node scripts/apply-weights.mjs' to push to codebase.`);
  }
}
