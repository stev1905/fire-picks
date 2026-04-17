import type { MLBBatter, MLBPitcher } from "@/types/mlb";
import type { WeatherData } from "@/lib/weather";

export interface ScoreComponent {
  label: string;
  earned: number;
  max: number;
  value?: string;
}

export interface ScoreBreakdown {
  total: number;
  components: ScoreComponent[];
}

export interface ScoreOptions {
  weather?: WeatherData;
  cfBearing?: number; // compass degrees from home plate to CF
  lf?: number;        // left field distance in feet
  rf?: number;        // right field distance in feet
}

function clamp(v: number, max: number) {
  return Math.min(max, Math.max(0, v));
}

function fmt(v: number) {
  return v.toFixed(3).replace(/^0/, "");
}

/** Returns a weather score (0–maxPts) and a readable label */
function calcWeatherComponent(
  weather: WeatherData,
  cfBearing: number,
  maxPts: number
): { score: number; value: string } {
  // Tailwind direction: wind should blow FROM behind home plate (cfBearing+180) toward CF
  const tailwindSource = (cfBearing + 180) % 360;
  const diff = Math.abs(((weather.windDeg - tailwindSource) + 360) % 360);
  const normalizedDiff = diff > 180 ? 360 - diff : diff; // 0–180
  const windEffect = Math.cos((normalizedDiff * Math.PI) / 180); // 1=tailwind, -1=headwind

  const windMagnitude = Math.min(weather.windMph, 20);
  // Baseline = 40% of max (neutral conditions), wind shifts ±30%, temp shifts ±10%
  const windPts  = windEffect * (windMagnitude / 20) * maxPts * 0.35;
  const tempPts  = clamp((weather.tempF - 65) / 40, 1) * maxPts * 0.15;
  const score    = clamp(Math.round(maxPts * 0.4 + windPts + tempPts), maxPts);

  const windLabel =
    windEffect > 0.4  ? `${weather.windMph}mph tailwind` :
    windEffect < -0.4 ? `${weather.windMph}mph headwind` :
                        `${weather.windMph}mph crosswind`;
  const tempLabel =
    weather.tempF >= 82 ? ` · ${weather.tempF}°F (warm)` :
    weather.tempF <= 52 ? ` · ${weather.tempF}°F (cold)` :
                          ` · ${weather.tempF}°F`;

  return { score, value: `${windLabel}${tempLabel}` };
}

/**
 * Hit Score (0–100)
 *
 *  22 — Recent AVG form: last3AVG + last10AVG
 *  11 — Hit consistency: games with a hit / last 10
 *  19 — Matchup AVG vs pitcher hand
 *   7 — Hitting streak
 *   6 — Park factor
 *   7 — Pitcher H allowed (L3 starts)
 *   8 — Weather (wind direction + temperature)
 *  10 — xBA (Statcast)
 *   5 — Hard Hit %
 *   5 — Career H2H vs opposing pitcher
 */
export function calcHitScoreBreakdown(
  batter: MLBBatter,
  pitcher?: MLBPitcher,
  parkFactor = 1.0,
  opts: ScoreOptions = {}
): ScoreBreakdown {
  const components: ScoreComponent[] = [];

  // 1. Recent AVG form (0–22)
  const formRaw = (batter.last10AVG / 0.380) * 14 + (batter.last3AVG / 0.480) * 8;
  const form = clamp(formRaw, 22);
  components.push({
    label: "Recent AVG (L3/L10)",
    earned: Math.round(form),
    max: 22,
    value: `${fmt(batter.last3AVG)} / ${fmt(batter.last10AVG)}`,
  });

  // 2. Hit consistency (0–11)
  const gp = batter.last10Games.length;
  const hitsIn10 = gp > 0 ? batter.last10Games.filter((g) => g.hits > 0).length : 0;
  const consistency = gp > 0 ? (hitsIn10 / gp) * 11 : 0;
  components.push({
    label: "Hit Rate (last 10)",
    earned: Math.round(consistency),
    max: 11,
    value: `${hitsIn10}/${gp} games`,
  });

  // 3. Matchup vs pitcher hand (0–19)
  let matchup: number;
  if (pitcher) {
    const matchupAvg = pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight;
    matchup = clamp((matchupAvg / 0.360) * 19, 19);
    components.push({
      label: `AVG vs ${pitcher.hand === "L" ? "LHP" : "RHP"}`,
      earned: Math.round(matchup),
      max: 19,
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

  // 4. Hitting streak (0–7)
  const streak = clamp(batter.hittingStreak * 0.85, 7);
  components.push({
    label: "Hit Streak",
    earned: Math.round(streak),
    max: 7,
    value: batter.hittingStreak > 0 ? `${batter.hittingStreak} games` : "—",
  });

  // 5. Park factor (0–6)
  const park = clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 6, 6);
  const parkTier =
    parkFactor >= 1.10 ? "Very Hitter Friendly" :
    parkFactor >= 1.04 ? "Hitter Friendly" :
    parkFactor <= 0.92 ? "Pitcher Friendly" :
    parkFactor <= 0.96 ? "Slight Pitcher Friendly" : "Neutral";
  components.push({
    label: "Park Factor",
    earned: Math.round(park),
    max: 6,
    value: `${parkTier} (${parkFactor.toFixed(2)})`,
  });

  // 6. Pitcher H allowed (0–7)
  let pitcherScore = 0;
  if (pitcher) {
    const softness = Math.max(0, (pitcher.last3HitsAllowed - 4) / 11);
    pitcherScore = clamp(softness * 7, 7);
    const pitcherTier =
      pitcher.last3HitsAllowed >= 12 ? "very hittable" :
      pitcher.last3HitsAllowed >= 8  ? "above avg" :
      pitcher.last3HitsAllowed >= 5  ? "average" : "tough";
    components.push({
      label: "Pitcher H Allowed (L3 starts)",
      earned: Math.round(pitcherScore),
      max: 7,
      value: `${pitcher.last3HitsAllowed} hits — ${pitcherTier}`,
    });
  }

  // 7. Weather (0–8)
  if (opts.weather && opts.cfBearing !== undefined) {
    const { score: wx, value: wxLabel } = calcWeatherComponent(opts.weather, opts.cfBearing, 8);
    components.push({ label: "Wind & Weather", earned: wx, max: 8, value: wxLabel });
  }

  // 8. xBA (0–10)
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

  // 9. Hard Hit % (0–5)
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

  // 10. H2H vs current pitcher (0–5, min 5 AB)
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
    form + consistency + matchup + streak + park + pitcherScore +
    (opts.weather && opts.cfBearing !== undefined ? components.find(c => c.label === "Wind & Weather")!.earned : 0) +
    xBAScore + hardHitScore + h2hScore
  )));

  return { total, components };
}

/**
 * HR Score (0–100)
 *
 *  20 — Recent HR activity
 *  15 — Season SLG
 *  13 — Matchup SLG vs pitcher hand
 *   8 — Park factor (general)
 *   7 — Pull-side field distance (based on batter hand)
 *   8 — Weather (wind direction + temperature)
 *   7 — Recent SLG last 10
 *  10 — Barrel %
 *   8 — Pitcher HR allowed (season rate)
 *   4 — Career H2H HR rate vs pitcher
 */
export function calcHRScoreBreakdown(
  batter: MLBBatter,
  pitcher?: MLBPitcher,
  parkFactor = 1.0,
  opts: ScoreOptions = {}
): ScoreBreakdown {
  const components: ScoreComponent[] = [];

  // 1. Recent HR activity (0–20)
  const recentHR =
    clamp((batter.last10HR / 4) * 10, 10) +
    clamp((batter.last6HR  / 3) * 6,   6) +
    clamp((batter.last3HR  / 2) * 4,   4);
  components.push({
    label: "Recent HRs (L3/L6/L10)",
    earned: Math.round(recentHR),
    max: 20,
    value: `${batter.last3HR} / ${batter.last6HR} / ${batter.last10HR}`,
  });

  // 2. Season SLG (0–15)
  const slg = clamp((batter.seasonSLG / 0.620) * 15, 15);
  components.push({
    label: "Season SLG",
    earned: Math.round(slg),
    max: 15,
    value: fmt(batter.seasonSLG),
  });

  // 3. Matchup SLG vs pitcher hand (0–13)
  let matchup: number;
  if (pitcher) {
    const matchupSLG = pitcher.hand === "L" ? batter.slgVsLeft : batter.slgVsRight;
    matchup = clamp((matchupSLG / 0.680) * 13, 13);
    components.push({
      label: `SLG vs ${pitcher.hand === "L" ? "LHP" : "RHP"}`,
      earned: Math.round(matchup),
      max: 13,
      value: fmt(matchupSLG),
    });
  } else {
    matchup = clamp((batter.seasonSLG / 0.600) * 8, 8);
    components.push({
      label: "Season SLG (no SP)",
      earned: Math.round(matchup),
      max: 8,
      value: fmt(batter.seasonSLG),
    });
  }

  // 4. Park factor — general (0–8)
  const park = clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 8, 8);
  const parkTierHR =
    parkFactor >= 1.10 ? "Very Hitter Friendly" :
    parkFactor >= 1.04 ? "Hitter Friendly" :
    parkFactor <= 0.92 ? "Pitcher Friendly" :
    parkFactor <= 0.96 ? "Slight Pitcher Friendly" : "Neutral";
  components.push({
    label: "Park Factor",
    earned: Math.round(park),
    max: 8,
    value: `${parkTierHR} (${parkFactor.toFixed(2)})`,
  });

  // 5. Pull-side field distance (0–7, based on batter hand)
  let pullScore = 3; // neutral default
  let pullValue = "—";
  if (opts.lf !== undefined && opts.rf !== undefined) {
    const pullDist =
      batter.hand === "L" ? opts.rf :
      batter.hand === "R" ? opts.lf :
      (opts.lf + opts.rf) / 2; // switch hitter
    // Scale: 300ft = 7pts (very short), 365ft = 0pts (very deep)
    pullScore = clamp(((365 - pullDist) / 65) * 7, 7);
    const side = batter.hand === "L" ? "RF" : batter.hand === "R" ? "LF" : "avg";
    const tier = pullDist <= 315 ? "short" : pullDist <= 330 ? "avg" : "deep";
    pullValue = `${pullDist}ft ${side} — ${tier}`;
  }
  components.push({
    label: "Pull-Side Distance",
    earned: Math.round(pullScore),
    max: 7,
    value: pullValue,
  });

  // 6. Weather (0–8)
  let wxScore = 0;
  if (opts.weather && opts.cfBearing !== undefined) {
    const { score: wx, value: wxLabel } = calcWeatherComponent(opts.weather, opts.cfBearing, 8);
    wxScore = wx;
    components.push({ label: "Wind & Weather", earned: wx, max: 8, value: wxLabel });
  }

  // 7. Recent SLG last 10 (0–7)
  const recentSlg = clamp((batter.last10SLG / 0.700) * 7, 7);
  components.push({
    label: "SLG Last 10",
    earned: Math.round(recentSlg),
    max: 7,
    value: fmt(batter.last10SLG),
  });

  // 8. Barrel % (0–10)
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

  // 9. Pitcher HR allowed — season rate (0–8)
  let pitcherHRScore = 0;
  if (pitcher) {
    // Average SP allows ~1.2 HR/9 IP; scale so 2.0+/9 = max score
    const hrPer9 = pitcher.last3InningsPitched > 0
      ? (pitcher.last3HRAllowed / pitcher.last3InningsPitched) * 9
      : pitcher.seasonHRAllowed > 0 ? pitcher.seasonHRAllowed / 30 : 0;
    pitcherHRScore = clamp((hrPer9 / 2.0) * 8, 8);
    const hrTier =
      hrPer9 >= 1.8 ? "HR prone" :
      hrPer9 >= 1.2 ? "above avg" :
      hrPer9 >= 0.6 ? "average" : "suppresses HRs";
    components.push({
      label: "Pitcher HR Allowed",
      earned: Math.round(pitcherHRScore),
      max: 8,
      value: `${pitcher.last3HRAllowed} in L3 starts — ${hrTier}`,
    });
  }

  // 10. H2H HR rate vs current pitcher (0–4, min 8 AB)
  let h2hScore = 0;
  const h2h = batter.vsCurrentPitcher;
  if (h2h && h2h.atBats >= 8) {
    h2hScore = clamp((h2h.hr / h2h.atBats) * 40, 4);
  }
  components.push({
    label: "HR vs This Pitcher",
    earned: Math.round(h2hScore),
    max: 4,
    value: h2h && h2h.atBats >= 8
      ? `${h2h.hr} HR in ${h2h.atBats} AB`
      : h2h && h2h.atBats > 0
      ? `${h2h.hr} HR in ${h2h.atBats} AB (small sample)`
      : "—",
  });

  const total = Math.min(100, Math.max(0, Math.round(
    recentHR + slg + matchup + park + pullScore + wxScore +
    recentSlg + barrelScore + pitcherHRScore + h2hScore
  )));

  return { total, components };
}

// Convenience wrappers
export function calcHitScore(batter: MLBBatter, pitcher?: MLBPitcher, parkFactor = 1.0, opts: ScoreOptions = {}) {
  return calcHitScoreBreakdown(batter, pitcher, parkFactor, opts).total;
}

export function calcHRScore(batter: MLBBatter, pitcher?: MLBPitcher, parkFactor = 1.0, opts: ScoreOptions = {}) {
  return calcHRScoreBreakdown(batter, pitcher, parkFactor, opts).total;
}

export function scoreBadgeClass(score: number) {
  if (score >= 75) return "bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/30";
  if (score >= 55) return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30";
  if (score >= 35) return "bg-muted text-muted-foreground border border-border";
  return "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30";
}

/** True if the batter is likely due for a hit: hitless last game but trending well overall */
export function isBouncebackHit(batter: MLBBatter, hitScore: number): boolean {
  if (hitScore < 50) return false;
  const last = batter.last10Games[0];
  if (!last || last.hits > 0) return false; // had a hit last game
  return batter.last6AVG >= 0.260 || batter.last10AVG >= 0.250;
}

/** True if the batter is due for a HR: no HR last game but has been hitting HRs recently */
export function isBouncebackHR(batter: MLBBatter, hrScore: number): boolean {
  if (hrScore < 50) return false;
  const last = batter.last10Games[0];
  if (!last || last.hr > 0) return false; // hit HR last game
  return batter.last6HR >= 1 || batter.last10HR >= 2;
}
