/**
 * Hit Model Backtest — last 30 days
 *
 * For each snapshot date D:
 *   - Extract every batter who played that day (last10Games[0].date === D)
 *   - Reconstruct pre-game features from games BEFORE D (last10Games.slice(1))
 *   - Compute a hit score using the same logic as scores.ts
 *   - Record (features, score, actual outcome)
 *
 * Then report:
 *   1. Score calibration by band (did high scores actually produce hits?)
 *   2. Per-feature correlation with actual hit outcomes
 *   3. False positive / false negative breakdown
 *   4. Systematic blind spots
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://dshrvzwpdixzhvoncgwi.supabase.co",
  "sb_publishable_8_pzcyPHYW3FIDJ1d0oKQQ_F2sGq6Ek"
);

// ── Minimal hit score reimplemented here (mirrors scores.ts logic) ─────────────

function clamp(v, max) { return Math.min(max, Math.max(0, v)); }
function fmt3(v) { return (v === null || v === undefined || isNaN(v)) ? " ---" : v.toFixed(3).replace(/^0/, ""); }

function calcPreGameFeatures(batter, pitcher, snapshotDate) {
  // Games BEFORE today — exclude today's result to avoid data leakage
  const priorGames = (batter.last10Games ?? []).filter(g => g.date !== snapshotDate);
  const recent3  = priorGames.slice(0, 3);
  const recent10 = priorGames.slice(0, 10);

  const windowAvg = (games) => {
    const ab = games.reduce((s, g) => s + (g.atBats ?? 0), 0);
    const h  = games.reduce((s, g) => s + (g.hits ?? 0), 0);
    return ab > 0 ? h / ab : null;
  };

  const last3AVG  = windowAvg(recent3);
  const last10AVG = windowAvg(recent10);
  const hitRate10 = recent10.length > 0 ? recent10.filter(g => g.hits > 0).length / recent10.length : null;

  // Pre-game streak — count consecutive hits in priorGames (before today)
  let hittingStreak = 0;
  for (const g of priorGames) {
    if ((g.hits ?? 0) > 0) hittingStreak++;
    else break;
  }

  // Use pitcher hand to pick correct split
  const pitcherHand = pitcher?.hand ?? null;
  const avgVsHand = pitcherHand === "L" ? batter.avgVsLeft : batter.avgVsRight;

  // Home/away situational avg
  const situationalAvg = batter.isHome ? batter.homeAVG : batter.awayAVG;

  return {
    last3AVG,
    last10AVG,
    hitRate10,
    seasonAVG:     batter.seasonAVG ?? null,
    avgVsHand:     avgVsHand ?? null,
    pitcherHand,
    isHome:        batter.isHome ?? null,
    situationalAvg: (situationalAvg && situationalAvg > 0) ? situationalAvg : null,
    hittingStreak,
    xBA:           batter.xBA ?? null,
    hardHitPct:    batter.hardHitPct ?? null,
    barrelPct:     batter.barrelPct ?? null,
    last3HitsAllowed: pitcher?.last3HitsAllowed ?? null,
    h2hAVG:        (batter.vsCurrentPitcher?.atBats ?? 0) >= 5 ? batter.vsCurrentPitcher.avg : null,
    h2hAB:         batter.vsCurrentPitcher?.atBats ?? 0,
    chasePct:      batter.chasePct ?? null,
    baVsBreaking:  batter.baVsBreaking ?? null,
    hasZoneFit:    !!(batter.zoneProfile?.length && pitcher?.zoneProfile?.length),
  };
}

function computeHitScore(feat) {
  let score = 0;

  // Recent form (0–22)
  const form = (
    ((feat.last10AVG ?? 0) / 0.380) * 14 +
    ((feat.last3AVG  ?? 0) / 0.480) * 8
  );
  score += clamp(form, 22);

  // Hit consistency (0–9)
  score += clamp((feat.hitRate10 ?? 0) * 9, 9);

  // AVG vs pitcher hand (0–15)
  score += clamp(((feat.avgVsHand ?? 0) / 0.360) * 15, 15);

  // Home/away split (0–7)
  if (feat.situationalAvg !== null) score += clamp((feat.situationalAvg / 0.340) * 7, 7);

  // Streak (0–7)
  score += clamp(feat.hittingStreak * 0.85, 7);

  // xBA (0–10)
  if (feat.xBA !== null) score += clamp((feat.xBA / 0.340) * 10, 10);

  // Hard Hit% (0–4)
  if (feat.hardHitPct !== null) score += clamp((feat.hardHitPct / 55) * 4, 4);

  // Pitcher hittability (0–7)
  if (feat.last3HitsAllowed !== null) {
    const softness = Math.max(0, (feat.last3HitsAllowed - 4) / 11);
    score += clamp(softness * 7, 7);
  }

  // H2H (0–5)
  if (feat.h2hAVG !== null) score += clamp((feat.h2hAVG / 0.300) * 5, 5);

  return Math.min(100, Math.max(0, Math.round(score)));
}

// ── Data pull ──────────────────────────────────────────────────────────────────

console.log("Fetching last 30 MLB snapshots from Supabase...\n");

const { data: rows, error } = await sb
  .from("snapshots")
  .select("date, data")
  .like("date", "____-__-__")
  .order("date", { ascending: false })
  .limit(30);

if (error) { console.error(error); process.exit(1); }

console.log(`Got ${rows.length} snapshots: ${rows[rows.length-1].date} → ${rows[0].date}\n`);

// ── Build observation set ──────────────────────────────────────────────────────

const observations = [];

for (const row of rows) {
  const date = row.date;
  const games = row.data?.games ?? [];

  for (const game of games) {
    const homePitcher = game.homeStartingPitcher;
    const awayPitcher = game.awayStartingPitcher;

    for (const [lineup, opposingPitcher] of [
      [game.homeLineup, awayPitcher],
      [game.awayLineup, homePitcher],
    ]) {
      for (const batter of (lineup ?? [])) {
        // Only include batters who actually played today
        const todayGame = batter.last10Games?.[0];
        if (!todayGame || todayGame.date !== date) continue;
        if ((todayGame.atBats ?? 0) === 0) continue; // pinch runner / no AB

        const gotHit = (todayGame.hits ?? 0) > 0;
        const feat   = calcPreGameFeatures(batter, opposingPitcher, date);
        const score  = computeHitScore(feat);

        observations.push({
          date,
          name:    batter.name,
          team:    batter.teamAbbreviation ?? "",
          gotHit,
          atBats:  todayGame.atBats,
          hits:    todayGame.hits,
          score,
          feat,
        });
      }
    }
  }
}

console.log(`Total batter-game observations: ${observations.length}`);
const hitCount = observations.filter(o => o.gotHit).length;
console.log(`Overall hit rate: ${hitCount}/${observations.length} = ${(hitCount/observations.length*100).toFixed(1)}%\n`);

// ── 1. Score calibration ───────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════");
console.log(" 1. SCORE CALIBRATION — predicted score vs actual hit rate");
console.log("═══════════════════════════════════════════════════════════════");

const bands = [
  { label: "80–100 (elite)",  min: 80, max: 100 },
  { label: "70–79  (strong)", min: 70, max: 79 },
  { label: "60–69  (good)",   min: 60, max: 69 },
  { label: "50–59  (avg+)",   min: 50, max: 59 },
  { label: "40–49  (avg-)",   min: 40, max: 49 },
  { label: "< 40   (weak)",   min:  0, max: 39 },
];

for (const band of bands) {
  const subset = observations.filter(o => o.score >= band.min && o.score <= band.max);
  if (subset.length === 0) continue;
  const hits = subset.filter(o => o.gotHit).length;
  const rate = hits / subset.length;
  const bar  = "█".repeat(Math.round(rate * 20));
  console.log(`  ${band.label.padEnd(20)} ${bar.padEnd(20)} ${(rate*100).toFixed(1)}%  (n=${subset.length})`);
}

// ── 2. Per-feature correlation with actual hit ──────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 2. FEATURE → HIT RATE CORRELATION");
console.log("═══════════════════════════════════════════════════════════════");

function featureSplit(key, buckets) {
  console.log(`\n  ${key}:`);
  for (const { label, filter } of buckets) {
    const subset = observations.filter(o => filter(o.feat[key]));
    if (subset.length < 10) continue;
    const rate = subset.filter(o => o.gotHit).length / subset.length;
    console.log(`    ${label.padEnd(28)} ${(rate*100).toFixed(1)}%  (n=${subset.length})`);
  }
}

featureSplit("last3AVG", [
  { label: "≥ .400 (very hot)",    filter: v => v !== null && v >= 0.400 },
  { label: ".300–.399 (hot)",      filter: v => v !== null && v >= 0.300 && v < 0.400 },
  { label: ".200–.299 (avg)",      filter: v => v !== null && v >= 0.200 && v < 0.300 },
  { label: ".100–.199 (cold)",     filter: v => v !== null && v >= 0.100 && v < 0.200 },
  { label: "< .100 (ice cold)",    filter: v => v !== null && v < 0.100 },
  { label: "null (no prior data)", filter: v => v === null },
]);

featureSplit("last10AVG", [
  { label: "≥ .320 (excellent)",   filter: v => v !== null && v >= 0.320 },
  { label: ".260–.319 (solid)",    filter: v => v !== null && v >= 0.260 && v < 0.320 },
  { label: ".200–.259 (avg)",      filter: v => v !== null && v >= 0.200 && v < 0.260 },
  { label: "< .200 (below avg)",   filter: v => v !== null && v < 0.200 },
]);

featureSplit("avgVsHand", [
  { label: "≥ .300 (strong split)", filter: v => v !== null && v >= 0.300 },
  { label: ".250–.299",             filter: v => v !== null && v >= 0.250 && v < 0.300 },
  { label: ".200–.249",             filter: v => v !== null && v >= 0.200 && v < 0.250 },
  { label: "< .200 (bad split)",    filter: v => v !== null && v < 0.200 },
  { label: "null",                  filter: v => v === null },
]);

featureSplit("situationalAvg", [
  { label: "≥ .300 (strong H/A)",   filter: v => v !== null && v >= 0.300 },
  { label: ".250–.299",             filter: v => v !== null && v >= 0.250 && v < 0.300 },
  { label: ".200–.249",             filter: v => v !== null && v >= 0.200 && v < 0.250 },
  { label: "< .200",                filter: v => v !== null && v < 0.200 },
  { label: "null (no H/A data)",    filter: v => v === null },
]);

featureSplit("hittingStreak", [
  { label: "≥ 8 (hot streak)",      filter: v => v >= 8 },
  { label: "5–7 (active streak)",   filter: v => v >= 5 && v < 8 },
  { label: "3–4 (short streak)",    filter: v => v >= 3 && v < 5 },
  { label: "1–2",                   filter: v => v >= 1 && v < 3 },
  { label: "0 (no streak)",         filter: v => v === 0 },
]);

featureSplit("xBA", [
  { label: "≥ .320",                filter: v => v !== null && v >= 0.320 },
  { label: ".280–.319",             filter: v => v !== null && v >= 0.280 && v < 0.320 },
  { label: ".240–.279",             filter: v => v !== null && v >= 0.240 && v < 0.280 },
  { label: "< .240",                filter: v => v !== null && v < 0.240 },
  { label: "null",                  filter: v => v === null },
]);

featureSplit("last3HitsAllowed", [
  { label: "≥ 12 (very hittable)",  filter: v => v !== null && v >= 12 },
  { label: "8–11 (hittable)",       filter: v => v !== null && v >= 8 && v < 12 },
  { label: "5–7 (average)",         filter: v => v !== null && v >= 5 && v < 8 },
  { label: "0–4 (tough pitcher)",   filter: v => v !== null && v < 5 },
  { label: "null (no SP data)",     filter: v => v === null },
]);

featureSplit("hardHitPct", [
  { label: "≥ 48% (elite contact)", filter: v => v !== null && v >= 48 },
  { label: "40–47%",                filter: v => v !== null && v >= 40 && v < 48 },
  { label: "33–39%",                filter: v => v !== null && v >= 33 && v < 40 },
  { label: "< 33%",                 filter: v => v !== null && v < 33 },
]);

featureSplit("h2hAVG", [
  { label: "≥ .300 (owns pitcher)",  filter: v => v !== null && v >= 0.300 },
  { label: ".200–.299",              filter: v => v !== null && v >= 0.200 && v < 0.300 },
  { label: "< .200 (struggles)",    filter: v => v !== null && v < 0.200 },
  { label: "null (< 5 AB)",         filter: v => v === null },
]);

// ── 3. False positives — high score, no hit ────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 3. FALSE POSITIVES — score ≥ 70 but 0 hits");
console.log("═══════════════════════════════════════════════════════════════");

const falsePos = observations
  .filter(o => o.score >= 70 && !o.gotHit)
  .sort((a, b) => b.score - a.score);

console.log(`  Total: ${falsePos.length} (${(falsePos.length / observations.filter(o => o.score >= 70).length * 100).toFixed(1)}% of high-score picks)\n`);

// What do false positives have in common?
const fpAvg = key => {
  const vals = falsePos.map(o => o.feat[key]).filter(v => v !== null && v !== undefined);
  return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
};
const allAvg = key => {
  const vals = observations.map(o => o.feat[key]).filter(v => v !== null && v !== undefined);
  return vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
};

const featureKeys = ["last3AVG","last10AVG","avgVsHand","situationalAvg","xBA","hardHitPct","hittingStreak","last3HitsAllowed"];
console.log("  Feature averages — false positives vs all observations:");
console.log("  Feature".padEnd(28) + "  FP avg".padEnd(14) + "  All avg");
for (const k of featureKeys) {
  const fp  = fpAvg(k);
  const all = allAvg(k);
  if (fp === null) continue;
  const diff = fp - all;
  const flag = Math.abs(diff) > 0.02 * all ? (diff > 0 ? " ↑" : " ↓") : "";
  console.log(`  ${k.padEnd(26)}  ${String(fp?.toFixed(3) ?? "—").padEnd(12)}  ${all?.toFixed(3) ?? "—"}${flag}`);
}

console.log("\n  Top 20 highest-score no-hit days:");
console.log("  " + "Score  Name".padEnd(32) + "  L3AVG  L10AVG  vsHand  xBA   Streak  Pitcher L3H");
for (const o of falsePos.slice(0, 20)) {
  const f = o.feat;
  console.log(
    `  ${String(o.score).padEnd(5)}  ${o.name.padEnd(24)}  ` +
    `${fmt3(f.last3AVG)}  ${fmt3(f.last10AVG)}    ${fmt3(f.avgVsHand)}  ` +
    `${fmt3(f.xBA)}  ${String(f.hittingStreak).padEnd(7)} ${f.last3HitsAllowed ?? "?"}`
  );
}

// ── 4. False negatives — low score, got a hit ─────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 4. FALSE NEGATIVES — score < 40 but recorded a hit");
console.log("═══════════════════════════════════════════════════════════════");

const falseNeg = observations
  .filter(o => o.score < 40 && o.gotHit)
  .sort((a, b) => a.score - b.score);

console.log(`  Total: ${falseNeg.length} (${(falseNeg.length / observations.filter(o => o.score < 40).length * 100).toFixed(1)}% of low-score batters still got hits)\n`);

console.log("  Bottom 20 lowest-score hit days:");
console.log("  " + "Score  Name".padEnd(32) + "  L3AVG  L10AVG  vsHand  xBA   Streak  Pitcher L3H  H/A");
for (const o of falseNeg.slice(0, 20)) {
  const f = o.feat;
  console.log(
    `  ${String(o.score).padEnd(5)}  ${o.name.padEnd(24)}  ` +
    `${fmt3(f.last3AVG)}  ${fmt3(f.last10AVG)}    ${fmt3(f.avgVsHand)}  ` +
    `${fmt3(f.xBA)}  ${String(f.hittingStreak).padEnd(7)} ${String(f.last3HitsAllowed ?? "?").padEnd(12)} ` +
    `${f.isHome ? "Home" : "Away"}`
  );
}

// ── 5. Streak analysis — does hot hand hold up? ────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 5. STREAK ANALYSIS — does hot hand hold up next game?");
console.log("═══════════════════════════════════════════════════════════════");

for (let s = 0; s <= 10; s++) {
  const subset = observations.filter(o => o.feat.hittingStreak === s);
  if (subset.length < 5) continue;
  const rate = subset.filter(o => o.gotHit).length / subset.length;
  console.log(`  Streak = ${String(s).padEnd(2)}  ${(rate*100).toFixed(1).padStart(5)}%  (n=${subset.length})`);
}
const longStreak = observations.filter(o => o.feat.hittingStreak >= 11);
if (longStreak.length) {
  const rate = longStreak.filter(o => o.gotHit).length / longStreak.length;
  console.log(`  Streak ≥ 11  ${(rate*100).toFixed(1).padStart(5)}%  (n=${longStreak.length})`);
}

// ── 6. Pitcher hittability impact ─────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 6. DOES PITCHER HITTABILITY (L3 hits allowed) MATTER?");
console.log("═══════════════════════════════════════════════════════════════");

// Compare hit rate vs pitcher quality across same batter score band
for (const band of [{ label: "Score 50–70", min: 50, max: 70 }, { label: "Score 40–60", min: 40, max: 60 }]) {
  const subset = observations.filter(o => o.score >= band.min && o.score <= band.max && o.feat.last3HitsAllowed !== null);
  const tough  = subset.filter(o => o.feat.last3HitsAllowed < 6);
  const soft   = subset.filter(o => o.feat.last3HitsAllowed >= 9);
  if (tough.length < 10 || soft.length < 10) continue;
  const tRate = tough.filter(o => o.gotHit).length / tough.length;
  const sRate = soft.filter(o => o.gotHit).length  / soft.length;
  console.log(`\n  ${band.label}:`);
  console.log(`    vs tough pitchers (L3H < 6):   ${(tRate*100).toFixed(1)}%  (n=${tough.length})`);
  console.log(`    vs soft  pitchers (L3H ≥ 9):   ${(sRate*100).toFixed(1)}%  (n=${soft.length})`);
  console.log(`    Lift from pitcher quality:      ${((sRate-tRate)*100).toFixed(1)} pp`);
}

// ── 7. Missing data impact ────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 7. DATA COVERAGE — what % of observations have each feature?");
console.log("═══════════════════════════════════════════════════════════════");

const n = observations.length;
const coverage = (key) => {
  const count = observations.filter(o => o.feat[key] !== null && o.feat[key] !== undefined).length;
  return `${(count/n*100).toFixed(1)}%  (${count}/${n})`;
};

console.log(`  xBA:              ${coverage("xBA")}`);
console.log(`  hardHitPct:       ${coverage("hardHitPct")}`);
console.log(`  avgVsHand:        ${coverage("avgVsHand")}`);
console.log(`  situationalAvg:   ${coverage("situationalAvg")}`);
console.log(`  h2hAVG (≥5 AB):  ${coverage("h2hAVG")}`);
console.log(`  last3HitsAllowed: ${coverage("last3HitsAllowed")}`);
console.log(`  baVsBreaking:     ${coverage("baVsBreaking")}`);
console.log(`  chasePct:         ${coverage("chasePct")}`);
console.log(`  hasZoneFit:       ${coverage("hasZoneFit")}`);

// ── 8. Summary & recommendations ─────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 8. KEY NUMBERS SUMMARY");
console.log("═══════════════════════════════════════════════════════════════");

const topPicks = observations.filter(o => o.score >= 70);
const topHits  = topPicks.filter(o => o.gotHit).length;
console.log(`  Score ≥ 70 hit rate: ${(topHits/topPicks.length*100).toFixed(1)}%  (n=${topPicks.length})`);

const goodPicks = observations.filter(o => o.score >= 60);
const goodHits  = goodPicks.filter(o => o.gotHit).length;
console.log(`  Score ≥ 60 hit rate: ${(goodHits/goodPicks.length*100).toFixed(1)}%  (n=${goodPicks.length})`);

// Point biserial correlation for each feature vs gotHit
console.log("\n  Point-biserial r (feature vs got hit, higher = more predictive):");
for (const k of featureKeys) {
  const obs = observations.filter(o => o.feat[k] !== null);
  if (obs.length < 50) continue;
  const vals = obs.map(o => o.feat[k]);
  const outs = obs.map(o => o.gotHit ? 1 : 0);
  const mean = vals.reduce((a,b) => a+b, 0) / vals.length;
  const std  = Math.sqrt(vals.reduce((a,b) => a + (b-mean)**2, 0) / vals.length);
  const hitMean = obs.filter(o => o.gotHit).map(o => o.feat[k]).reduce((a,b) => a+b, 0) / (obs.filter(o => o.gotHit).length || 1);
  const noMean  = obs.filter(o => !o.gotHit).map(o => o.feat[k]).reduce((a,b) => a+b, 0) / (obs.filter(o => !o.gotHit).length || 1);
  const pHit = obs.filter(o => o.gotHit).length / obs.length;
  const r = ((hitMean - noMean) / (std || 1)) * Math.sqrt(pHit * (1 - pHit));
  console.log(`    ${k.padEnd(26)}  r = ${r >= 0 ? " " : ""}${r.toFixed(4)}`);
}

console.log("\nDone.\n");
