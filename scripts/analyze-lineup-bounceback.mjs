/**
 * Lineup Position & Bounce-back Analysis
 *
 * Investigates two hypotheses:
 *   A) Do batters in slots 7-9 underperform their model score vs slots 1-6?
 *   B) Does being hitless the prior game have a meaningful effect on next-day hit rate?
 *
 * Pulls from the snapshots table (same source as analyze-hit-model.mjs).
 * battingOrder is available on every batter in the lineup arrays.
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://dshrvzwpdixzhvoncgwi.supabase.co",
  "sb_publishable_8_pzcyPHYW3FIDJ1d0oKQQ_F2sGq6Ek"
);

function clamp(v, max) { return Math.min(max, Math.max(0, v)); }
function pct(n, d) { return d === 0 ? "—" : (n / d * 100).toFixed(1) + "%"; }
function fmt(v, dec = 3) { return (v == null || isNaN(v)) ? "  ---" : v.toFixed(dec); }

// ── Minimal hit score (mirrors scores.ts / outcomes.ts logic) ─────────────────

function buildFeatures(batter, pitcher, today) {
  const prior   = (batter.last10Games ?? []).filter(g => g.date !== today);
  const recent3  = prior.slice(0, 3);
  const recent10 = prior.slice(0, 10);

  const windowAvg = (games) => {
    const ab = games.reduce((s, g) => s + (g.atBats ?? 0), 0);
    const h  = games.reduce((s, g) => s + (g.hits   ?? 0), 0);
    return ab > 0 ? h / ab : null;
  };

  const last3AVG  = windowAvg(recent3);
  const last10AVG = windowAvg(recent10);
  const hitRate10 = recent10.length > 0
    ? recent10.filter(g => g.hits > 0).length / recent10.length
    : null;
  const hitRate20 = batter.hitRate20 ?? null;

  let hittingStreak = 0;
  for (const g of prior) {
    if ((g.hits ?? 0) > 0) hittingStreak++;
    else break;
  }

  // Was the batter hitless specifically yesterday (prior[0])?
  const hitlessYesterday = prior.length > 0 ? (prior[0].hits ?? 0) === 0 : null;
  // How many consecutive hitless days leading up to today?
  let coldStreak = 0;
  for (const g of prior) {
    if ((g.hits ?? 0) === 0) coldStreak++;
    else break;
  }

  const pitcherHand = pitcher?.hand ?? null;
  const rawVsHand   = pitcherHand === "L" ? batter.avgVsLeft : batter.avgVsRight;
  const avgVsHand   = (rawVsHand && rawVsHand > 0) ? rawVsHand : (batter.seasonAVG ?? null);
  const situationalAVG = batter.isHome
    ? (batter.homeAVG && batter.homeAVG > 0 ? batter.homeAVG : null)
    : (batter.awayAVG && batter.awayAVG > 0 ? batter.awayAVG : null);
  const h2hAVG = (batter.vsCurrentPitcher?.atBats ?? 0) >= 5
    ? batter.vsCurrentPitcher.avg
    : null;

  return {
    last3AVG,
    last10AVG,
    hitRate10,
    hitRate20,
    avgVsHand,
    situationalAVG,
    hittingStreak,
    hitlessYesterday,
    coldStreak,
    xBA:              batter.xBA         ?? null,
    hardHitPct:       batter.hardHitPct  ?? null,
    last3HitsAllowed: pitcher?.last3HitsAllowed ?? null,
    h2hAVG,
    seasonAVG:        batter.seasonAVG   ?? null,
  };
}

function computeHitScore(f, parkFactor = 1.0) {
  let s = 0;
  const form = ((f.last10AVG ?? 0) / 0.380) * 13 + ((f.last3AVG ?? 0) / 0.480) * 7;
  s += clamp(form, 20);
  const cr = f.hitRate20 ?? f.hitRate10 ?? 0;
  s += clamp(cr * 18, 18);
  s += clamp(((f.avgVsHand ?? 0) / 0.360) * 16, 16);
  if (f.situationalAVG !== null) s += clamp((f.situationalAVG / 0.340) * 7, 7);
  if (f.hittingStreak > 0) s += clamp((Math.log(1 + f.hittingStreak) / Math.log(16)) * 5, 5);
  s += clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 4, 4);
  if (f.last3HitsAllowed !== null) s += clamp(Math.max(0, (f.last3HitsAllowed - 4) / 11) * 4, 4);
  if (f.xBA !== null) s += clamp((f.xBA / 0.340) * 9, 9);
  if (f.hardHitPct !== null) s += clamp((f.hardHitPct / 55) * 3, 3);
  if (f.h2hAVG !== null) s += clamp((f.h2hAVG / 0.300) * 3, 3);
  return Math.min(100, Math.max(0, Math.round(s)));
}

// ── Fetch data ────────────────────────────────────────────────────────────────

console.log("Fetching last 60 snapshots from Supabase...\n");

const { data: rows, error } = await sb
  .from("snapshots")
  .select("date, data")
  .like("date", "____-__-__")
  .order("date", { ascending: false })
  .limit(60);

if (error) { console.error(error); process.exit(1); }
console.log(`Got ${rows.length} snapshots: ${rows.at(-1).date} → ${rows[0].date}\n`);

// ── Build observations ─────────────────────────────────────────────────────────

const obs = [];

for (const row of rows) {
  const date  = row.date;
  const games = row.data?.games ?? [];

  for (const game of games) {
    const pairs = [
      [game.homeLineup, game.awayStartingPitcher],
      [game.awayLineup, game.homeStartingPitcher],
    ];
    for (const [lineup, pitcher] of pairs) {
      for (const batter of (lineup ?? [])) {
        const todayGame = batter.last10Games?.[0];
        if (!todayGame || todayGame.date !== date) continue;
        if ((todayGame.atBats ?? 0) === 0) continue;

        const feat  = buildFeatures(batter, pitcher, date);
        const score = computeHitScore(feat, game.parkFactor ?? 1.0);
        const slot  = batter.battingOrder ?? null;   // 1–9

        obs.push({
          date,
          name:    batter.name,
          gotHit:  (todayGame.hits ?? 0) > 0,
          atBats:  todayGame.atBats,
          hits:    todayGame.hits ?? 0,
          score,
          slot,
          feat,
        });
      }
    }
  }
}

const n    = obs.length;
const hits = obs.filter(o => o.gotHit).length;
console.log(`Observations: ${n}   Overall hit rate: ${pct(hits, n)}\n`);

// ══════════════════════════════════════════════════════════════════════════════
// PART A: LINEUP SLOT ANALYSIS
// ══════════════════════════════════════════════════════════════════════════════

console.log("╔═══════════════════════════════════════════════════════════════╗");
console.log("║  PART A — LINEUP POSITION ANALYSIS                           ║");
console.log("╚═══════════════════════════════════════════════════════════════╝\n");

// A1: Hit rate by batting slot
console.log("A1. Hit rate by batting slot:");
console.log("  Slot   n      Hit%    Avg AB   Avg Score   L10AVG");
console.log("  ────  ────  ───────  ───────  ──────────  ──────");

for (let slot = 1; slot <= 9; slot++) {
  const sub = obs.filter(o => o.slot === slot);
  if (sub.length < 5) continue;
  const hr   = sub.filter(o => o.gotHit).length;
  const avgAB    = sub.reduce((s, o) => s + o.atBats, 0) / sub.length;
  const avgScore = sub.reduce((s, o) => s + o.score, 0) / sub.length;
  const avgL10   = sub.map(o => o.feat.last10AVG).filter(v => v !== null);
  const meanL10  = avgL10.length ? avgL10.reduce((a, b) => a + b) / avgL10.length : null;
  console.log(
    `   ${slot}     ${String(sub.length).padEnd(5)} ${pct(hr, sub.length).padStart(6)}   ` +
    `${avgAB.toFixed(2).padStart(5)}    ${avgScore.toFixed(1).padStart(6)}      ${fmt(meanL10)}`
  );
}

// A2: Slots grouped 1-3 / 4-6 / 7-9
console.log("\nA2. Hit rate by lineup group:");
const groups = [
  { label: "Top    (1–3)", min: 1, max: 3 },
  { label: "Middle (4–6)", min: 4, max: 6 },
  { label: "Bottom (7–9)", min: 7, max: 9 },
];
for (const g of groups) {
  const sub = obs.filter(o => o.slot >= g.min && o.slot <= g.max);
  const hr  = sub.filter(o => o.gotHit).length;
  const avgAB    = sub.length ? sub.reduce((s, o) => s + o.atBats, 0) / sub.length : 0;
  const avgScore = sub.length ? sub.reduce((s, o) => s + o.score, 0) / sub.length : 0;
  const l10vals  = sub.map(o => o.feat.last10AVG).filter(v => v !== null);
  const meanL10  = l10vals.length ? l10vals.reduce((a, b) => a + b) / l10vals.length : null;
  console.log(
    `  ${g.label}   n=${String(sub.length).padEnd(5)} hit=${pct(hr, sub.length).padStart(6)}` +
    `  avg_AB=${avgAB.toFixed(2)}  avg_score=${avgScore.toFixed(1)}  avg_L10=${fmt(meanL10)}`
  );
}

// A3: For a given score band, do bottom-of-order batters underperform?
// i.e. is there score-inflation for 7-9 hitters?
console.log("\nA3. Score band accuracy — top order (1-6) vs bottom (7-9):");
const bands = [
  { label: "≥ 70", min: 70, max: 100 },
  { label: "60–69", min: 60, max: 69 },
  { label: "50–59", min: 50, max: 59 },
  { label: "40–49", min: 40, max: 49 },
  { label: "< 40",  min:  0, max: 39 },
];
console.log("  Band    Top-order hit%  (n)      Bottom-order hit%  (n)     Δ");
for (const b of bands) {
  const top = obs.filter(o => o.score >= b.min && o.score <= b.max && o.slot >= 1 && o.slot <= 6);
  const bot = obs.filter(o => o.score >= b.min && o.score <= b.max && o.slot >= 7 && o.slot <= 9);
  if (top.length < 10 || bot.length < 10) continue;
  const tR = top.filter(o => o.gotHit).length / top.length;
  const bR = bot.filter(o => o.gotHit).length / bot.length;
  const delta = (bR - tR) * 100;
  const flag  = Math.abs(delta) >= 3 ? (delta < 0 ? " ← bottom underperforms" : " ← bottom overperforms") : "";
  console.log(
    `  ${b.label.padEnd(6)}  ${(tR*100).toFixed(1)}%  (${String(top.length).padEnd(4)})    ` +
    `${(bR*100).toFixed(1)}%  (${String(bot.length).padEnd(4)})    ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp${flag}`
  );
}

// A4: Avg ABs per game by slot group — explains the raw hit probability gap
console.log("\nA4. Average at-bats per game by slot group (more AB → higher raw hit probability):");
for (const g of groups) {
  const sub = obs.filter(o => o.slot >= g.min && o.slot <= g.max && o.atBats > 0);
  if (!sub.length) continue;
  const ab = sub.reduce((s, o) => s + o.atBats, 0) / sub.length;
  // Expected hit rate given avg AB count and avg L10 AVG for this group
  const l10vals = sub.map(o => o.feat.last10AVG).filter(v => v !== null);
  const avgAVG  = l10vals.length ? l10vals.reduce((a, b) => a + b) / l10vals.length : null;
  const expHit  = avgAVG !== null ? 1 - Math.pow(1 - avgAVG, ab) : null;
  console.log(
    `  ${g.label}   avg AB=${ab.toFixed(2)}   avg L10AVG=${fmt(avgAVG)}   ` +
    `expected hit/game=${expHit !== null ? (expHit * 100).toFixed(1) + "%" : "—"}`
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PART B: BOUNCE-BACK / HITLESS YESTERDAY ANALYSIS
// ══════════════════════════════════════════════════════════════════════════════

console.log("\n╔═══════════════════════════════════════════════════════════════╗");
console.log("║  PART B — HITLESS YESTERDAY (BOUNCE-BACK) ANALYSIS           ║");
console.log("╚═══════════════════════════════════════════════════════════════╝\n");

const withPrior = obs.filter(o => o.feat.hitlessYesterday !== null);
const hitless   = withPrior.filter(o => o.feat.hitlessYesterday === true);
const hadHit    = withPrior.filter(o => o.feat.hitlessYesterday === false);

console.log("B1. Raw hit rate: hitless yesterday vs had a hit yesterday:");
console.log(`  Had a hit yesterday:     ${pct(hadHit.filter(o => o.gotHit).length, hadHit.length).padStart(6)}  (n=${hadHit.length})`);
console.log(`  Hitless yesterday:       ${pct(hitless.filter(o => o.gotHit).length, hitless.length).padStart(6)}  (n=${hitless.length})`);

// B2: Cold streak length vs next-day hit rate
console.log("\nB2. Hit rate by consecutive hitless days (cold streak entering today):");
console.log("  Cold streak   Hit%    n");
for (let cs = 0; cs <= 6; cs++) {
  const sub = withPrior.filter(o => o.feat.coldStreak === cs);
  if (sub.length < 10) continue;
  const hr = sub.filter(o => o.gotHit).length;
  const bar = "█".repeat(Math.round(hr / sub.length * 20));
  console.log(`     ${String(cs).padEnd(3)}         ${pct(hr, sub.length).padStart(6)}  (n=${sub.length})  ${bar}`);
}
const longCold = withPrior.filter(o => o.feat.coldStreak >= 7);
if (longCold.length >= 5) {
  console.log(`    ≥ 7          ${pct(longCold.filter(o => o.gotHit).length, longCold.length).padStart(6)}  (n=${longCold.length})`);
}

// B3: Bounce-back segmented by hitter quality (hitRate20 tier)
console.log("\nB3. Hitless-yesterday hit rate by hitter quality tier:");
const qualityBuckets = [
  { label: "Elite   (hitRate20 ≥ .70)", filter: f => (f.hitRate20 ?? f.hitRate10 ?? 0) >= 0.70 },
  { label: "Good    (.55–.69)",          filter: f => { const r = f.hitRate20 ?? f.hitRate10 ?? 0; return r >= 0.55 && r < 0.70; } },
  { label: "Average (.40–.54)",          filter: f => { const r = f.hitRate20 ?? f.hitRate10 ?? 0; return r >= 0.40 && r < 0.55; } },
  { label: "Cold    (< .40)",            filter: f => (f.hitRate20 ?? f.hitRate10 ?? 0) < 0.40 },
];
console.log("  Quality tier                  Had hit yesterday   Hitless yesterday   Δ");
for (const q of qualityBuckets) {
  const hh = withPrior.filter(o => q.filter(o.feat) && o.feat.hitlessYesterday === false);
  const hl = withPrior.filter(o => q.filter(o.feat) && o.feat.hitlessYesterday === true);
  if (hh.length < 10 || hl.length < 10) continue;
  const hR = hh.filter(o => o.gotHit).length / hh.length;
  const lR = hl.filter(o => o.gotHit).length / hl.length;
  const delta = (lR - hR) * 100;
  console.log(
    `  ${q.label.padEnd(34)}` +
    `${(hR*100).toFixed(1).padStart(5)}% (n=${String(hh.length).padEnd(4)})   ` +
    `${(lR*100).toFixed(1).padStart(5)}% (n=${String(hl.length).padEnd(4)})   ` +
    `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp`
  );
}

// B4: Bounce-back within same score band — controlling for model score
console.log("\nB4. Hitless-yesterday effect within model score bands (controls for batter quality):");
console.log("  Band    Hit yesterday    Hitless yesterday    Δ (bounce-back)");
for (const b of bands) {
  const sub = withPrior.filter(o => o.score >= b.min && o.score <= b.max);
  const hh  = sub.filter(o => o.feat.hitlessYesterday === false);
  const hl  = sub.filter(o => o.feat.hitlessYesterday === true);
  if (hh.length < 15 || hl.length < 15) continue;
  const hR = hh.filter(o => o.gotHit).length / hh.length;
  const lR = hl.filter(o => o.gotHit).length / hl.length;
  const delta = (lR - hR) * 100;
  const flag  = Math.abs(delta) >= 2 ? (delta > 0 ? " ← bounce-back signal" : " ← hitless drags") : "";
  console.log(
    `  ${b.label.padEnd(6)}  ${(hR*100).toFixed(1)}%  (n=${String(hh.length).padEnd(4)})    ` +
    `${(lR*100).toFixed(1)}%  (n=${String(hl.length).padEnd(4)})    ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp${flag}`
  );
}

// B5: Bottom of order (7-9) specifically hitless yesterday
console.log("\nB5. Hitless yesterday — bottom order (7-9) vs top/middle (1-6):");
const botHL = withPrior.filter(o => o.slot >= 7 && o.feat.hitlessYesterday === true);
const botHH = withPrior.filter(o => o.slot >= 7 && o.feat.hitlessYesterday === false);
const topHL = withPrior.filter(o => o.slot <= 6 && o.feat.hitlessYesterday === true);
const topHH = withPrior.filter(o => o.slot <= 6 && o.feat.hitlessYesterday === false);

const show = (label, sub) => {
  if (!sub.length) return;
  const hr = sub.filter(o => o.gotHit).length;
  console.log(`  ${label.padEnd(40)} ${pct(hr, sub.length).padStart(6)}  (n=${sub.length})`);
};
show("Slots 1-6, had a hit yesterday:",   topHH);
show("Slots 1-6, hitless yesterday:",     topHL);
show("Slots 7-9, had a hit yesterday:",   botHH);
show("Slots 7-9, hitless yesterday:",     botHL);

// ══════════════════════════════════════════════════════════════════════════════
// PART C: POINT-BISERIAL CORRELATIONS
// ══════════════════════════════════════════════════════════════════════════════

console.log("\n╔═══════════════════════════════════════════════════════════════╗");
console.log("║  PART C — POINT-BISERIAL CORRELATIONS (new features vs hit)  ║");
console.log("╚═══════════════════════════════════════════════════════════════╝\n");

function pbCorr(key, transform = v => v) {
  const valid = obs.filter(o => {
    const v = key === "slot" ? o.slot : o.feat[key];
    return v !== null && v !== undefined;
  });
  if (valid.length < 50) return null;
  const vals   = valid.map(o => transform(key === "slot" ? o.slot : o.feat[key]));
  const outs   = valid.map(o => o.gotHit ? 1 : 0);
  const mean   = vals.reduce((a, b) => a + b) / vals.length;
  const std    = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  const hMean  = valid.filter(o => o.gotHit).map((o, i) => vals[valid.indexOf(o)]).reduce((a, b) => a + b, 0) /
                 (valid.filter(o => o.gotHit).length || 1);
  // Recompute properly
  const hVals  = valid.filter(o => o.gotHit).map(o => transform(key === "slot" ? o.slot : o.feat[key]));
  const nVals  = valid.filter(o => !o.gotHit).map(o => transform(key === "slot" ? o.slot : o.feat[key]));
  const hMu    = hVals.reduce((a, b) => a + b, 0) / (hVals.length || 1);
  const nMu    = nVals.reduce((a, b) => a + b, 0) / (nVals.length || 1);
  const pHit   = valid.filter(o => o.gotHit).length / valid.length;
  const r      = ((hMu - nMu) / (std || 1)) * Math.sqrt(pHit * (1 - pHit));
  return { r, n: valid.length };
}

const features = [
  ["slot (1–9, lower = top order)", "slot"],
  ["hitlessYesterday (bool)", "hitlessYesterday"],
  ["coldStreak (# hitless days)", "coldStreak"],
  ["hitRate20 (consistency)", "hitRate20"],
  ["hittingStreak", "hittingStreak"],
  ["last10AVG", "last10AVG"],
  ["last3AVG", "last3AVG"],
  ["avgVsHand", "avgVsHand"],
];

console.log("  Feature                                  r         n");
console.log("  ─────────────────────────────────────────────────────");
for (const [label, key] of features) {
  const res = pbCorr(key);
  if (!res) { console.log(`  ${label.padEnd(42)}  < 50 obs`); continue; }
  const bar = res.r >= 0
    ? " ".repeat(10) + "│" + "▶".repeat(Math.round(Math.abs(res.r) * 40))
    : " ".repeat(Math.round(Math.max(0, 10 - Math.abs(res.r) * 40))) + "◀".repeat(Math.round(Math.abs(res.r) * 40)) + "│";
  console.log(`  ${label.padEnd(42)} ${res.r >= 0 ? " " : ""}${res.r.toFixed(4)}   (n=${res.n})`);
}

// ══════════════════════════════════════════════════════════════════════════════
// PART D: RECOMMENDATIONS SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

console.log("\n╔═══════════════════════════════════════════════════════════════╗");
console.log("║  PART D — WHAT TO DO WITH THESE SIGNALS                      ║");
console.log("╚═══════════════════════════════════════════════════════════════╝");
console.log(`
  1. LINEUP SLOT (7-9)
     Look at Section A3 — if bottom-order batters underperform their score
     within the same band by ≥ 3pp, the model is over-scoring them. Root cause:
     - Slots 7-9 average fewer ABs/game (~3.2 vs ~4.0 for top order)
     - Fewer AB opportunities mechanically reduce hit probability at any AVG
     - Model baselines assume ~3.8 AB/game average
     Potential fix: apply a -2 to -5 point modifier for slots 7-9 (or use
     AB-count directly if available in the features JSONB going forward).

  2. HITLESS YESTERDAY (bounce-back)
     Look at Section B4 — if hitless batters score ≥2pp higher within the same
     model score band, there's a real bounce-back signal worth modeling.
     Currently:
     - streak=0 collapses both "hitless 1 day" and "hitless 5 days" together
     - isBouncebackHit() uses this for a UI badge but NOT as a model feature
     - Adding hitlessYesterday as a binary feature (±2 pts for elite hitters,
       neutral for cold hitters) could sharpen the model

  3. COMBINED EFFECT (B5)
     Bottom-of-order batters hitless yesterday are the most under-predicted
     group if the bounce-back effect is real — they're already discounted by
     slot and then discounted again for the hitless streak. If the actual hit
     rate in B5 shows they still hit ~55-60%, that's a systematic blind spot.
`);

console.log("Done.\n");
