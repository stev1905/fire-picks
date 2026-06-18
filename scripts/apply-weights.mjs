/**
 * Pull the latest model weights from Supabase model_config and overwrite
 * lib/model-weights.ts. Run this after the recalibrate-model function fires.
 *
 * Usage:
 *   node scripts/apply-weights.mjs
 *   git add lib/model-weights.ts && git commit -m "chore: update model weights" && git push
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sb = createClient(
  "https://dshrvzwpdixzhvoncgwi.supabase.co",
  "sb_publishable_8_pzcyPHYW3FIDJ1d0oKQQ_F2sGq6Ek",
);

const { data, error } = await sb
  .from("model_config")
  .select("model, weights, trained_on, n_observations, auc_roc")
  .in("model", ["hit", "hr"]);

if (error || !data?.length) {
  console.error("Failed to fetch model_config:", error?.message ?? "no rows");
  process.exit(1);
}

const hit = data.find(r => r.model === "hit");
const hr  = data.find(r => r.model === "hr");

if (!hit || !hr) {
  console.error("Missing hit or hr config row. Run setup.sql in Supabase dashboard first.");
  process.exit(1);
}

const hitW = hit.weights;
const hrW  = hr.weights;

// Validate totals
const hitTotal = Object.values(hitW).reduce((a, b) => Number(a) + Number(b), 0);
const hrTotal  = Object.values(hrW).reduce((a, b) => Number(a) + Number(b), 0);

if (hitTotal !== 85 || hrTotal !== 85) {
  console.warn(`Warning: HIT total=${hitTotal}, HR total=${hrTotal} (expected 85 each).`);
  console.warn("Proceeding anyway — the recalibration rounding may have drifted slightly.");
}

const fileContent = `/**
 * Model weights for Hit Score and HR Score.
 *
 * AUTO-GENERATED — do not edit by hand.
 * Last trained: ${hit.trained_on}
 * Observations: ${hit.n_observations?.toLocaleString()}
 * Hit AUC-ROC:  ${hit.auc_roc?.toFixed(4)}
 * HR  AUC-ROC:  ${hr.auc_roc?.toFixed(4)}
 *
 * To regenerate:
 *   POST /.netlify/functions/recalibrate-model-background
 *   node scripts/apply-weights.mjs
 *   git add lib/model-weights.ts && git commit -m "chore: recalibrate model" && git push
 */

export const HIT_WEIGHTS = {
${Object.entries(hitW).map(([k, v]) => `  ${k}: ${v},`).join("\n")}
};

export const HR_WEIGHTS = {
${Object.entries(hrW).map(([k, v]) => `  ${k}: ${v},`).join("\n")}
};

// Runtime guard
const hitTotal = Object.values(HIT_WEIGHTS).reduce((a, b) => a + b, 0);
const hrTotal  = Object.values(HR_WEIGHTS).reduce((a, b)  => a + b, 0);
if (hitTotal !== 85) console.warn(\`[model-weights] HIT sum = \${hitTotal}, expected 85\`);
if (hrTotal  !== 85) console.warn(\`[model-weights] HR  sum = \${hrTotal},  expected 85\`);
`;

const outPath = join(__dirname, "../lib/model-weights.ts");
writeFileSync(outPath, fileContent, "utf8");

console.log("✓ lib/model-weights.ts updated:");
console.log(`  HIT weights (trained ${hit.trained_on}, n=${hit.n_observations?.toLocaleString()}, AUC=${hit.auc_roc?.toFixed(4)}):`);
for (const [k, v] of Object.entries(hitW)) console.log(`    ${k.padEnd(16)} ${v}`);
console.log(`  HR weights (AUC=${hr.auc_roc?.toFixed(4)}):`);
for (const [k, v] of Object.entries(hrW)) console.log(`    ${k.padEnd(16)} ${v}`);
console.log("\nNext steps:");
console.log("  git add lib/model-weights.ts");
console.log('  git commit -m "chore: recalibrate model weights"');
console.log("  git push");
