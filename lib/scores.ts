import type { MLBBatter, MLBPitcher } from "@/types/mlb";

/**
 * Hit Score (0–100)
 *
 * Weights:
 *  35 pts — Recent form: last10AVG + last3AVG (short-term momentum)
 *  15 pts — Hit consistency: games with a hit / games played (last 10)
 *  25 pts — Matchup AVG vs pitcher hand (platoon split — structural, not noise)
 *   8 pts — Hitting streak bonus
 *   7 pts — Park factor (hitter-friendly parks produce more hits)
 *  10 pts — Opposing pitcher softness (hits allowed in last 3 starts)
 */
export function calcHitScore(
  batter: MLBBatter,
  pitcher?: MLBPitcher,
  parkFactor = 1.0
): number {
  let score = 0;

  // 1. Recent AVG form (0–35)
  const formScore = (batter.last10AVG / 0.380) * 22 + (batter.last3AVG / 0.480) * 13;
  score += Math.min(35, formScore);

  // 2. Hit consistency — games with a hit (0–15)
  const gp = batter.last10Games.length;
  if (gp > 0) {
    const hitsIn10 = batter.last10Games.filter((g) => g.hits > 0).length;
    score += (hitsIn10 / gp) * 15;
  }

  // 3. Matchup vs pitcher hand (0–25)
  if (pitcher) {
    const matchupAvg = pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight;
    score += Math.min(25, (matchupAvg / 0.360) * 25);
  } else {
    // No pitcher announced — use season AVG at lower weight
    score += Math.min(14, (batter.seasonAVG / 0.340) * 14);
  }

  // 4. Hitting streak bonus (0–8)
  score += Math.min(8, batter.hittingStreak * 0.9);

  // 5. Park factor (0–7)  — range 0.88 (Oracle) to 1.24 (Coors)
  const parkScore = ((parkFactor - 0.88) / (1.24 - 0.88)) * 7;
  score += Math.max(0, Math.min(7, parkScore));

  // 6. Opposing pitcher softness (0–10)
  // 15+ H in last 3 starts = very hittable, 4 H = elite/tough
  if (pitcher) {
    const softness = Math.max(0, (pitcher.last3HitsAllowed - 4) / 11);
    score += Math.min(10, softness * 10);
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * HR Score (0–100)
 *
 * Weights:
 *  30 pts — Recent HR activity: last10HR + last6HR + last3HR
 *  20 pts — Season SLG (raw power baseline)
 *  20 pts — Matchup SLG vs pitcher hand
 *  20 pts — Park factor (outsized effect on HR vs hits)
 *  10 pts — Recent SLG last 10 games
 */
export function calcHRScore(
  batter: MLBBatter,
  pitcher?: MLBPitcher,
  parkFactor = 1.0
): number {
  let score = 0;

  // 1. Recent HR activity (0–30)
  // Scale: 4 HR in last 10 = elite (15pts), 3 in last 6 = elite (10pts), 2 in last 3 = elite (5pts)
  score += Math.min(15, (batter.last10HR / 4) * 15);
  score += Math.min(10, (batter.last6HR / 3) * 10);
  score += Math.min(5,  (batter.last3HR / 2) * 5);

  // 2. Season SLG — power baseline (0–20)
  score += Math.min(20, (batter.seasonSLG / 0.620) * 20);

  // 3. Matchup SLG vs pitcher hand (0–20)
  if (pitcher) {
    const matchupSLG = pitcher.hand === "L" ? batter.slgVsLeft : batter.slgVsRight;
    score += Math.min(20, (matchupSLG / 0.680) * 20);
  } else {
    score += Math.min(12, (batter.seasonSLG / 0.600) * 12);
  }

  // 4. Park factor — critical for HR (0–20)
  const parkScore = ((parkFactor - 0.88) / (1.24 - 0.88)) * 20;
  score += Math.max(0, Math.min(20, parkScore));

  // 5. Recent SLG last 10 (0–10)
  score += Math.min(10, (batter.last10SLG / 0.700) * 10);

  return Math.min(100, Math.max(0, Math.round(score)));
}

/** Color class for a score value */
export function scoreColor(score: number) {
  if (score >= 75) return "text-green-600 dark:text-green-400";
  if (score >= 55) return "text-amber-600 dark:text-amber-400";
  if (score >= 35) return "text-muted-foreground";
  return "text-red-500 dark:text-red-400";
}

/** Background pill style for a score badge */
export function scoreBadgeClass(score: number) {
  if (score >= 75)
    return "bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/30";
  if (score >= 55)
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30";
  if (score >= 35)
    return "bg-muted text-muted-foreground border border-border";
  return "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30";
}
