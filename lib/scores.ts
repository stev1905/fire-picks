import type { MLBBatter, MLBPitcher } from "@/types/mlb";

export interface ScoreComponent {
  label: string;
  earned: number;
  max: number;
}

export interface ScoreBreakdown {
  total: number;
  components: ScoreComponent[];
}

function clamp(v: number, max: number) {
  return Math.min(max, Math.max(0, v));
}

/**
 * Hit Score (0–100)
 *
 *  35 — Recent AVG form: last10AVG + last3AVG
 *  15 — Hit consistency: games with a hit / games played (last 10)
 *  25 — Matchup AVG vs pitcher hand (platoon split)
 *   8 — Hitting streak bonus
 *   7 — Park factor
 *  10 — Opposing pitcher softness (hits allowed last 3 starts)
 */
export function calcHitScoreBreakdown(
  batter: MLBBatter,
  pitcher?: MLBPitcher,
  parkFactor = 1.0
): ScoreBreakdown {
  const components: ScoreComponent[] = [];

  // 1. Recent AVG form (0–35)
  const formRaw = (batter.last10AVG / 0.380) * 22 + (batter.last3AVG / 0.480) * 13;
  const form = clamp(formRaw, 35);
  components.push({ label: "Recent AVG (L3/L10)", earned: Math.round(form), max: 35 });

  // 2. Hit consistency (0–15)
  const gp = batter.last10Games.length;
  const hitsIn10 = gp > 0 ? batter.last10Games.filter((g) => g.hits > 0).length : 0;
  const consistency = gp > 0 ? (hitsIn10 / gp) * 15 : 0;
  components.push({ label: "Hit Rate (last 10)", earned: Math.round(consistency), max: 15 });

  // 3. Matchup vs pitcher hand (0–25)
  let matchup: number;
  if (pitcher) {
    const matchupAvg = pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight;
    matchup = clamp((matchupAvg / 0.360) * 25, 25);
    components.push({ label: `AVG vs ${pitcher.hand === "L" ? "LHP" : "RHP"}`, earned: Math.round(matchup), max: 25 });
  } else {
    matchup = clamp((batter.seasonAVG / 0.340) * 14, 14);
    components.push({ label: "Season AVG (no SP)", earned: Math.round(matchup), max: 14 });
  }

  // 4. Hitting streak (0–8)
  const streak = clamp(batter.hittingStreak * 0.9, 8);
  components.push({ label: "Hit Streak", earned: Math.round(streak), max: 8 });

  // 5. Park factor (0–7)  range 0.88–1.24
  const park = clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 7, 7);
  components.push({ label: "Park Factor", earned: Math.round(park), max: 7 });

  // 6. Opposing pitcher softness (0–10)
  let pitcherScore = 0;
  if (pitcher) {
    const softness = Math.max(0, (pitcher.last3HitsAllowed - 4) / 11);
    pitcherScore = clamp(softness * 10, 10);
    components.push({ label: "Pitcher Hits Allowed (L3)", earned: Math.round(pitcherScore), max: 10 });
  }

  const total = Math.min(100, Math.max(0, Math.round(
    form + consistency + matchup + streak + park + pitcherScore
  )));

  return { total, components };
}

/**
 * HR Score (0–100)
 *
 *  30 — Recent HR activity: last10HR + last6HR + last3HR
 *  20 — Season SLG (power baseline)
 *  20 — Matchup SLG vs pitcher hand
 *  20 — Park factor (weighted higher — critical for HR)
 *  10 — Recent SLG last 10
 */
export function calcHRScoreBreakdown(
  batter: MLBBatter,
  pitcher?: MLBPitcher,
  parkFactor = 1.0
): ScoreBreakdown {
  const components: ScoreComponent[] = [];

  // 1. Recent HR activity (0–30)
  const recentHR =
    clamp((batter.last10HR / 4) * 15, 15) +
    clamp((batter.last6HR  / 3) * 10, 10) +
    clamp((batter.last3HR  / 2) * 5,  5);
  components.push({ label: "Recent HRs (L3/L6/L10)", earned: Math.round(recentHR), max: 30 });

  // 2. Season SLG (0–20)
  const slg = clamp((batter.seasonSLG / 0.620) * 20, 20);
  components.push({ label: "Season SLG", earned: Math.round(slg), max: 20 });

  // 3. Matchup SLG vs pitcher hand (0–20)
  let matchup: number;
  if (pitcher) {
    const matchupSLG = pitcher.hand === "L" ? batter.slgVsLeft : batter.slgVsRight;
    matchup = clamp((matchupSLG / 0.680) * 20, 20);
    components.push({ label: `SLG vs ${pitcher.hand === "L" ? "LHP" : "RHP"}`, earned: Math.round(matchup), max: 20 });
  } else {
    matchup = clamp((batter.seasonSLG / 0.600) * 12, 12);
    components.push({ label: "Season SLG (no SP)", earned: Math.round(matchup), max: 12 });
  }

  // 4. Park factor — critical for HR (0–20)
  const park = clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 20, 20);
  components.push({ label: "Park Factor", earned: Math.round(park), max: 20 });

  // 5. Recent SLG last 10 (0–10)
  const recentSlg = clamp((batter.last10SLG / 0.700) * 10, 10);
  components.push({ label: "SLG Last 10", earned: Math.round(recentSlg), max: 10 });

  const total = Math.min(100, Math.max(0, Math.round(
    recentHR + slg + matchup + park + recentSlg
  )));

  return { total, components };
}

// Convenience wrappers for sort comparisons
export function calcHitScore(batter: MLBBatter, pitcher?: MLBPitcher, parkFactor = 1.0) {
  return calcHitScoreBreakdown(batter, pitcher, parkFactor).total;
}

export function calcHRScore(batter: MLBBatter, pitcher?: MLBPitcher, parkFactor = 1.0) {
  return calcHRScoreBreakdown(batter, pitcher, parkFactor).total;
}

export function scoreBadgeClass(score: number) {
  if (score >= 75) return "bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/30";
  if (score >= 55) return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30";
  if (score >= 35) return "bg-muted text-muted-foreground border border-border";
  return "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30";
}
