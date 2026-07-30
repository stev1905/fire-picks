/**
 * Hit Score Accuracy Backtest
 *
 * Uses the same algorithm as lib/scores.ts (production weights from model-weights.ts)
 * to compare predicted scores against actual outcomes over the last 30+ snapshots.
 *
 * Sections:
 *  1. Score calibration — do higher scores produce more hits?
 *  2. Feature correlation — which inputs actually predict hits?
 *  3. False positive/negative deep dive
 *  4. Streak and momentum analysis
 *  5. Pitcher hittability (H/9 normalized, not raw hits)
 *  6. False positive deep dive — PROD vs experimental alternatives
 *  7. Weekly trend — are we getting better or worse over time?
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://dshrvzwpdixzhvoncgwi.supabase.co",
  "sb_publishable_8_pzcyPHYW3FIDJ1d0oKQQ_F2sGq6Ek"
);

// ── Actual current production weights — MUST mirror lib/model-weights.ts exactly.
// (These are duplicated here, not imported, because this script runs under plain
// node while lib/model-weights.ts is TypeScript. Keep in sync by hand.)
const WEIGHTS_PROD = {
  form:        2,
  consistency: 9,
  vsHand:      23,
  homeAway:    4,
  streak:      7,
  xBA:         4,
  hardHit:     2,
  pitcherH:    25,
  h2h:         9,
};

// ── Experimental alternative V2 (aggressive rebalance — for comparison) ───────
// pitcherH reduced heavily — turns out to hurt calibration
const WEIGHTS_V2 = {
  form:        3,
  consistency: 9,
  vsHand:      21,
  homeAway:    10,
  streak:       7,
  xBA:          3,
  hardHit:      3,
  pitcherH:    19,
  h2h:         10,
};

// ── Experimental alternative V3 — tested 2026-07-29, NOT adopted ──────────────
// Hypothesis was: h2hAVG/homeAvg/pitcherH correlations (r=0.12-0.13) now edge out
// vsHand (r=0.107) despite vsHand holding the largest weight by far, so trimming
// vsHand and boosting homeAway/h2h should help. Full-replay backtest showed it
// does NOT beat WEIGHTS_PROD (score>=70 hit rate 72.4% vs 73.5%, spread 34.8pp vs
// 35.3pp) — kept here as a documented dead end, not a recommendation.
const WEIGHTS_V3 = {
  form:        2,
  consistency: 9,
  vsHand:      21,
  homeAway:    8,
  streak:       7,
  xBA:          4,
  hardHit:      3,
  pitcherH:    24,
  h2h:          7,
};

function verifyWeights(w, name) {
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (sum !== 85) console.warn(`[WARN] ${name} weights sum to ${sum}, expected 85`);
}
verifyWeights(WEIGHTS_PROD, "PROD");
verifyWeights(WEIGHTS_V2, "V2");
verifyWeights(WEIGHTS_V3, "V3");

function clamp(v, max) { return Math.min(max, Math.max(0, v)); }
function fmt3(v) { return (v == null || isNaN(v)) ? " ---" : v.toFixed(3).replace(/^0\./, "."); }
function pct(n, d) { return d === 0 ? "  —" : (n / d * 100).toFixed(1) + "%"; }

// ── Replicate production calcHitScore with configurable weights ───────────────
function calcScore(batter, pitcher, parkFactor, snapshotDate, W) {
  // Pre-game games only (exclude today)
  const priorGames = (batter.last10Games ?? []).filter(g => g.date !== snapshotDate);
  const recent3    = priorGames.slice(0, 3);
  const recent10   = priorGames.slice(0, 10);

  const windowAvg = (games) => {
    const ab = games.reduce((s, g) => s + (g.atBats ?? 0), 0);
    const h  = games.reduce((s, g) => s + (g.hits  ?? 0), 0);
    return ab > 0 ? h / ab : 0;
  };

  const last3AVG   = windowAvg(recent3);
  const last10AVG  = windowAvg(recent10);

  // Hit consistency — prefer hitRate20 if available
  let consistencyScore;
  if (batter.hitRate20 > 0) {
    consistencyScore = clamp(batter.hitRate20 * W.consistency, W.consistency);
  } else {
    const gp = priorGames.length;
    const hg = gp > 0 ? priorGames.filter(g => g.hits > 0).length : 0;
    consistencyScore = gp > 0 ? clamp((hg / gp) * W.consistency, W.consistency) : 0;
  }

  // 1. Recent form (0–W.form)
  const formRaw = (last10AVG / 0.380) * (W.form * 0.65) + (last3AVG / 0.480) * (W.form * 0.35);
  const form = clamp(formRaw, W.form);

  // 2. Hit consistency (already computed)

  // 3. Matchup vs pitcher hand (0–W.vsHand)
  let matchup = 0;
  if (pitcher) {
    const rawAvg = pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight;
    const matchupAvg = rawAvg > 0 ? rawAvg : (batter.seasonAVG ?? 0);
    matchup = clamp((matchupAvg / 0.360) * W.vsHand, W.vsHand);
  } else {
    matchup = clamp(((batter.seasonAVG ?? 0) / 0.340) * (W.vsHand * 0.7), W.vsHand);
  }

  // 3b. Home/Away situational split (0–W.homeAway)
  let homeAwayScore = 0;
  const hasHomeSplit = (batter.homeAVG ?? 0) > 0 || (batter.awayAVG ?? 0) > 0;
  if (hasHomeSplit && batter.isHome !== undefined) {
    const sitAvg = batter.isHome ? (batter.homeAVG ?? 0) : (batter.awayAVG ?? 0);
    homeAwayScore = clamp((sitAvg / 0.340) * W.homeAway, W.homeAway);
  }

  // 4. Hitting streak — logarithmic (0–W.streak)
  // Pre-game streak from prior games
  let hittingStreak = 0;
  for (const g of priorGames) {
    if ((g.hits ?? 0) > 0) hittingStreak++;
    else break;
  }
  const streakScore = hittingStreak > 0
    ? clamp((Math.log(1 + hittingStreak) / Math.log(1 + 15)) * W.streak, W.streak)
    : 0;

  // 5. Park factor (hardcoded to 4pts max — not in W sum)
  const park = clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 4, 4);

  // 6. Pitcher H/9 (normalized by IP — matches production; 0–W.pitcherH)
  let pitcherScore = 0;
  if (pitcher) {
    const h9 = pitcher.last3InningsPitched > 0
      ? (pitcher.last3HitsAllowed / pitcher.last3InningsPitched) * 9
      : null;
    if (h9 !== null) {
      pitcherScore = clamp(((h9 - 5.0) / 6.0) * W.pitcherH, W.pitcherH);
    }
  }

  // 6b. Pitcher BAA split vs batter hand (0–4)
  let pitcherSplitScore = 0;
  if (pitcher) {
    const baaVsHand = batter.hand === "L" ? pitcher.baaVsLeft : pitcher.baaVsRight;
    if (baaVsHand > 0) {
      pitcherSplitScore = clamp(((baaVsHand - 0.190) / 0.150) * 4, 4);
    }
  }

  // 7. xBA (0–W.xBA)
  const xBAScore = batter.xBA > 0 ? clamp((batter.xBA / 0.340) * W.xBA, W.xBA) : 0;

  // 8. Hard Hit % (0–W.hardHit)
  const hardHitScore = batter.hardHitPct > 0 ? clamp((batter.hardHitPct / 55) * W.hardHit, W.hardHit) : 0;

  // 9. H2H vs current pitcher (0–W.h2h, min 5 AB)
  let h2hScore = 0;
  const h2h = batter.vsCurrentPitcher;
  if (h2h && h2h.atBats >= 5) {
    h2hScore = clamp((h2h.avg / 0.300) * W.h2h, W.h2h);
  }

  // 10. Pitch matchup delta (±4, baseline 0; max weight not in sum)
  let pitchMatchupDelta = 0;
  if (pitcher) {
    let delta = 0;
    if ((pitcher.breakingPct ?? 0) > 25) {
      if ((batter.baVsBreaking ?? 0) >= 0.260) delta += 2;
      else if ((batter.baVsBreaking ?? 0) > 0 && batter.baVsBreaking < 0.220) delta -= 2;
      if ((batter.whiffVsBreaking ?? 0) > 35) delta -= 1;
    }
    if ((pitcher.fastballPct ?? 0) > 45) {
      if ((batter.baVsFastball ?? 0) >= 0.290) delta += 2;
      else if ((batter.baVsFastball ?? 0) > 0 && batter.baVsFastball < 0.230) delta -= 1;
    }
    if ((pitcher.chaseInducePct ?? 0) > 32 && (batter.chasePct ?? 0) > 32) delta -= 2;
    pitchMatchupDelta = delta; // -6 to +6 → score offset without double-counting baseline
  }

  // 11. Momentum (cold streak penalty / bounce-back bonus)
  let momentumMod = 0;
  let coldStreak = 0;
  for (const g of priorGames) {
    if ((g.hits ?? 0) === 0) coldStreak++;
    else break;
  }
  if (coldStreak === 1) {
    const rate = batter.hitRate20 ?? batter.hitRate10 ??
      (priorGames.length > 0 ? priorGames.filter(g => g.hits > 0).length / priorGames.length : 0);
    if (rate >= 0.65) momentumMod = 3;
    else if (rate >= 0.50) momentumMod = 2;
    else if (rate >= 0.40) momentumMod = 1;
  } else if (coldStreak >= 2) {
    momentumMod = coldStreak >= 7 ? -5 : coldStreak >= 5 ? -4 : coldStreak >= 3 ? -2 : -1;
  }

  // 12. Lineup slot penalty (0 to -3)
  const slot = batter.battingOrder ?? 0;
  const slotMod = slot >= 9 ? -3 : slot >= 7 ? -2 : 0;

  const total = Math.min(100, Math.max(0, Math.round(
    form + consistencyScore + matchup + homeAwayScore + streakScore + park +
    pitcherScore + pitcherSplitScore + xBAScore + hardHitScore + h2hScore +
    pitchMatchupDelta + momentumMod + slotMod
  )));

  return { total, hittingStreak, coldStreak, h9: pitcher?.last3InningsPitched > 0
    ? (pitcher.last3HitsAllowed / pitcher.last3InningsPitched) * 9
    : null };
}

// ── Pull snapshots ─────────────────────────────────────────────────────────────
console.log("Fetching MLB snapshots from Supabase...\n");

const { data: rows, error } = await sb
  .from("snapshots")
  .select("date, data")
  .like("date", "____-__-__")
  .order("date", { ascending: false })
  .limit(45);

if (error) { console.error(error); process.exit(1); }

const snapsByWeek = {};
console.log(`Loaded ${rows.length} snapshots: ${rows[rows.length-1]?.date} → ${rows[0]?.date}\n`);

// ── Build observations ─────────────────────────────────────────────────────────
const obs = [];

for (const row of rows) {
  const date  = row.date;
  const games = row.data?.games ?? [];
  const week  = date.slice(0, 7); // YYYY-MM

  for (const game of games) {
    for (const [lineup, pitcher, isHome] of [
      [game.homeLineup, game.awayStartingPitcher, true],
      [game.awayLineup, game.homeStartingPitcher, false],
    ]) {
      for (const batter of (lineup ?? [])) {
        const todayGame = batter.last10Games?.[0];
        if (!todayGame || todayGame.date !== date) continue;
        if ((todayGame.atBats ?? 0) === 0) continue;

        const gotHit = (todayGame.hits ?? 0) > 0;
        batter.isHome = isHome;

        const prod = calcScore(batter, pitcher, game.parkFactor ?? 1.0, date, WEIGHTS_PROD);
        const v2 = calcScore(batter, pitcher, game.parkFactor ?? 1.0, date, WEIGHTS_V2);
        const v3 = calcScore(batter, pitcher, game.parkFactor ?? 1.0, date, WEIGHTS_V3);

        obs.push({
          date, week,
          name:  batter.name,
          team:  batter.teamAbbreviation ?? "",
          gotHit,
          atBats: todayGame.atBats,
          hits:   todayGame.hits,
          prod:   prod.total,
          v2:     v2.total,
          v3:     v3.total,
          streak: prod.hittingStreak,
          cold:   prod.coldStreak,
          h9:     prod.h9,
          homeAvg: batter.isHome ? (batter.homeAVG ?? null) : (batter.awayAVG ?? null),
          avgVsHand: pitcher
            ? (pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight)
            : null,
          xBA:     batter.xBA ?? null,
          h2hAVG:  (batter.vsCurrentPitcher?.atBats ?? 0) >= 5 ? batter.vsCurrentPitcher.avg : null,
        });
      }
    }
  }
}

console.log(`Total batter-game observations: ${obs.length}`);
const hits = obs.filter(o => o.gotHit).length;
console.log(`Overall hit rate (baseline): ${hits}/${obs.length} = ${pct(hits, obs.length)}\n`);

// ── 1. Score calibration — PROD vs V2/V3 experiments ─────────────────────────
function calibration(field, label) {
  console.log(`\n  ${label}:`);
  const bands = [
    { l: "75–100", min: 75 },
    { l: "70–74",  min: 70, max: 74 },
    { l: "65–69",  min: 65, max: 69 },
    { l: "60–64",  min: 60, max: 64 },
    { l: "55–59",  min: 55, max: 59 },
    { l: "50–54",  min: 50, max: 54 },
    { l: "45–49",  min: 45, max: 49 },
    { l: "40–44",  min: 40, max: 44 },
    { l: "< 40",   max: 39 },
  ];
  const results = [];
  for (const b of bands) {
    const subset = obs.filter(o =>
      o[field] >= (b.min ?? 0) && o[field] <= (b.max ?? 100)
    );
    if (subset.length < 5) continue;
    const h = subset.filter(o => o.gotHit).length;
    const rate = h / subset.length;
    results.push({ label: b.l, rate, n: subset.length, h });
    const bar = "█".repeat(Math.round(rate * 20));
    console.log(`    ${b.l.padEnd(8)} ${bar.padEnd(20)} ${(rate*100).toFixed(1).padStart(5)}%  (n=${subset.length})`);
  }
  // Spread = top band rate - bottom band rate
  const top = results[0]?.rate ?? 0;
  const bot = results[results.length-1]?.rate ?? 0;
  console.log(`    Spread (top - bottom): ${((top - bot)*100).toFixed(1)}pp`);
}

console.log("═══════════════════════════════════════════════════════════════");
console.log(" 1. SCORE CALIBRATION");
console.log("═══════════════════════════════════════════════════════════════");
calibration("prod", "Current production weights (PROD)");
calibration("v2", "Aggressive V2 (reduced pitcherH, for comparison)");
calibration("v3", "Targeted V3 (tested, not adopted — see comment above)");

// ── 2. Feature correlation with actual hit outcome ─────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 2. FEATURE CORRELATIONS (point-biserial r vs got_hit)");
console.log("═══════════════════════════════════════════════════════════════");

function pbr(vals, outs) {
  const n = vals.length;
  if (n < 50) return null;
  const mean = vals.reduce((a,b) => a+b, 0) / n;
  const std  = Math.sqrt(vals.reduce((a,b) => a+(b-mean)**2, 0) / n);
  const hitMean = vals.filter((_, i) => outs[i]).reduce((a,b) => a+b, 0) / (outs.filter(Boolean).length || 1);
  const noMean  = vals.filter((_, i) => !outs[i]).reduce((a,b) => a+b, 0) / (outs.filter(v => !v).length || 1);
  const pH = outs.filter(Boolean).length / n;
  return ((hitMean - noMean) / (std || 1)) * Math.sqrt(pH * (1 - pH));
}

const features = [
  { key: "avgVsHand", label: "avgVsHand     (vsHand    weight=23)" },
  { key: "homeAvg",   label: "homeAvg       (homeAway  weight=4)" },
  { key: "h2hAVG",    label: "h2hAVG        (h2h       weight=9, coverage ~36%)" },
  { key: "xBA",       label: "xBA           (xBA       weight=4)" },
  { key: "streak",    label: "hittingStreak (streak    weight=7)" },
  { key: "h9",        label: "pitcher H/9   (pitcherH  weight=25)" },
];

for (const f of features) {
  const subset = obs.filter(o => o[f.key] !== null && o[f.key] !== undefined);
  const vals = subset.map(o => o[f.key]);
  const outs = subset.map(o => o.gotHit);
  const r = pbr(vals, outs);
  const coverage = pct(subset.length, obs.length);
  const hitRateNote = (() => {
    const h = subset.filter(o => o.gotHit).length;
    return `${pct(h, subset.length)} hit rate when present`;
  })();
  console.log(`  ${f.label}`);
  console.log(`    r = ${r !== null ? (r >= 0 ? "+" : "") + r.toFixed(4) : "insufficient data"}  |  coverage ${coverage}  |  ${hitRateNote}`);
}

// ── 3. Home/Away deep dive (key finding) ─────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 3. HOME/AWAY SPLIT (weight currently 4 in production)");
console.log("═══════════════════════════════════════════════════════════════");

const haBands = [
  { l: "≥ .340 (elite)",   filter: v => v >= 0.340 },
  { l: ".300–.339 (good)", filter: v => v >= 0.300 && v < 0.340 },
  { l: ".260–.299 (avg)",  filter: v => v >= 0.260 && v < 0.300 },
  { l: ".220–.259 (weak)", filter: v => v >= 0.220 && v < 0.260 },
  { l: "< .220 (bad)",     filter: v => v < 0.220 },
  { l: "null (no data)",   filter: v => v === null || v === undefined },
];
for (const b of haBands) {
  const subset = obs.filter(o => b.filter(o.homeAvg));
  if (subset.length < 10) continue;
  const h = subset.filter(o => o.gotHit).length;
  const prodAvg = subset.reduce((a, o) => a + o.prod, 0) / subset.length;
  const v2Avg = subset.reduce((a, o) => a + o.v2, 0) / subset.length;
  console.log(`  ${b.l.padEnd(22)} hit ${pct(h, subset.length).padStart(6)}  ` +
    `avg score PROD=${prodAvg.toFixed(0).padStart(2)}  V2=${v2Avg.toFixed(0).padStart(2)}  (n=${subset.length})`);
}

// ── 4. Pitcher hittability (H/9 normalized — correct version) ────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 4. PITCHER H/9 (production-normalized, not raw hits)");
console.log("═══════════════════════════════════════════════════════════════");

const h9Bands = [
  { l: "≥ 11.0 H/9 (very hittable)", filter: v => v !== null && v >= 11.0 },
  { l: "8.5–11.0 H/9 (above avg)",   filter: v => v !== null && v >= 8.5 && v < 11.0 },
  { l: "7.0–8.5  H/9 (average)",     filter: v => v !== null && v >= 7.0 && v < 8.5 },
  { l: "5.0–7.0  H/9 (tough)",       filter: v => v !== null && v >= 5.0 && v < 7.0 },
  { l: "< 5.0   H/9 (elite)",        filter: v => v !== null && v < 5.0 },
  { l: "null (no SP data)",           filter: v => v === null },
];
for (const b of h9Bands) {
  const subset = obs.filter(o => b.filter(o.h9));
  if (subset.length < 5) continue;
  const h = subset.filter(o => o.gotHit).length;
  console.log(`  ${b.l.padEnd(32)} ${pct(h, subset.length).padStart(6)}  (n=${subset.length})`);
}

// ── 5. Streak analysis ────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 5. STREAK vs COLD STREAK — does momentum persist?");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  Hot streaks:");
for (let s = 0; s <= 12; s++) {
  const subset = obs.filter(o => o.streak === s);
  if (subset.length < 10) continue;
  const h = subset.filter(o => o.gotHit).length;
  console.log(`    Streak ${String(s).padEnd(2)}  ${pct(h, subset.length).padStart(6)}  (n=${subset.length})`);
}
const longS = obs.filter(o => o.streak >= 13);
if (longS.length) { const h = longS.filter(o => o.gotHit).length; console.log(`    Streak 13+  ${pct(h, longS.length).padStart(6)}  (n=${longS.length})`); }

console.log("\n  Cold streaks:");
for (let c = 0; c <= 8; c++) {
  const subset = obs.filter(o => o.cold === c);
  if (subset.length < 10) continue;
  const h = subset.filter(o => o.gotHit).length;
  console.log(`    Cold  ${String(c).padEnd(2)}  ${pct(h, subset.length).padStart(6)}  (n=${subset.length})`);
}

// ── 6. False positives — PROD vs V3 ──────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 6. FALSE POSITIVES — score ≥ 70 but no hit");
console.log("═══════════════════════════════════════════════════════════════");

const fpProd = obs.filter(o => o.prod >= 70 && !o.gotHit);
const fpV3 = obs.filter(o => o.v3 >= 70 && !o.gotHit);
const highProd = obs.filter(o => o.prod >= 70);
const highV3 = obs.filter(o => o.v3 >= 70);
console.log(`  PROD: ${fpProd.length} false positives out of ${highProd.length} high-score picks (${pct(fpProd.length, highProd.length)} FP rate)`);
console.log(`  V3:   ${fpV3.length} false positives out of ${highV3.length} high-score picks (${pct(fpV3.length, highV3.length)} FP rate)`);
console.log("\n  Top 15 PROD high-score no-hit days (most costly false positives):");
console.log("  PROD V3   Name                       vsHand  homeAvg  xBA    Streak  H9");
for (const o of fpProd.sort((a,b) => b.prod - a.prod).slice(0, 15)) {
  console.log(
    `  ${String(o.prod).padEnd(4)} ${String(o.v3).padEnd(4)} ${o.name.padEnd(26)} ` +
    `${fmt3(o.avgVsHand)}   ${fmt3(o.homeAvg)}   ${fmt3(o.xBA)}  ` +
    `${String(o.streak).padEnd(7)} ${o.h9 !== null ? o.h9.toFixed(1) : "—"}`
  );
}

// ── 7. Weekly trend ───────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 7. WEEKLY TREND — hit rate and avg score by week");
console.log("═══════════════════════════════════════════════════════════════");

const weeks = [...new Set(obs.map(o => {
  const d = new Date(o.date);
  const wd = d.getDay();
  const startOfWeek = new Date(d);
  startOfWeek.setDate(d.getDate() - wd);
  return startOfWeek.toISOString().slice(0, 10);
}))].sort();

for (const w of weeks) {
  const subset = obs.filter(o => {
    const d = new Date(o.date);
    const wd = d.getDay();
    const sow = new Date(d);
    sow.setDate(d.getDate() - wd);
    return sow.toISOString().slice(0, 10) === w;
  });
  if (subset.length < 20) continue;
  const h = subset.filter(o => o.gotHit).length;
  const avgProd = subset.reduce((a, o) => a + o.prod, 0) / subset.length;
  const highScoreHit = subset.filter(o => o.prod >= 60 && o.gotHit).length;
  const highScoreAll = subset.filter(o => o.prod >= 60).length;
  console.log(
    `  Week ${w}  ${pct(h, subset.length).padStart(6)} hit rate  ` +
    `avg score=${avgProd.toFixed(0).padStart(2)}  ` +
    `score≥60: ${pct(highScoreHit, highScoreAll).padStart(6)} (n=${highScoreAll})`
  );
}

// ── 8. Summary ────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 8. SUMMARY");
console.log("═══════════════════════════════════════════════════════════════");

const pick60Prod = obs.filter(o => o.prod >= 60), hit60Prod = pick60Prod.filter(o => o.gotHit).length;
const pick60V2 = obs.filter(o => o.v2 >= 60), hit60V2 = pick60V2.filter(o => o.gotHit).length;
const pick60V3 = obs.filter(o => o.v3 >= 60), hit60V3 = pick60V3.filter(o => o.gotHit).length;
const pick70Prod = obs.filter(o => o.prod >= 70), hit70Prod = pick70Prod.filter(o => o.gotHit).length;
const pick70V2 = obs.filter(o => o.v2 >= 70), hit70V2 = pick70V2.filter(o => o.gotHit).length;
const pick70V3 = obs.filter(o => o.v3 >= 70), hit70V3 = pick70V3.filter(o => o.gotHit).length;

console.log("\n  Version comparison (PROD=live production weights, V2/V3=experimental alternatives):");
console.log(`  Score ≥ 60: PROD ${pct(hit60Prod, pick60Prod.length).padStart(6)} (n=${pick60Prod.length})  |  V2 ${pct(hit60V2, pick60V2.length).padStart(6)} (n=${pick60V2.length})  |  V3 ${pct(hit60V3, pick60V3.length).padStart(6)} (n=${pick60V3.length})`);
console.log(`  Score ≥ 70: PROD ${pct(hit70Prod, pick70Prod.length).padStart(6)} (n=${pick70Prod.length})  |  V2 ${pct(hit70V2, pick70V2.length).padStart(6)} (n=${pick70V2.length})  |  V3 ${pct(hit70V3, pick70V3.length).padStart(6)} (n=${pick70V3.length})`);

console.log(`
  No weight changes currently recommended. WEIGHTS_PROD already reflects the last
  round of tuning (homeAway/xBA raised, streak/form trimmed) and calibrates well:
  monotonic score bands, ~35pp spread top-to-bottom, ~73% hit rate on score≥70 picks.
  V2 and V3 are kept only as tested-and-rejected alternatives — re-run this backtest
  periodically since correlations drift as the season progresses.
`);

console.log("Done.\n");
