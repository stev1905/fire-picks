import type { MLBBatter, MLBPitcher } from "@/types/mlb";

export interface ScoreComponent {
  label: string;
  earned: number;
  max: number;
  value?: string; // actual stat shown in tooltip
}

export interface ScoreBreakdown {
  total: number;
  components: ScoreComponent[];
}

function clamp(v: number, max: number) {
  return Math.min(max, Math.max(0, v));
}

function fmt(v: number) {
  return v.toFixed(3).replace(/^0/, "");
}

/**
 * Hit Score (0–100)
 *
 *  25 — Recent AVG form: last10AVG + last3AVG
 *  12 — Hit consistency: games with a hit / last 10
 *  20 — Matchup AVG vs pitcher hand (platoon split)
 *   8 — Hitting streak bonus
 *   7 — Park factor
 *   8 — Opposing pitcher softness (hits allowed last 3 starts)
 *  10 — xBA (Baseball Savant expected batting avg)
 *   5 — Hard Hit % (ev95percent)
 *   5 — Career H2H vs opposing pitcher (min 5 AB)
 */
export function calcHitScoreBreakdown(
  batter: MLBBatter,
  pitcher?: MLBPitcher,
  parkFactor = 1.0
): ScoreBreakdown {
  const components: ScoreComponent[] = [];

  // 1. Recent AVG form (0–25)
  const formRaw = (batter.last10AVG / 0.380) * 16 + (batter.last3AVG / 0.480) * 9;
  const form = clamp(formRaw, 25);
  components.push({
    label: "Recent AVG (L3/L10)",
    earned: Math.round(form),
    max: 25,
    value: `${fmt(batter.last3AVG)} / ${fmt(batter.last10AVG)}`,
  });

  // 2. Hit consistency (0–12)
  const gp = batter.last10Games.length;
  const hitsIn10 = gp > 0 ? batter.last10Games.filter((g) => g.hits > 0).length : 0;
  const consistency = gp > 0 ? (hitsIn10 / gp) * 12 : 0;
  components.push({
    label: "Hit Rate (last 10)",
    earned: Math.round(consistency),
    max: 12,
    value: `${hitsIn10}/${gp} games`,
  });

  // 3. Matchup vs pitcher hand (0–20)
  let matchup: number;
  if (pitcher) {
    const matchupAvg = pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight;
    matchup = clamp((matchupAvg / 0.360) * 20, 20);
    components.push({
      label: `AVG vs ${pitcher.hand === "L" ? "LHP" : "RHP"}`,
      earned: Math.round(matchup),
      max: 20,
      value: fmt(matchupAvg),
    });
  } else {
    matchup = clamp((batter.seasonAVG / 0.340) * 12, 12);
    components.push({
      label: "Season AVG (no SP)",
      earned: Math.round(matchup),
      max: 12,
      value: fmt(batter.seasonAVG),
    });
  }

  // 4. Hitting streak (0–8)
  const streak = clamp(batter.hittingStreak * 0.9, 8);
  components.push({
    label: "Hit Streak",
    earned: Math.round(streak),
    max: 8,
    value: batter.hittingStreak > 0 ? `${batter.hittingStreak} games` : "—",
  });

  // 5. Park factor (0–7)  range 0.88–1.24
  const park = clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 7, 7);
  components.push({
    label: "Park Factor",
    earned: Math.round(park),
    max: 7,
    value: parkFactor.toFixed(2),
  });

  // 6. Opposing pitcher softness (0–8)
  let pitcherScore = 0;
  if (pitcher) {
    const softness = Math.max(0, (pitcher.last3HitsAllowed - 4) / 11);
    pitcherScore = clamp(softness * 8, 8);
    components.push({
      label: "Pitcher Hits Allowed (L3)",
      earned: Math.round(pitcherScore),
      max: 8,
      value: `${pitcher.last3HitsAllowed} hits`,
    });
  }

  // 7. xBA (0–10)
  let xBAScore = 0;
  if (batter.xBA !== undefined && batter.xBA > 0) {
    xBAScore = clamp((batter.xBA / 0.340) * 10, 10);
  }
  components.push({
    label: "xBA (Statcast)",
    earned: Math.round(xBAScore),
    max: 10,
    value: batter.xBA !== undefined ? fmt(batter.xBA) : "—",
  });

  // 8. Hard Hit % (0–5)
  let hardHitScore = 0;
  if (batter.hardHitPct !== undefined && batter.hardHitPct > 0) {
    hardHitScore = clamp((batter.hardHitPct / 55) * 5, 5);
  }
  components.push({
    label: "Hard Hit %",
    earned: Math.round(hardHitScore),
    max: 5,
    value: batter.hardHitPct !== undefined ? `${batter.hardHitPct.toFixed(1)}%` : "—",
  });

  // 9. H2H vs current pitcher (0–5, min 5 AB)
  let h2hScore = 0;
  const h2h = batter.vsCurrentPitcher;
  if (h2h && h2h.atBats >= 5) {
    h2hScore = clamp((h2h.avg / 0.300) * 5, 5);
  }
  components.push({
    label: "vs This Pitcher (career)",
    earned: Math.round(h2hScore),
    max: 5,
    value: h2h && h2h.atBats >= 5
      ? `${fmt(h2h.avg)} (${h2h.hits}/${h2h.atBats} AB)`
      : h2h && h2h.atBats > 0
      ? `${h2h.hits}/${h2h.atBats} AB (small sample)`
      : "—",
  });

  const total = Math.min(100, Math.max(0, Math.round(
    form + consistency + matchup + streak + park + pitcherScore + xBAScore + hardHitScore + h2hScore
  )));

  return { total, components };
}

/**
 * HR Score (0–100)
 *
 *  25 — Recent HR activity: last10HR + last6HR + last3HR
 *  18 — Season SLG (power baseline)
 *  16 — Matchup SLG vs pitcher hand
 *  18 — Park factor (weighted higher — critical for HR)
 *   8 — Recent SLG last 10
 *  10 — Barrel % (Baseball Savant)
 *   5 — Career HR rate vs opposing pitcher (min 8 AB)
 */
export function calcHRScoreBreakdown(
  batter: MLBBatter,
  pitcher?: MLBPitcher,
  parkFactor = 1.0
): ScoreBreakdown {
  const components: ScoreComponent[] = [];

  // 1. Recent HR activity (0–25)
  const recentHR =
    clamp((batter.last10HR / 4) * 13, 13) +
    clamp((batter.last6HR  / 3) * 7,   7) +
    clamp((batter.last3HR  / 2) * 5,   5);
  components.push({
    label: "Recent HRs (L3/L6/L10)",
    earned: Math.round(recentHR),
    max: 25,
    value: `${batter.last3HR} / ${batter.last6HR} / ${batter.last10HR}`,
  });

  // 2. Season SLG (0–18)
  const slg = clamp((batter.seasonSLG / 0.620) * 18, 18);
  components.push({
    label: "Season SLG",
    earned: Math.round(slg),
    max: 18,
    value: fmt(batter.seasonSLG),
  });

  // 3. Matchup SLG vs pitcher hand (0–16)
  let matchup: number;
  if (pitcher) {
    const matchupSLG = pitcher.hand === "L" ? batter.slgVsLeft : batter.slgVsRight;
    matchup = clamp((matchupSLG / 0.680) * 16, 16);
    components.push({
      label: `SLG vs ${pitcher.hand === "L" ? "LHP" : "RHP"}`,
      earned: Math.round(matchup),
      max: 16,
      value: fmt(matchupSLG),
    });
  } else {
    matchup = clamp((batter.seasonSLG / 0.600) * 10, 10);
    components.push({
      label: "Season SLG (no SP)",
      earned: Math.round(matchup),
      max: 10,
      value: fmt(batter.seasonSLG),
    });
  }

  // 4. Park factor — critical for HR (0–18)
  const park = clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 18, 18);
  components.push({
    label: "Park Factor",
    earned: Math.round(park),
    max: 18,
    value: parkFactor.toFixed(2),
  });

  // 5. Recent SLG last 10 (0–8)
  const recentSlg = clamp((batter.last10SLG / 0.700) * 8, 8);
  components.push({
    label: "SLG Last 10",
    earned: Math.round(recentSlg),
    max: 8,
    value: fmt(batter.last10SLG),
  });

  // 6. Barrel % (0–10)
  let barrelScore = 0;
  if (batter.barrelPct !== undefined && batter.barrelPct > 0) {
    barrelScore = clamp((batter.barrelPct / 20) * 10, 10);
  }
  components.push({
    label: "Barrel %",
    earned: Math.round(barrelScore),
    max: 10,
    value: batter.barrelPct !== undefined ? `${batter.barrelPct.toFixed(1)}%` : "—",
  });

  // 7. H2H HR rate vs current pitcher (0–5, min 8 AB)
  let h2hScore = 0;
  const h2h = batter.vsCurrentPitcher;
  if (h2h && h2h.atBats >= 8) {
    h2hScore = clamp((h2h.hr / h2h.atBats) * 50, 5);
  }
  components.push({
    label: "HR vs This Pitcher",
    earned: Math.round(h2hScore),
    max: 5,
    value: h2h && h2h.atBats >= 8
      ? `${h2h.hr} HR in ${h2h.atBats} AB`
      : h2h && h2h.atBats > 0
      ? `${h2h.hr} HR in ${h2h.atBats} AB (small sample)`
      : "—",
  });

  const total = Math.min(100, Math.max(0, Math.round(
    recentHR + slg + matchup + park + recentSlg + barrelScore + h2hScore
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
