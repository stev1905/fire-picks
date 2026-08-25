/**
 * Hit Score & HR Score Accuracy Backtest
 *
 * Uses the same algorithm as lib/scores.ts (production weights from model-weights.ts)
 * to compare predicted scores against actual outcomes over the last 30 days.
 *
 * Sections (run once per score — Hit, then HR):
 *  1. Score calibration — do higher scores produce more hits/HRs?
 *  2. Feature correlation — which inputs actually predict the outcome?
 *  3. Home/Away split deep dive
 *  4. Pitcher hittability / HR-proneness deep dive
 *  5. Streak and momentum analysis (Hit only)
 *  6. False positive deep dive — PROD vs experimental alternatives
 *  7. Weekly trend — are we getting better or worse over time?
 *  8. Summary
 *
 * NOTE: weather and pull-side-distance modifiers are intentionally omitted from
 * both reconstructions — they aren't part of the 85-pt weighted base (see
 * model-weights.ts), require live weather/park-geometry data not stored in
 * snapshots, and aren't the target of weight-tuning analysis. Matches the
 * precedent already set by the original Hit Score version of this script.
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://dshrvzwpdixzhvoncgwi.supabase.co",
  "sb_publishable_8_pzcyPHYW3FIDJ1d0oKQQ_F2sGq6Ek"
);

const DAYS_BACK = 30;

// ── Actual current production weights — MUST mirror lib/model-weights.ts exactly.
// (These are duplicated here, not imported, because this script runs under plain
// node while lib/model-weights.ts is TypeScript. Keep in sync by hand.)
const HIT_WEIGHTS_PROD = {
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

// ── Experimental alternative — streak trimmed hard, informed by this script's
// own finding: streak correlates weakest of any measured Hit feature (r~0.03)
// despite carrying the 4th-largest weight. Points redistributed to consistency
// (hitRate20, the strongest-correlating feature available at 100% coverage).
const HIT_WEIGHTS_V4_STREAK_TRIM = {
  form:        2,
  consistency: 13,
  vsHand:      23,
  homeAway:    4,
  streak:      3,
  xBA:         4,
  hardHit:     2,
  pitcherH:    25,
  h2h:         9,
};

// ── V5 — same streak trim as V4, PLUS shift weight from vsHand into
// consistency. Informed by this run's own correlations: hitRate20 (r=+0.250)
// is more than double avgVsHand's r=+0.109, yet carries less than half the
// weight (9 vs 23). Testing whether closing that gap actually helps, not
// assuming it does — same discipline as every other variant here.
const HIT_WEIGHTS_V5_CONSISTENCY_UP = {
  form:        2,
  consistency: 18,
  vsHand:      18,
  homeAway:    4,
  streak:      3,
  xBA:         4,
  hardHit:     2,
  pitcherH:    25,
  h2h:         9,
};

const HR_WEIGHTS_PROD = {
  recentHR:  20,
  seasonSLG: 9,
  slgVsHand: 9,
  recentSLG: 7,
  barrel:    11,
  hardHit:   6,
  pitcherHR: 6,
  xwOBA:     8,
  flyBall:   6,
  park:      3,
};

function verifyWeights(w, name, expected) {
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (sum !== expected) console.warn(`[WARN] ${name} weights sum to ${sum}, expected ${expected}`);
}
verifyWeights(HIT_WEIGHTS_PROD, "HIT_PROD", 85);
verifyWeights(HIT_WEIGHTS_V4_STREAK_TRIM, "HIT_V4", 85);
verifyWeights(HIT_WEIGHTS_V5_CONSISTENCY_UP, "HIT_V5", 85);
verifyWeights(HR_WEIGHTS_PROD, "HR_PROD", 85);

function clamp(v, max) { return Math.min(max, Math.max(0, v)); }
function clampSigned(v, max) { return Math.max(-max, Math.min(max, v)); }
function fmt3(v) { return (v == null || isNaN(v)) ? " ---" : v.toFixed(3).replace(/^0\./, "."); }
function pct(n, d) { return d === 0 ? "  —" : (n / d * 100).toFixed(1) + "%"; }

const MIN_RELIABLE_RECENT_IP = 9;
const MIN_RELIABLE_SEASON_IP = 10;
const PITCHER_PITCH_MIN_USAGE = 15;
const PITCHER_PITCH_MIN_PA = 15;
const BATTER_PITCH_MIN_PA = 10;
const PITCHER_ZONE_MIN_PITCHES = 8;

// ── Port of calcPitchMatchup (lib/scores.ts) — exact pitch-type arsenal ───────
function calcPitchMatchup(batter, pitcher) {
  const pitcherPitches = (pitcher.pitchArsenal ?? [])
    .filter((p) => p.usage >= PITCHER_PITCH_MIN_USAGE && p.pa >= PITCHER_PITCH_MIN_PA);
  if (pitcherPitches.length === 0 || !batter.pitchArsenal?.length) return { earned: 4, value: null };

  const matched = [];
  for (const pp of pitcherPitches) {
    const bp = batter.pitchArsenal.find((e) => e.type === pp.type && e.pa >= BATTER_PITCH_MIN_PA);
    if (!bp) continue;
    const xba = bp.xba ?? bp.ba;
    if (xba === undefined || xba === null) continue;
    const xbaDelta = clampSigned(((xba - 0.245) / 0.070) * 3, 3);
    const whiffDelta = bp.whiff != null ? clampSigned(((24 - bp.whiff) / 12) * 1.5, 1.5) : 0;
    matched.push({ usage: pp.usage, delta: xbaDelta + whiffDelta });
  }
  if (matched.length === 0) return { earned: 4, value: null };

  const totalUsage = matched.reduce((s, m) => s + m.usage, 0);
  const weightedDelta = matched.reduce((s, m) => s + m.delta * m.usage, 0) / totalUsage;
  return { earned: clamp(4 + clampSigned(weightedDelta, 4), 8), value: weightedDelta };
}

// ── Port of zoneFitCore + calcZoneFitDelta (lib/scores.ts) ────────────────────
function calcZoneFitDelta(batter, pitcher) {
  const inZone = (pitcher.zoneProfile ?? []).filter((z) => z.zone >= 1 && z.zone <= 9 && z.pitches != null);
  const batterZones = (batter.zoneProfile ?? []).filter((z) => z.zone >= 1 && z.zone <= 9 && z.pitches >= 5);
  if (!inZone.length || !batterZones.length) return 0;

  const frequentTargets = inZone.slice(0, 2).map((z) => z.zone);
  const vulnerableTargets = inZone
    .filter((z) => z.pitches >= PITCHER_ZONE_MIN_PITCHES && z.xBA !== null)
    .sort((a, b) => b.xBA - a.xBA)
    .slice(0, 2)
    .map((z) => z.zone);
  const targets = Array.from(new Set([...frequentTargets, ...vulnerableTargets]));

  const hotZones  = batterZones.filter((z) => z.xBA > 0.310).map((z) => z.zone);
  const coldZones = batterZones.filter((z) => z.xBA < 0.210).map((z) => z.zone);
  const hotMatch  = targets.find((z) => hotZones.includes(z));
  const coldMatch = targets.find((z) => coldZones.includes(z));
  if (!hotMatch && !coldMatch) return 0;
  if (hotMatch && coldMatch) {
    const hotXBA  = batterZones.find((z) => z.zone === hotMatch)?.xBA  ?? 0.260;
    const coldXBA = batterZones.find((z) => z.zone === coldMatch)?.xBA ?? 0.260;
    return (hotXBA - 0.260 >= 0.260 - coldXBA) ? 2 : -2;
  }
  return hotMatch ? 2 : -2;
}

function getColdStreak(games) {
  let cold = 0;
  for (const g of games) {
    if ((g.hits ?? 0) === 0) cold++;
    else break;
  }
  return cold;
}

// Batter's overall contact rate — 100 minus the usage-weighted whiff% across
// their exact-pitch-type arsenal (batter.pitchArsenal, same field used by
// calcPitchMatchup). Not currently used anywhere in either score.
function batterContactPct(batter) {
  const entries = (batter.pitchArsenal ?? []).filter((e) => e.whiff !== undefined && e.pitches >= 20);
  const totalPitches = entries.reduce((s, e) => s + e.pitches, 0);
  if (totalPitches < 50) return null;
  const weightedWhiff = entries.reduce((s, e) => s + e.whiff * e.pitches, 0) / totalPitches;
  return 100 - weightedWhiff;
}

// Pitcher's Zone% — % of all pitches thrown inside the strike zone (zones
// 1-9), derived from pitcher.zoneProfile (already fetched for zone-fit).
// Not currently used anywhere in either score (the old zonePct/chaseInducePct
// fields were dead code and removed earlier this session).
function pitcherZonePct(pitcher) {
  const zp = pitcher.zoneProfile ?? [];
  const totalPct = zp.reduce((s, z) => s + z.pct, 0);
  if (totalPct < 50) return null; // incomplete profile — don't trust it
  return zp.filter((z) => z.zone >= 1 && z.zone <= 9).reduce((s, z) => s + z.pct, 0);
}

// ── Replicate production calcHitScoreBreakdown with configurable weights ──────
function calcHitScore(batter, pitcher, parkFactor, snapshotDate, W, flags = {}) {
  const priorGames = (batter.last10Games ?? []).filter(g => g.date !== snapshotDate);
  const recent3    = priorGames.slice(0, 3);
  const recent10   = priorGames.slice(0, 10);

  const recent6 = priorGames.slice(0, 6);
  const windowAvg = (games) => {
    const ab = games.reduce((s, g) => s + (g.atBats ?? 0), 0);
    const h  = games.reduce((s, g) => s + (g.hits  ?? 0), 0);
    return ab > 0 ? h / ab : 0;
  };
  const last3AVG   = windowAvg(recent3);
  const last6AVG   = windowAvg(recent6);
  const last10AVG  = windowAvg(recent10);
  const hitRate10  = priorGames.length > 0 ? priorGames.slice(0, 10).filter(g => (g.hits ?? 0) > 0).length / Math.min(10, priorGames.length) : null;

  let consistencyScore;
  if (batter.hitRate20 > 0) {
    consistencyScore = clamp(batter.hitRate20 * W.consistency, W.consistency);
  } else {
    const gp = priorGames.length;
    const hg = gp > 0 ? priorGames.filter(g => g.hits > 0).length : 0;
    consistencyScore = gp > 0 ? clamp((hg / gp) * W.consistency, W.consistency) : 0;
  }

  const formRaw = (last10AVG / 0.380) * (W.form * 0.65) + (last3AVG / 0.480) * (W.form * 0.35);
  const form = clamp(formRaw, W.form);

  let matchup = 0;
  if (pitcher) {
    const rawAvg = pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight;
    let matchupAvg;
    if (flags.blendSeasonAVG && rawAvg > 0 && (batter.seasonAVG ?? 0) > 0) {
      matchupAvg = rawAvg * 0.6 + batter.seasonAVG * 0.4;
    } else {
      matchupAvg = rawAvg > 0 ? rawAvg : (batter.seasonAVG ?? 0);
    }
    matchup = clamp((matchupAvg / 0.360) * W.vsHand, W.vsHand);
  } else {
    matchup = clamp(((batter.seasonAVG ?? 0) / 0.340) * (W.vsHand * 0.7), W.vsHand);
  }

  let homeAwayScore = 0;
  const hasHomeSplit = (batter.homeAVG ?? 0) > 0 || (batter.awayAVG ?? 0) > 0;
  if (hasHomeSplit && batter.isHome !== undefined) {
    const sitAvg = batter.isHome ? (batter.homeAVG ?? 0) : (batter.awayAVG ?? 0);
    homeAwayScore = clamp((sitAvg / 0.340) * W.homeAway, W.homeAway);
  }

  let hittingStreak = 0;
  for (const g of priorGames) {
    if ((g.hits ?? 0) > 0) hittingStreak++;
    else break;
  }
  const streakScore = hittingStreak > 0
    ? clamp((Math.log(1 + hittingStreak) / Math.log(1 + 15)) * W.streak, W.streak)
    : 0;

  const park = clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 4, 4);

  // Pitcher H/9 — recent-then-season fallback, neutral default (not 0) when no data at all
  let pitcherScore = W.pitcherH / 2;
  let h9 = null;
  let h9Source = null; // "recent" | "season" | null — "season" or null ≈ bullpen/spot-start game
  const recentReliable = (pitcher?.last3InningsPitched ?? 0) >= MIN_RELIABLE_RECENT_IP;
  if (pitcher) {
    const seasonReliable = (pitcher.seasonInningsPitched ?? 0) >= MIN_RELIABLE_SEASON_IP;
    if (recentReliable) {
      h9 = (pitcher.last3HitsAllowed / pitcher.last3InningsPitched) * 9;
      h9Source = "recent";
    } else if (seasonReliable) {
      h9 = (pitcher.seasonHitsAllowed / pitcher.seasonInningsPitched) * 9;
      h9Source = "season";
    }
    if (h9 !== null) pitcherScore = clamp(((h9 - 5.0) / 6.0) * W.pitcherH, W.pitcherH);
  }

  let pitcherSplitScore = 0;
  if (pitcher) {
    const baaVsHand = batter.hand === "L" ? pitcher.baaVsLeft : pitcher.baaVsRight;
    if (baaVsHand > 0) pitcherSplitScore = clamp(((baaVsHand - 0.190) / 0.150) * 4, 4);
  }

  const xBAScore = batter.xBA > 0 ? clamp((batter.xBA / 0.340) * W.xBA, W.xBA) : 0;
  const hardHitScore = batter.hardHitPct > 0 ? clamp((batter.hardHitPct / 55) * W.hardHit, W.hardHit) : 0;

  let h2hScore = 0;
  const h2h = batter.vsCurrentPitcher;
  if (h2h && h2h.atBats >= 5) h2hScore = clamp((h2h.avg / 0.300) * W.h2h, W.h2h);

  // Matchup (Pitch + Zone) — arsenal-based, shares one ±4 envelope
  let pitchMatchupScore = 0;
  if (pitcher) {
    const pm = calcPitchMatchup(batter, pitcher);
    const zf = calcZoneFitDelta(batter, pitcher);
    const combinedDelta = clampSigned((pm.earned - 4) + zf, 4);
    pitchMatchupScore = clamp(4 + combinedDelta, 8) - 4;
  }

  let coldStreak = 0;
  for (const g of priorGames) {
    if ((g.hits ?? 0) === 0) coldStreak++;
    else break;
  }
  // Bounce-back scaled by hitRate20 for coldStreak 1-2 (adopted from the V7
  // experiment below — see PROD momentum comment in lib/scores.ts for the
  // full rationale). No modifier at coldStreak=0 or >=3.
  let momentumMod = 0;
  const rate = batter.hitRate20 ?? (priorGames.length > 0 ? priorGames.filter(g => g.hits > 0).length / priorGames.length : 0);
  if (coldStreak >= 1 && coldStreak <= 2) {
    if (rate >= 0.65) momentumMod = 3;
    else if (rate >= 0.50) momentumMod = 2;
    else if (rate >= 0.40) momentumMod = 1;
    else if (rate < 0.30) momentumMod = -1;
  }

  const slot = batter.battingOrder ?? 0;
  const slotMod = slot >= 9 ? -3 : slot >= 7 ? -2 : 0;

  const total = Math.min(100, Math.max(0, Math.round(
    form + consistencyScore + matchup + homeAwayScore + streakScore + park +
    pitcherScore + pitcherSplitScore + xBAScore + hardHitScore + h2hScore +
    pitchMatchupScore + momentumMod + slotMod
  )));

  return {
    total, hittingStreak, coldStreak, h9, h9Source,
    isBullpenGame: !recentReliable, // recent sample too thin to trust — spot start / bullpen game / opener
    last3AVG, last6AVG, last10AVG, hitRate10,
  };
}

// ── Replicate production calcHRScoreBreakdown with configurable weights ───────
function calcHRScore(batter, pitcher, parkFactor, W) {
  const recentHR =
    clamp(((batter.last3HR ?? 0) / 2) * (W.recentHR * 0.50), W.recentHR * 0.50) +
    clamp(((batter.last6HR ?? 0) / 3) * (W.recentHR * 0.35), W.recentHR * 0.35) +
    clamp(((batter.last10HR ?? 0) / 4) * (W.recentHR * 0.15), W.recentHR * 0.15);

  const slg = clamp(((batter.seasonSLG ?? 0) / 0.620) * W.seasonSLG, W.seasonSLG);

  let matchup = 0;
  if (pitcher) {
    const matchupSLG = pitcher.hand === "L" ? batter.slgVsLeft : batter.slgVsRight;
    matchup = clamp(((matchupSLG ?? 0) / 0.680) * W.slgVsHand, W.slgVsHand);
  } else {
    matchup = clamp(((batter.seasonSLG ?? 0) / 0.600) * (W.slgVsHand * 0.7), W.slgVsHand);
  }

  const park = clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * W.park, W.park);
  const recentSlg = clamp(((batter.last10SLG ?? 0) / 0.700) * W.recentSLG, W.recentSLG);

  const barrelScore = (batter.barrelPct ?? 0) > 0 ? clamp((batter.barrelPct / 20) * W.barrel, W.barrel) : 0;
  const hardHitScore = (batter.hardHitPct ?? 0) > 0 ? clamp((batter.hardHitPct / 55) * W.hardHit, W.hardHit) : 0;

  let pitcherHRScore = 0;
  let hrPer9 = null;
  if (pitcher) {
    const hrP9ByHand = batter.hand === "L" ? pitcher.hrPer9VsLeft : pitcher.hrPer9VsRight;
    const l3ip = pitcher.last3InningsPitched ?? 0;
    const l3hr = pitcher.last3HRAllowed ?? 0;
    const szHR = pitcher.seasonHRAllowed ?? 0;
    const fallback = l3ip > 0 ? (l3hr / l3ip) * 9 : (szHR > 0 ? szHR / 30 : 0);
    hrPer9 = hrP9ByHand ?? fallback;
    pitcherHRScore = clamp((hrPer9 / 2.0) * W.pitcherHR, W.pitcherHR);
  }

  const xwobaScore = (batter.xwOBA ?? 0) > 0 ? clamp(((batter.xwOBA - 0.270) / 0.130) * W.xwOBA, W.xwOBA) : 0;
  const flyBallScore = (batter.flyBallRate ?? 0) > 0 ? clamp(((batter.flyBallRate - 0.30) / 0.35) * W.flyBall, W.flyBall) : 0;

  let h2hScore = 0;
  const h2h = batter.vsCurrentPitcher;
  if (h2h && h2h.atBats >= 8) h2hScore = clamp((h2h.hr / h2h.atBats) * 40, 4);

  const slot = batter.battingOrder ?? 0;
  const slotMod = slot >= 9 ? -3 : slot >= 7 ? -2 : 0;

  const total = Math.min(100, Math.max(0, Math.round(
    recentHR + slg + matchup + park + recentSlg + barrelScore +
    hardHitScore + pitcherHRScore + xwobaScore + flyBallScore + h2hScore + slotMod
  )));

  return { total, hrPer9 };
}

// ── Pull snapshots (30-day window) ─────────────────────────────────────────────
console.log("Fetching MLB snapshots from Supabase...\n");

const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - DAYS_BACK);
const cutoffStr = cutoff.toISOString().slice(0, 10);

const { data: rows, error } = await sb
  .from("snapshots")
  .select("date, data")
  .like("date", "____-__-__")
  .gte("date", cutoffStr)
  .order("date", { ascending: false })
  .limit(DAYS_BACK + 5);

if (error) { console.error(error); process.exit(1); }
console.log(`Loaded ${rows.length} snapshots (last ${DAYS_BACK} days): ${rows[rows.length-1]?.date} → ${rows[0]?.date}\n`);

// ── Build observations (one row per batter-game, both Hit and HR outcomes) ────
const obs = [];

for (const row of rows) {
  const date  = row.date;
  const games = row.data?.games ?? [];
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
        const gotHR  = (todayGame.hr   ?? 0) > 0;
        batter.isHome = isHome;

        const hitProd = calcHitScore(batter, pitcher, game.parkFactor ?? 1.0, date, HIT_WEIGHTS_PROD);
        const hitV4   = calcHitScore(batter, pitcher, game.parkFactor ?? 1.0, date, HIT_WEIGHTS_V4_STREAK_TRIM);
        const hitV5   = calcHitScore(batter, pitcher, game.parkFactor ?? 1.0, date, HIT_WEIGHTS_V5_CONSISTENCY_UP);
        const hitV6   = calcHitScore(batter, pitcher, game.parkFactor ?? 1.0, date, HIT_WEIGHTS_PROD, { blendSeasonAVG: true });
        const hrProd  = calcHRScore(batter, pitcher, game.parkFactor ?? 1.0, HR_WEIGHTS_PROD);

        obs.push({
          date,
          name:  batter.name,
          gotHit, gotHR,
          hitProd: hitProd.total,
          hitV4:   hitV4.total,
          hitV5:   hitV5.total,
          hitV6:   hitV6.total,
          hrProd:  hrProd.total,
          streak: hitProd.hittingStreak,
          cold:   hitProd.coldStreak,
          h9:     hitProd.h9,
          h9Source: hitProd.h9Source,
          isBullpenGame: hitProd.isBullpenGame,
          hrPer9: hrProd.hrPer9,
          homeAvg: batter.isHome ? (batter.homeAVG ?? null) : (batter.awayAVG ?? null),
          avgVsHand: pitcher ? (pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight) : null,
          xBA:     batter.xBA ?? null,
          h2hAVG:  (batter.vsCurrentPitcher?.atBats ?? 0) >= 5 ? batter.vsCurrentPitcher.avg : null,
          last3HR: batter.last3HR ?? null,
          barrelPct: batter.barrelPct ?? null,
          last3AVG:  hitProd.last3AVG  > 0 ? hitProd.last3AVG  : null,
          last6AVG:  hitProd.last6AVG  > 0 ? hitProd.last6AVG  : null,
          last10AVG: hitProd.last10AVG > 0 ? hitProd.last10AVG : null,
          hitRate10: hitProd.hitRate10,
          hitRate20: batter.hitRate20 > 0 ? batter.hitRate20 : null,
          xwOBA:   batter.xwOBA > 0 ? batter.xwOBA : null,
          seasonAVG: batter.seasonAVG > 0 ? batter.seasonAVG : null,
          contactPct: batterContactPct(batter),
          zonePct: pitcher ? pitcherZonePct(pitcher) : null,
        });
      }
    }
  }
}

console.log(`Total batter-game observations: ${obs.length}`);
const hitCount = obs.filter(o => o.gotHit).length;
const hrCount  = obs.filter(o => o.gotHR).length;
console.log(`Overall hit rate (baseline): ${hitCount}/${obs.length} = ${pct(hitCount, obs.length)}`);
console.log(`Overall HR rate (baseline):  ${hrCount}/${obs.length} = ${pct(hrCount, obs.length)}\n`);

// ── Generic report builder — works for both Hit and HR ────────────────────────
function calibration(field, outcomeField, label) {
  console.log(`\n  ${label}:`);
  const bands = [
    { l: "75–100", min: 75 }, { l: "70–74", min: 70, max: 74 },
    { l: "65–69",  min: 65, max: 69 }, { l: "60–64", min: 60, max: 64 },
    { l: "55–59",  min: 55, max: 59 }, { l: "50–54", min: 50, max: 54 },
    { l: "45–49",  min: 45, max: 49 }, { l: "40–44", min: 40, max: 44 },
    { l: "< 40",   max: 39 },
  ];
  const results = [];
  for (const b of bands) {
    const subset = obs.filter(o => o[field] >= (b.min ?? 0) && o[field] <= (b.max ?? 100));
    if (subset.length < 5) continue;
    const h = subset.filter(o => o[outcomeField]).length;
    const rate = h / subset.length;
    results.push({ label: b.l, rate, n: subset.length });
    const bar = "█".repeat(Math.round(rate * 20));
    console.log(`    ${b.l.padEnd(8)} ${bar.padEnd(20)} ${(rate*100).toFixed(1).padStart(5)}%  (n=${subset.length})`);
  }
  const top = results[0]?.rate ?? 0;
  const bot = results[results.length-1]?.rate ?? 0;
  console.log(`    Spread (top - bottom): ${((top - bot)*100).toFixed(1)}pp`);
}

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

function correlations(features, outcomeField) {
  for (const f of features) {
    const subset = obs.filter(o => o[f.key] !== null && o[f.key] !== undefined);
    const vals = subset.map(o => o[f.key]);
    const outs = subset.map(o => o[outcomeField]);
    const r = pbr(vals, outs);
    const coverage = pct(subset.length, obs.length);
    const h = subset.filter(o => o[outcomeField]).length;
    console.log(`  ${f.label}`);
    console.log(`    r = ${r !== null ? (r >= 0 ? "+" : "") + r.toFixed(4) : "insufficient data"}  |  coverage ${coverage}  |  ${pct(h, subset.length)} rate when present`);
  }
}

// ═══════════════════════════════════════ HIT SCORE ═══════════════════════════
console.log("\n\n███████████████████████████████████████████████████████████████");
console.log("█  HIT SCORE BACKTEST");
console.log("███████████████████████████████████████████████████████████████");

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 1. SCORE CALIBRATION");
console.log("═══════════════════════════════════════════════════════════════");
calibration("hitProd", "gotHit", "Current production weights (PROD)");
calibration("hitV4", "gotHit", "V4 — streak trimmed 7→3, consistency raised 9→13");
calibration("hitV5", "gotHit", "V5 — V4 + vsHand trimmed 23→18, consistency raised 13→18");
calibration("hitV6", "gotHit", "V6 — PROD weights, but vsHand blends split 60% + seasonAVG 40% (was all-or-nothing fallback) — TESTED, NOT ADOPTED, see below");

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 2. FEATURE CORRELATIONS (point-biserial r vs got_hit)");
console.log("═══════════════════════════════════════════════════════════════");
correlations([
  { key: "avgVsHand", label: "avgVsHand     (vsHand    weight=23)" },
  { key: "homeAvg",   label: "homeAvg       (homeAway  weight=4)" },
  { key: "h2hAVG",    label: "h2hAVG        (h2h       weight=9, coverage ~36%)" },
  { key: "xBA",       label: "xBA           (xBA       weight=4)" },
  { key: "streak",    label: "hittingStreak (streak    weight=7)" },
  { key: "h9",        label: "pitcher H/9   (pitcherH  weight=25)" },
  { key: "hitRate20", label: "hitRate20     (consistency weight=9) — L20 hit rate" },
  { key: "hitRate10", label: "hitRate10     (not currently weighted separately) — L10 hit rate" },
  { key: "last3AVG",  label: "last3AVG      (form component, part of weight=2)" },
  { key: "last6AVG",  label: "last6AVG      (not currently used anywhere in the model)" },
  { key: "last10AVG", label: "last10AVG     (form component, part of weight=2)" },
  { key: "xwOBA",     label: "xwOBA         (used in HR Score only, weight=8 there — NOT in Hit Score)" },
  { key: "seasonAVG", label: "seasonAVG     (not directly weighted — feeds vsHand fallback only)" },
  { key: "contactPct", label: "batter contact% (not in either score — derived from pitchArsenal whiff)" },
  { key: "zonePct",    label: "pitcher zone%  (not in either score — derived from zoneProfile)" },
], "gotHit");

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 3. HOME/AWAY SPLIT (weight currently 4 in production)");
console.log("═══════════════════════════════════════════════════════════════");
const haBands = [
  { l: "≥ .340 (elite)",   filter: v => v >= 0.340 },
  { l: ".300–.339 (good)", filter: v => v >= 0.300 && v < 0.340 },
  { l: ".260–.299 (avg)",  filter: v => v >= 0.260 && v < 0.300 },
  { l: ".220–.259 (weak)", filter: v => v >= 0.220 && v < 0.260 },
  { l: "< .220 (bad)",     filter: v => v < 0.220 },
];
for (const b of haBands) {
  const subset = obs.filter(o => o.homeAvg !== null && b.filter(o.homeAvg));
  if (subset.length < 10) continue;
  const h = subset.filter(o => o.gotHit).length;
  console.log(`  ${b.l.padEnd(22)} hit ${pct(h, subset.length).padStart(6)}  (n=${subset.length})`);
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 4. PITCHER H/9 (production-normalized, recent-or-season, not raw hits)");
console.log("═══════════════════════════════════════════════════════════════");
const h9Bands = [
  { l: "≥ 11.0 H/9 (very hittable)", filter: v => v !== null && v >= 11.0 },
  { l: "8.5–11.0 H/9 (above avg)",   filter: v => v !== null && v >= 8.5 && v < 11.0 },
  { l: "7.0–8.5  H/9 (average)",     filter: v => v !== null && v >= 7.0 && v < 8.5 },
  { l: "5.0–7.0  H/9 (tough)",       filter: v => v !== null && v >= 5.0 && v < 7.0 },
  { l: "< 5.0   H/9 (elite)",        filter: v => v !== null && v < 5.0 },
  { l: "null (neutral default)",     filter: v => v === null },
];
for (const b of h9Bands) {
  const subset = obs.filter(o => b.filter(o.h9));
  if (subset.length < 5) continue;
  const h = subset.filter(o => o.gotHit).length;
  console.log(`  ${b.l.padEnd(32)} ${pct(h, subset.length).padStart(6)}  (n=${subset.length})`);
}

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
console.log("\n  Cold streaks:");
for (let c = 0; c <= 8; c++) {
  const subset = obs.filter(o => o.cold === c);
  if (subset.length < 10) continue;
  const h = subset.filter(o => o.gotHit).length;
  console.log(`    Cold  ${String(c).padEnd(2)}  ${pct(h, subset.length).padStart(6)}  (n=${subset.length})`);
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 5b. HIT-RATE CONSISTENCY BANDS — does '8/10' or '9/10' actually mean something?");
console.log("═══════════════════════════════════════════════════════════════");
const hrBands = [
  { l: "≥ 90% (9-10/10)",  filter: v => v >= 0.90 },
  { l: "70-89% (7-8/10)",  filter: v => v >= 0.70 && v < 0.90 },
  { l: "50-69% (5-6/10)",  filter: v => v >= 0.50 && v < 0.70 },
  { l: "30-49% (3-4/10)",  filter: v => v >= 0.30 && v < 0.50 },
  { l: "< 30% (0-2/10)",   filter: v => v < 0.30 },
];
for (const b of hrBands) {
  const subset = obs.filter(o => o.hitRate10 !== null && b.filter(o.hitRate10));
  if (subset.length < 10) continue;
  const h = subset.filter(o => o.gotHit).length;
  console.log(`  L10 hit rate ${b.l.padEnd(16)} ${pct(h, subset.length).padStart(6)}  (n=${subset.length})`);
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 5c. STREAK LENGTH BUCKETS — is there a real threshold?");
console.log("═══════════════════════════════════════════════════════════════");
const streakBuckets = [
  { l: "No streak (0)",     filter: v => v === 0 },
  { l: "1-2 games",         filter: v => v >= 1 && v <= 2 },
  { l: "3-4 games",         filter: v => v >= 3 && v <= 4 },
  { l: "5-8 games",         filter: v => v >= 5 && v <= 8 },
  { l: "9+ games",          filter: v => v >= 9 },
];
for (const b of streakBuckets) {
  const subset = obs.filter(o => b.filter(o.streak));
  if (subset.length < 10) continue;
  const h = subset.filter(o => o.gotHit).length;
  console.log(`  ${b.l.padEnd(18)} ${pct(h, subset.length).padStart(6)}  (n=${subset.length})`);
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 5d. BULLPEN / SPOT-START GAMES — do batters actually do better?");
console.log("     (isBullpenGame = last-3-starts sample too thin to trust, <9 IP —");
console.log("      the exact case the pitcherH neutral-default fix targets)");
console.log("═══════════════════════════════════════════════════════════════");
for (const b of [
  { l: "Bullpen/spot-start game", v: true },
  { l: "Normal starter sample",   v: false },
]) {
  const subset = obs.filter(o => o.isBullpenGame === b.v);
  if (subset.length < 10) continue;
  const h = subset.filter(o => o.gotHit).length;
  const avgScore = subset.reduce((a,o) => a + o.hitProd, 0) / subset.length;
  console.log(`  ${b.l.padEnd(24)} ${pct(h, subset.length).padStart(6)} hit rate  |  avg score ${avgScore.toFixed(0)}  (n=${subset.length})`);
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 5e. HOT BATTER vs TOUGH PITCHER — which one wins when they conflict?");
console.log("═══════════════════════════════════════════════════════════════");
const batterTier = (o) => o.hitRate20 === null ? null : o.hitRate20 >= 0.65 ? "Hot" : o.hitRate20 <= 0.40 ? "Cold" : "Neutral";
const pitcherTier = (o) => o.h9 === null ? null : o.h9 < 7.0 ? "Tough" : o.h9 >= 10.0 ? "Hittable" : "Average";
const grid = {};
for (const o of obs) {
  const bt = batterTier(o), pt = pitcherTier(o);
  if (!bt || !pt) continue;
  const key = `${bt}|${pt}`;
  grid[key] = grid[key] ?? { n: 0, hits: 0 };
  grid[key].n++;
  if (o.gotHit) grid[key].hits++;
}
console.log("                  Tough Pitcher      Average Pitcher    Hittable Pitcher");
for (const bt of ["Hot", "Neutral", "Cold"]) {
  const row = ["Tough", "Average", "Hittable"].map(pt => {
    const g = grid[`${bt}|${pt}`];
    return g && g.n >= 10 ? `${pct(g.hits, g.n).padStart(6)} (n=${g.n})` : "   —          ";
  });
  console.log(`  ${bt.padEnd(9)}     ${row[0].padEnd(19)}${row[1].padEnd(19)}${row[2]}`);
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 5f. HOT HITTERS WHO WENT COLD — do they actually bounce back?");
console.log("     batterTier uses hitRate20 (underlying form), crossed against");
console.log("     CURRENT cold streak (games since their last hit) — tests whether");
console.log("     a genuinely hot hitter hitless 1-2 games is 'due', or whether");
console.log("     that's model folklore not backed by the data.");
console.log("═══════════════════════════════════════════════════════════════");
const coldGrid = {};
for (const o of obs) {
  const bt = batterTier(o);
  if (!bt) continue;
  const cb = o.cold === 0 ? "0 (had a hit last game)" : o.cold === 1 ? "1 game hitless" : o.cold === 2 ? "2 games hitless" : "3+ games hitless";
  const key = `${bt}|${cb}`;
  coldGrid[key] = coldGrid[key] ?? { n: 0, hits: 0 };
  coldGrid[key].n++;
  if (o.gotHit) coldGrid[key].hits++;
}
for (const bt of ["Hot", "Neutral", "Cold"]) {
  console.log(`  ${bt} hitters (hitRate20 ${bt === "Hot" ? "≥65%" : bt === "Cold" ? "≤40%" : "40-65%"}):`);
  for (const cb of ["0 (had a hit last game)", "1 game hitless", "2 games hitless", "3+ games hitless"]) {
    const g = coldGrid[`${bt}|${cb}`];
    if (!g || g.n < 10) { console.log(`    ${cb.padEnd(24)}  n too small`); continue; }
    console.log(`    ${cb.padEnd(24)}  ${pct(g.hits, g.n).padStart(6)}  (n=${g.n})`);
  }
}
// Findings above led directly to a fix, now live in production (lib/scores.ts):
console.log("\n  Current PROD momentum modifier at each cold-streak length (updated):");
console.log("    coldStreak=0: no modifier");
console.log("    coldStreak=1-2: bounce-back bonus scaled by hitRate20 (+1 to +3), or -1 if hitRate20 < 30%");
console.log("    coldStreak=3+: no modifier — data showed no tier gets worse from here");

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 5g. BATTER CONTACT% vs PITCHER ZONE% — does a contact hitter feast on a");
console.log("     zone-pounder, or does a deceptive out-of-zone arm neutralize contact?");
console.log("═══════════════════════════════════════════════════════════════");
const contactTier = (v) => v === null ? null : v >= 82 ? "High Contact" : v <= 74 ? "Low Contact" : "Avg Contact";
const zoneTier = (v) => v === null ? null : v >= 50 ? "Pounds Zone" : v <= 42 ? "Avoids Zone" : "Avg Zone%";
const cgrid = {};
for (const o of obs) {
  const ct = contactTier(o.contactPct), zt = zoneTier(o.zonePct);
  if (!ct || !zt) continue;
  const key = `${ct}|${zt}`;
  cgrid[key] = cgrid[key] ?? { n: 0, hits: 0 };
  cgrid[key].n++;
  if (o.gotHit) cgrid[key].hits++;
}
console.log("                    Avoids Zone        Avg Zone%          Pounds Zone");
for (const ct of ["High Contact", "Avg Contact", "Low Contact"]) {
  const row = ["Avoids Zone", "Avg Zone%", "Pounds Zone"].map(zt => {
    const g = cgrid[`${ct}|${zt}`];
    return g && g.n >= 10 ? `${pct(g.hits, g.n).padStart(6)} (n=${g.n})` : "   —          ";
  });
  console.log(`  ${ct.padEnd(13)}     ${row[0].padEnd(19)}${row[1].padEnd(19)}${row[2]}`);
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 6. FALSE POSITIVES — score ≥ 70 but no hit (PROD)");
console.log("═══════════════════════════════════════════════════════════════");
const fpProd = obs.filter(o => o.hitProd >= 70 && !o.gotHit);
const highProd = obs.filter(o => o.hitProd >= 70);
console.log(`  PROD: ${fpProd.length} false positives out of ${highProd.length} high-score picks (${pct(fpProd.length, highProd.length)} FP rate)`);
console.log("\n  Top 15 costliest false positives:");
console.log("  Score  Name                       vsHand  homeAvg  xBA    Streak  H9");
for (const o of fpProd.sort((a,b) => b.hitProd - a.hitProd).slice(0, 15)) {
  console.log(
    `  ${String(o.hitProd).padEnd(6)} ${o.name.padEnd(26)} ` +
    `${fmt3(o.avgVsHand)}   ${fmt3(o.homeAvg)}   ${fmt3(o.xBA)}  ` +
    `${String(o.streak).padEnd(7)} ${o.h9 !== null ? o.h9.toFixed(1) : "—"}`
  );
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 7. SUMMARY");
console.log("═══════════════════════════════════════════════════════════════");
const p60 = obs.filter(o => o.hitProd >= 60), h60 = p60.filter(o => o.gotHit).length;
const v460 = obs.filter(o => o.hitV4 >= 60), hv460 = v460.filter(o => o.gotHit).length;
const v560 = obs.filter(o => o.hitV5 >= 60), hv560 = v560.filter(o => o.gotHit).length;
const v660 = obs.filter(o => o.hitV6 >= 60), hv660 = v660.filter(o => o.gotHit).length;
const p70 = obs.filter(o => o.hitProd >= 70), h70 = p70.filter(o => o.gotHit).length;
const v470 = obs.filter(o => o.hitV4 >= 70), hv470 = v470.filter(o => o.gotHit).length;
const v570 = obs.filter(o => o.hitV5 >= 70), hv570 = v570.filter(o => o.gotHit).length;
const v670 = obs.filter(o => o.hitV6 >= 70), hv670 = v670.filter(o => o.gotHit).length;
console.log(`  PROD now includes the adopted V7 momentum fix (bounce-back scaled by hitRate20 through coldStreak=2) — see lib/scores.ts.`);
console.log(`  Score ≥ 60: PROD ${pct(h60, p60.length).padStart(6)} (n=${p60.length})  |  V4 ${pct(hv460, v460.length).padStart(6)} (n=${v460.length})  |  V5 ${pct(hv560, v560.length).padStart(6)} (n=${v560.length})  |  V6 ${pct(hv660, v660.length).padStart(6)} (n=${v660.length})`);
console.log(`  Score ≥ 70: PROD ${pct(h70, p70.length).padStart(6)} (n=${p70.length})  |  V4 ${pct(hv470, v470.length).padStart(6)} (n=${v470.length})  |  V5 ${pct(hv570, v570.length).padStart(6)} (n=${v570.length})  |  V6 ${pct(hv670, v670.length).padStart(6)} (n=${v670.length})`);

// ═══════════════════════════════════════ HR SCORE ═════════════════════════════
console.log("\n\n███████████████████████████████████████████████████████████████");
console.log("█  HR SCORE BACKTEST");
console.log("███████████████████████████████████████████████████████████████");

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 1. SCORE CALIBRATION");
console.log("═══════════════════════════════════════════════════════════════");
calibration("hrProd", "gotHR", "Current production weights (PROD)");

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 2. FEATURE CORRELATIONS (point-biserial r vs got_hr)");
console.log("═══════════════════════════════════════════════════════════════");
correlations([
  { key: "last3HR",   label: "last3HR     (recentHR  weight=20)" },
  { key: "barrelPct", label: "barrelPct   (barrel    weight=11)" },
  { key: "hrPer9",     label: "pitcher HR/9 (pitcherHR weight=6)" },
], "gotHR");

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 3. PITCHER HR/9 (vs batter hand, fallback to L3/season rate)");
console.log("═══════════════════════════════════════════════════════════════");
const hrP9Bands = [
  { l: "≥ 1.8 HR/9 (HR prone)",   filter: v => v !== null && v >= 1.8 },
  { l: "1.2–1.8 (above avg)",     filter: v => v !== null && v >= 1.2 && v < 1.8 },
  { l: "0.6–1.2 (average)",       filter: v => v !== null && v >= 0.6 && v < 1.2 },
  { l: "< 0.6 (suppresses HRs)",  filter: v => v !== null && v < 0.6 },
];
for (const b of hrP9Bands) {
  const subset = obs.filter(o => b.filter(o.hrPer9));
  if (subset.length < 5) continue;
  const h = subset.filter(o => o.gotHR).length;
  console.log(`  ${b.l.padEnd(32)} ${pct(h, subset.length).padStart(6)}  (n=${subset.length})`);
}

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 4. FALSE POSITIVES — score ≥ 60 but no HR (PROD)");
console.log("═══════════════════════════════════════════════════════════════");
const hrFp = obs.filter(o => o.hrProd >= 60 && !o.gotHR);
const hrHigh = obs.filter(o => o.hrProd >= 60);
console.log(`  PROD: ${hrFp.length} false positives out of ${hrHigh.length} high-score picks (${pct(hrFp.length, hrHigh.length)} FP rate)`);

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" 5. SUMMARY");
console.log("═══════════════════════════════════════════════════════════════");
const hp50 = obs.filter(o => o.hrProd >= 50), hh50 = hp50.filter(o => o.gotHR).length;
const hp60 = obs.filter(o => o.hrProd >= 60), hh60 = hp60.filter(o => o.gotHR).length;
console.log(`  Score ≥ 50: PROD ${pct(hh50, hp50.length).padStart(6)} (n=${hp50.length})  vs baseline ${pct(hrCount, obs.length)}`);
console.log(`  Score ≥ 60: PROD ${pct(hh60, hp60.length).padStart(6)} (n=${hp60.length})  vs baseline ${pct(hrCount, obs.length)}`);

console.log("\nDone.\n");
