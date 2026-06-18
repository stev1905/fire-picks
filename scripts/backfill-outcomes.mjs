/**
 * Backfill batter_outcomes from existing Supabase snapshots.
 * Safe to run multiple times — uses upsert (ON CONFLICT DO NOTHING).
 *
 * Usage:  node scripts/backfill-outcomes.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://dshrvzwpdixzhvoncgwi.supabase.co";
const SUPABASE_KEY = "sb_publishable_8_pzcyPHYW3FIDJ1d0oKQQ_F2sGq6Ek";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Weights (mirrors lib/model-weights.ts) ────────────────────────────────────
const HIT_WEIGHTS = { form:20, consistency:18, vsHand:16, homeAway:7, streak:5, xBA:9, hardHit:3, pitcherH:4, h2h:3 };
const HR_WEIGHTS  = { recentHR:22, seasonSLG:12, slgVsHand:11, recentSLG:10, barrel:12, hardHit:8, pitcherHR:7, park:3 };

function clamp(v, max) { return Math.min(max, Math.max(0, v)); }

function buildFeatures(batter, pitcher, today) {
  const prior    = (batter.last10Games ?? []).filter(g => g.date !== today);
  const recent3  = prior.slice(0, 3);
  const recent10 = prior.slice(0, 10);

  const windowAvg = (games) => {
    const ab = games.reduce((s, g) => s + (g.atBats ?? 0), 0);
    const h  = games.reduce((s, g) => s + (g.hits   ?? 0), 0);
    return ab > 0 ? h / ab : null;
  };

  let hittingStreak = 0;
  for (const g of prior) { if ((g.hits ?? 0) > 0) hittingStreak++; else break; }

  const pitcherHand  = pitcher?.hand ?? null;
  const rawVsHand    = pitcherHand === "L" ? batter.avgVsLeft : batter.avgVsRight;
  const avgVsHand    = (rawVsHand && rawVsHand > 0) ? rawVsHand : (batter.seasonAVG ?? null);
  const situationalAVG = batter.isHome
    ? (batter.homeAVG  && batter.homeAVG  > 0 ? batter.homeAVG  : null)
    : (batter.awayAVG  && batter.awayAVG  > 0 ? batter.awayAVG  : null);
  const h2hAVG = (batter.vsCurrentPitcher?.atBats ?? 0) >= 5
    ? batter.vsCurrentPitcher.avg : null;
  const slgVsHand = pitcherHand === "L" ? (batter.slgVsLeft ?? 0) : (batter.slgVsRight ?? 0);

  return {
    last3AVG:           windowAvg(recent3),
    last10AVG:          windowAvg(recent10),
    hitRate10:          recent10.length > 0 ? recent10.filter(g => g.hits > 0).length / recent10.length : null,
    hitRate20:          batter.hitRate20 ?? null,
    avgVsHand,
    situationalAVG,
    hittingStreak,
    xBA:                batter.xBA         ?? null,
    hardHitPct:         batter.hardHitPct  ?? null,
    barrelPct:          batter.barrelPct   ?? null,
    h2hAVG,
    pitcherHand,
    isHome:             batter.isHome      ?? null,
    last3HitsAllowed:   pitcher?.last3HitsAllowed    ?? null,
    last3HR:            batter.last3HR     ?? 0,
    last6HR:            batter.last6HR     ?? 0,
    last10HR:           batter.last10HR    ?? 0,
    seasonSLG:          batter.seasonSLG   ?? 0,
    slgVsHand,
    last10SLG:          batter.last10SLG   ?? 0,
    last3HRAllowed:     pitcher?.last3HRAllowed      ?? null,
    last3InningsPitched:pitcher?.last3InningsPitched ?? null,
    seasonHRAllowed:    pitcher?.seasonHRAllowed     ?? null,
  };
}

function hitScore(f, parkFactor) {
  let s = 0;
  const form = ((f.last10AVG ?? 0) / 0.380) * (HIT_WEIGHTS.form * 0.65)
             + ((f.last3AVG  ?? 0) / 0.480) * (HIT_WEIGHTS.form * 0.35);
  s += clamp(form, HIT_WEIGHTS.form);
  const cr = f.hitRate20 ?? f.hitRate10 ?? 0;
  s += clamp(cr * HIT_WEIGHTS.consistency, HIT_WEIGHTS.consistency);
  s += clamp(((f.avgVsHand ?? 0) / 0.360) * HIT_WEIGHTS.vsHand, HIT_WEIGHTS.vsHand);
  if (f.situationalAVG !== null) s += clamp((f.situationalAVG / 0.340) * HIT_WEIGHTS.homeAway, HIT_WEIGHTS.homeAway);
  if (f.hittingStreak > 0) s += clamp((Math.log(1 + f.hittingStreak) / Math.log(16)) * HIT_WEIGHTS.streak, HIT_WEIGHTS.streak);
  s += clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 4, 4);
  if (f.last3HitsAllowed !== null) s += clamp(Math.max(0, (f.last3HitsAllowed - 4) / 11) * HIT_WEIGHTS.pitcherH, HIT_WEIGHTS.pitcherH);
  if (f.xBA        !== null) s += clamp((f.xBA        / 0.340) * HIT_WEIGHTS.xBA,     HIT_WEIGHTS.xBA);
  if (f.hardHitPct !== null) s += clamp((f.hardHitPct / 55)    * HIT_WEIGHTS.hardHit, HIT_WEIGHTS.hardHit);
  if (f.h2hAVG     !== null) s += clamp((f.h2hAVG     / 0.300) * HIT_WEIGHTS.h2h,     HIT_WEIGHTS.h2h);
  return Math.min(100, Math.max(0, Math.round(s)));
}

function hrScore(f, parkFactor) {
  let s = 0;
  s += clamp((f.last3HR / 2)  * (HR_WEIGHTS.recentHR * 0.50), HR_WEIGHTS.recentHR * 0.50)
     + clamp((f.last6HR / 3)  * (HR_WEIGHTS.recentHR * 0.35), HR_WEIGHTS.recentHR * 0.35)
     + clamp((f.last10HR / 4) * (HR_WEIGHTS.recentHR * 0.15), HR_WEIGHTS.recentHR * 0.15);
  s += clamp((f.seasonSLG  / 0.620) * HR_WEIGHTS.seasonSLG, HR_WEIGHTS.seasonSLG);
  s += clamp((f.slgVsHand  / 0.680) * HR_WEIGHTS.slgVsHand, HR_WEIGHTS.slgVsHand);
  s += clamp((f.last10SLG  / 0.700) * HR_WEIGHTS.recentSLG, HR_WEIGHTS.recentSLG);
  s += clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * HR_WEIGHTS.park, HR_WEIGHTS.park);
  if (f.barrelPct  !== null) s += clamp((f.barrelPct  / 20) * HR_WEIGHTS.barrel,  HR_WEIGHTS.barrel);
  if (f.hardHitPct !== null) s += clamp((f.hardHitPct / 55) * HR_WEIGHTS.hardHit, HR_WEIGHTS.hardHit);
  if (f.last3HRAllowed !== null && f.last3InningsPitched !== null) {
    const hrPer9 = f.last3InningsPitched > 0
      ? (f.last3HRAllowed / f.last3InningsPitched) * 9
      : (f.seasonHRAllowed ?? 0) > 0 ? f.seasonHRAllowed / 30 : 0;
    s += clamp((hrPer9 / 2.0) * HR_WEIGHTS.pitcherHR, HR_WEIGHTS.pitcherHR);
  }
  return Math.min(100, Math.max(0, Math.round(s)));
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("Fetching all MLB snapshots...");
const { data: snapshots, error: fetchErr } = await sb
  .from("snapshots")
  .select("date, data")
  .like("date", "____-__-__")
  .order("date", { ascending: true });

if (fetchErr) { console.error(fetchErr); process.exit(1); }
console.log(`Found ${snapshots.length} snapshots. Processing...\n`);

let totalRows = 0;
let totalErrors = 0;

for (const snap of snapshots) {
  const today = snap.date;
  const games = snap.data?.games ?? [];
  const rows  = [];

  for (const game of games) {
    const pairs = [
      [game.homeLineup ?? [], game.awayStartingPitcher],
      [game.awayLineup ?? [], game.homeStartingPitcher],
    ];
    for (const [lineup, pitcher] of pairs) {
      for (const batter of lineup) {
        const todayGame = batter.last10Games?.[0];
        if (!todayGame || todayGame.date !== today || (todayGame.atBats ?? 0) === 0) continue;

        const f   = buildFeatures(batter, pitcher, today);
        const pf  = game.parkFactor ?? 1.0;

        rows.push({
          date:        today,
          batter_id:   batter.id,
          batter_name: batter.name,
          team:        batter.teamAbbreviation ?? null,
          game_pk:     game.gamePk,
          hit_score:   hitScore(f, pf),
          hr_score:    hrScore(f, pf),
          got_hit:     (todayGame.hits ?? 0) > 0,
          got_hr:      (todayGame.hr   ?? 0) > 0,
          at_bats:     todayGame.atBats ?? 0,
          hits:        todayGame.hits   ?? 0,
          hrs:         todayGame.hr     ?? 0,
          features:    f,
        });
      }
    }
  }

  if (rows.length === 0) { process.stdout.write(`  ${today}: 0 batters (no games)\n`); continue; }

  // Deduplicate: doubleheaders can have same batter_id twice — merge their stats
  const merged = new Map();
  for (const r of rows) {
    const key = r.batter_id;
    if (!merged.has(key)) { merged.set(key, { ...r }); continue; }
    const prev = merged.get(key);
    // Combine both games: sum hits/hrs/atBats, OR together for got_hit/got_hr
    prev.at_bats += r.at_bats;
    prev.hits    += r.hits;
    prev.hrs     += r.hrs;
    prev.got_hit  = prev.got_hit || r.got_hit;
    prev.got_hr   = prev.got_hr  || r.got_hr;
    // Keep higher scores (pre-game prediction before first game is more predictive)
    prev.hit_score = Math.max(prev.hit_score, r.hit_score);
    prev.hr_score  = Math.max(prev.hr_score,  r.hr_score);
  }
  const deduped = [...merged.values()];

  const { error } = await sb
    .from("batter_outcomes")
    .upsert(deduped, { onConflict: "date,batter_id" });

  if (error) {
    console.error(`  ${today}: ERROR — ${error.message}`);
    totalErrors++;
  } else {
    process.stdout.write(`  ${today}: ${rows.length} rows written\n`);
    totalRows += rows.length;
  }
}

console.log(`\nDone. ${totalRows} total rows written across ${snapshots.length} snapshots.`);
if (totalErrors > 0) console.warn(`${totalErrors} snapshots had errors.`);
console.log("\nVerify in Supabase:");
console.log("  SELECT date, count(*), round(avg(hit_score)) avg_hit, sum(case when got_hit then 1 else 0 end) hits");
console.log("  FROM batter_outcomes GROUP BY date ORDER BY date DESC LIMIT 10;");
