/**
 * Outcome tracking — writes per-batter prediction + actual result to Supabase
 * after each daily sync. This is the data that feeds the monthly recalibration.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailySnapshot, MLBBatter, MLBPitcher } from "@/types/mlb";
import { HIT_WEIGHTS, HR_WEIGHTS } from "@/lib/model-weights";

// ── Pre-game feature reconstruction ──────────────────────────────────────────

function clamp(v: number, max: number) { return Math.min(max, Math.max(0, v)); }

/** Reconstruct pre-game features by excluding today's game from rolling stats */
function buildPreGameFeatures(batter: MLBBatter, pitcher: MLBPitcher | undefined, today: string) {
  const prior = (batter.last10Games ?? []).filter(g => g.date !== today);
  const recent3  = prior.slice(0, 3);
  const recent10 = prior.slice(0, 10);

  const windowAvg = (games: typeof prior) => {
    const ab = games.reduce((s, g) => s + (g.atBats ?? 0), 0);
    const h  = games.reduce((s, g) => s + (g.hits   ?? 0), 0);
    return ab > 0 ? h / ab : null;
  };

  const last3AVG  = windowAvg(recent3);
  const last10AVG = windowAvg(recent10);
  const hitRate10 = recent10.length > 0
    ? recent10.filter(g => g.hits > 0).length / recent10.length
    : null;

  // Pre-game streak from prior games
  let hittingStreak = 0;
  for (const g of prior) {
    if ((g.hits ?? 0) > 0) hittingStreak++;
    else break;
  }

  // Consecutive hitless games entering today (cold streak)
  let coldStreak = 0;
  for (const g of prior) {
    if ((g.hits ?? 0) === 0) coldStreak++;
    else break;
  }
  const hitlessYesterday = prior.length > 0 ? (prior[0].hits ?? 0) === 0 : null;

  const pitcherHand = pitcher?.hand ?? null;
  const rawVsHand   = pitcherHand === "L" ? batter.avgVsLeft : batter.avgVsRight;
  const avgVsHand   = (rawVsHand && rawVsHand > 0) ? rawVsHand : (batter.seasonAVG ?? null);
  const situationalAVG = batter.isHome
    ? (batter.homeAVG && batter.homeAVG > 0 ? batter.homeAVG : null)
    : (batter.awayAVG && batter.awayAVG > 0 ? batter.awayAVG : null);
  const h2hAVG = (batter.vsCurrentPitcher?.atBats ?? 0) >= 5
    ? batter.vsCurrentPitcher!.avg
    : null;

  return {
    // Hit features
    last3AVG,
    last10AVG,
    hitRate10,
    hitRate20: batter.hitRate20 ?? null,
    avgVsHand,
    situationalAVG,
    hittingStreak,
    coldStreak,
    hitlessYesterday,
    battingOrder: batter.battingOrder ?? null,
    xBA:         batter.xBA         ?? null,
    hardHitPct:  batter.hardHitPct  ?? null,
    barrelPct:   batter.barrelPct   ?? null,
    h2hAVG,
    pitcherHand,
    isHome: batter.isHome ?? null,
    last3HitsAllowed: pitcher?.last3HitsAllowed ?? null,
    // HR features
    last3HR:   batter.last3HR   ?? 0,
    last6HR:   batter.last6HR   ?? 0,
    last10HR:  batter.last10HR  ?? 0,
    seasonSLG: batter.seasonSLG ?? 0,
    slgVsHand: pitcherHand === "L" ? (batter.slgVsLeft ?? 0) : (batter.slgVsRight ?? 0),
    last10SLG: batter.last10SLG ?? 0,
    last3HRAllowed:    pitcher?.last3HRAllowed    ?? null,
    last3InningsPitched: pitcher?.last3InningsPitched ?? null,
    seasonHRAllowed: pitcher?.seasonHRAllowed ?? null,
  };
}

/** Compute a pre-game hit score from reconstructed features */
function computePreGameHitScore(f: ReturnType<typeof buildPreGameFeatures>, parkFactor: number): number {
  let score = 0;

  const form = ((f.last10AVG ?? 0) / 0.380) * (HIT_WEIGHTS.form * 0.65)
             + ((f.last3AVG  ?? 0) / 0.480) * (HIT_WEIGHTS.form * 0.35);
  score += clamp(form, HIT_WEIGHTS.form);

  const consistencyRate = f.hitRate20 ?? f.hitRate10 ?? 0;
  score += clamp(consistencyRate * HIT_WEIGHTS.consistency, HIT_WEIGHTS.consistency);

  score += clamp(((f.avgVsHand ?? 0) / 0.360) * HIT_WEIGHTS.vsHand, HIT_WEIGHTS.vsHand);

  if (f.situationalAVG !== null) {
    score += clamp((f.situationalAVG / 0.340) * HIT_WEIGHTS.homeAway, HIT_WEIGHTS.homeAway);
  }

  if (f.hittingStreak > 0) {
    score += clamp((Math.log(1 + f.hittingStreak) / Math.log(16)) * HIT_WEIGHTS.streak, HIT_WEIGHTS.streak);
  }

  score += clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 4, 4);

  if (f.last3HitsAllowed !== null) {
    const softness = Math.max(0, (f.last3HitsAllowed - 4) / 11);
    score += clamp(softness * HIT_WEIGHTS.pitcherH, HIT_WEIGHTS.pitcherH);
  }

  if (f.xBA !== null) score += clamp((f.xBA / 0.340) * HIT_WEIGHTS.xBA, HIT_WEIGHTS.xBA);
  if (f.hardHitPct !== null) score += clamp((f.hardHitPct / 55) * HIT_WEIGHTS.hardHit, HIT_WEIGHTS.hardHit);
  if (f.h2hAVG !== null) score += clamp((f.h2hAVG / 0.300) * HIT_WEIGHTS.h2h, HIT_WEIGHTS.h2h);

  return Math.min(100, Math.max(0, Math.round(score)));
}

/** Compute a pre-game HR score from reconstructed features */
function computePreGameHRScore(f: ReturnType<typeof buildPreGameFeatures>, parkFactor: number): number {
  let score = 0;

  const recentHR =
    clamp((f.last3HR / 2)  * (HR_WEIGHTS.recentHR * 0.50), HR_WEIGHTS.recentHR * 0.50) +
    clamp((f.last6HR / 3)  * (HR_WEIGHTS.recentHR * 0.35), HR_WEIGHTS.recentHR * 0.35) +
    clamp((f.last10HR / 4) * (HR_WEIGHTS.recentHR * 0.15), HR_WEIGHTS.recentHR * 0.15);
  score += recentHR;

  score += clamp((f.seasonSLG / 0.620) * HR_WEIGHTS.seasonSLG, HR_WEIGHTS.seasonSLG);
  score += clamp((f.slgVsHand / 0.680) * HR_WEIGHTS.slgVsHand, HR_WEIGHTS.slgVsHand);
  score += clamp((f.last10SLG / 0.700) * HR_WEIGHTS.recentSLG, HR_WEIGHTS.recentSLG);
  score += clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * HR_WEIGHTS.park, HR_WEIGHTS.park);

  if (f.barrelPct  !== null) score += clamp((f.barrelPct  / 20) * HR_WEIGHTS.barrel,  HR_WEIGHTS.barrel);
  if (f.hardHitPct !== null) score += clamp((f.hardHitPct / 55) * HR_WEIGHTS.hardHit, HR_WEIGHTS.hardHit);

  if (f.last3HRAllowed !== null && f.last3InningsPitched !== null) {
    const hrPer9 = f.last3InningsPitched > 0
      ? (f.last3HRAllowed / f.last3InningsPitched) * 9
      : (f.seasonHRAllowed ?? 0) > 0 ? (f.seasonHRAllowed! / 30) : 0;
    score += clamp((hrPer9 / 2.0) * HR_WEIGHTS.pitcherHR, HR_WEIGHTS.pitcherHR);
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Write per-batter prediction + outcome rows for a completed game day.
 * Called from the sync background function after the snapshot is saved.
 * Safe to call multiple times — uses upsert (ON CONFLICT DO UPDATE).
 */
export async function writeOutcomes(
  snapshot: DailySnapshot,
  sb: SupabaseClient,
): Promise<void> {
  const today = snapshot.date;
  const rows: object[] = [];

  for (const game of snapshot.games) {
    const pairs: [MLBBatter[], MLBPitcher | undefined][] = [
      [game.homeLineup, game.awayStartingPitcher],
      [game.awayLineup, game.homeStartingPitcher],
    ];

    for (const [lineup, pitcher] of pairs) {
      for (const batter of lineup) {
        const todayGame = batter.last10Games?.[0];
        if (!todayGame || todayGame.date !== today) continue;
        if ((todayGame.atBats ?? 0) === 0) continue;

        const features   = buildPreGameFeatures(batter, pitcher, today);
        const parkFactor = game.parkFactor ?? 1.0;
        const hit_score  = computePreGameHitScore(features, parkFactor);
        const hr_score   = computePreGameHRScore(features, parkFactor);

        rows.push({
          date:        today,
          batter_id:   batter.id,
          batter_name: batter.name,
          team:        batter.teamAbbreviation ?? null,
          game_pk:     game.gamePk,
          hit_score,
          hr_score,
          got_hit:     (todayGame.hits ?? 0) > 0,
          got_hr:      (todayGame.hr   ?? 0) > 0,
          at_bats:     todayGame.atBats ?? 0,
          hits:        todayGame.hits   ?? 0,
          hrs:         todayGame.hr     ?? 0,
          features,
        });
      }
    }
  }

  if (rows.length === 0) return;

  const { error } = await sb
    .from("batter_outcomes")
    .upsert(rows, { onConflict: "date,batter_id" });

  if (error) {
    console.error("[outcomes] Supabase upsert error:", error.message);
  } else {
    console.log(`[outcomes] Wrote ${rows.length} outcome rows for ${today}`);
  }
}
