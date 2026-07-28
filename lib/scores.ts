import type { MLBBatter, MLBPitcher } from "@/types/mlb";
import type { WeatherData } from "@/lib/weather";
import { HIT_WEIGHTS, HR_WEIGHTS } from "@/lib/model-weights";

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
  maxPts: number,
  pullBearing?: number // if provided, score wind toward pull side instead of CF
): { score: number; value: string } {
  const targetBearing = pullBearing ?? cfBearing;
  // Tailwind direction: wind should blow FROM behind home plate toward the target bearing
  const tailwindSource = (targetBearing + 180) % 360;
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

/** Derive a pitch matchup score component (-8 to +8) and readable label */
export function calcPitchMatchup(
  batter: MLBBatter,
  pitcher: MLBPitcher
): { earned: number; max: number; value: string } {
  let delta = 0;
  const notes: string[] = [];

  const hasArsenal = pitcher.fastballPct !== undefined || pitcher.breakingPct !== undefined;
  const hasDiscipline = batter.chasePct !== undefined || batter.baVsBreaking !== undefined;
  if (!hasArsenal && !hasDiscipline) return { earned: 4, max: 8, value: "—" };

  // Breaking ball matchup
  const brPct = pitcher.breakingPct ?? 0;
  if (brPct > 25) {
    if (batter.baVsBreaking !== undefined) {
      if (batter.baVsBreaking >= 0.260)      { delta += 2; notes.push(`hits breaking balls (.${Math.round(batter.baVsBreaking * 1000)})`); }
      else if (batter.baVsBreaking < 0.220)  { delta -= 2; notes.push(`struggles vs breaking (.${Math.round(batter.baVsBreaking * 1000)})`); }
    }
    if (batter.whiffVsBreaking !== undefined && batter.whiffVsBreaking > 35) {
      delta -= 1;
      notes.push(`high whiff vs breaking (${batter.whiffVsBreaking.toFixed(0)}%)`);
    }
  }

  // Fastball matchup
  const fbPct = pitcher.fastballPct ?? 0;
  if (fbPct > 45) {
    if (batter.baVsFastball !== undefined) {
      if (batter.baVsFastball >= 0.290)      { delta += 2; notes.push(`strong vs fastball (.${Math.round(batter.baVsFastball * 1000)})`); }
      else if (batter.baVsFastball < 0.230)  { delta -= 1; notes.push(`below avg vs fastball`); }
    }
  }

  // Chase rate matchup
  if (pitcher.chaseInducePct !== undefined && batter.chasePct !== undefined) {
    if (pitcher.chaseInducePct > 32 && batter.chasePct > 32) {
      delta -= 2;
      notes.push(`chases pitches (${batter.chasePct.toFixed(0)}%) vs deceptive pitcher`);
    } else if (pitcher.zonePct !== undefined && pitcher.zonePct < 44 && batter.chasePct < 26) {
      delta += 1;
      notes.push(`disciplined eye vs off-zone pitcher`);
    }
  }

  // Map delta (-6 to +6) onto earned (0–8), baseline 4
  const earned = clamp(4 + delta, 8);
  const value = notes[0] ?? (delta > 0 ? "slight advantage" : delta < 0 ? "slight disadvantage" : "neutral");
  return { earned, max: 8, value };
}

/**
 * Hit Score (0–100) — base weights sum to 85; see lib/model-weights.ts
 *
 *  25 — Pitcher H/9 last 3 starts (r=0.132, 21.7pp spread)  (HIT_WEIGHTS.pitcherH)
 *  23 — AVG vs pitcher hand (r=0.135, 100% coverage)         (HIT_WEIGHTS.vsHand)
 *   9 — Hit consistency: hitRate20 or hitRate10              (HIT_WEIGHTS.consistency)
 *   9 — Career H2H avg vs this pitcher (r=0.139)             (HIT_WEIGHTS.h2h)
 *   7 — Hitting streak (logarithmic, ≥5 significant)         (HIT_WEIGHTS.streak)
 *   4 — Home / Away situational AVG (r=0.107, 9.8pp spread)  (HIT_WEIGHTS.homeAway)
 *   4 — xBA Statcast (r=0.058, 100% coverage)                (HIT_WEIGHTS.xBA)
 *   2 — Recent AVG form: last3AVG + last10AVG (r=0.01-0.03)  (HIT_WEIGHTS.form)
 *   2 — Hard Hit %                                            (HIT_WEIGHTS.hardHit)
 *   ~8 — Weather (wind direction + temperature)               [modifier, not in base sum]
 *   ~8 — Pitch matchup                                        [modifier, not in base sum]
 */
export function calcHitScoreBreakdown(
  batter: MLBBatter,
  pitcher?: MLBPitcher,
  parkFactor = 1.0,
  opts: ScoreOptions = {}
): ScoreBreakdown {
  const components: ScoreComponent[] = [];

  // 1. Recent AVG form (0–HIT_WEIGHTS.form)
  const W_FORM = HIT_WEIGHTS.form; // 20
  const formRaw = (batter.last10AVG / 0.380) * (W_FORM * 0.65) + (batter.last3AVG / 0.480) * (W_FORM * 0.35);
  const form = clamp(formRaw, W_FORM);
  components.push({
    label: "Recent AVG (L3/L10)",
    earned: Math.round(form),
    max: W_FORM,
    value: `${fmt(batter.last3AVG)} / ${fmt(batter.last10AVG)}`,
  });

  // 2. Hit consistency — prefer hitRate20 (3× more predictive than hitRate10)
  //    Falls back to hitRate10 (from last10Games) when hitRate20 not available.
  const W_CONS = HIT_WEIGHTS.consistency; // 18
  let consistencyLabel: string;
  let consistencyScore: number;
  if (batter.hitRate20 !== undefined && batter.hitRate20 > 0) {
    consistencyScore = clamp(batter.hitRate20 * W_CONS, W_CONS);
    const gamesWithHit = Math.round(batter.hitRate20 * 20);
    consistencyLabel = `${gamesWithHit}/20 games (L20)`;
  } else {
    const gp = batter.last10Games.length;
    const hitsIn10 = gp > 0 ? batter.last10Games.filter((g) => g.hits > 0).length : 0;
    consistencyScore = gp > 0 ? clamp((hitsIn10 / gp) * W_CONS, W_CONS) : 0;
    consistencyLabel = `${hitsIn10}/${gp} games (L10)`;
  }
  components.push({
    label: "Hit Consistency",
    earned: Math.round(consistencyScore),
    max: W_CONS,
    value: consistencyLabel,
  });

  // 3. Matchup vs pitcher hand (0–HIT_WEIGHTS.vsHand)
  //    Bug fix: when avgVsHand is 0/null, fall back to seasonAVG instead of scoring 0.
  const W_VSHAND = HIT_WEIGHTS.vsHand; // 16
  let matchup: number;
  if (pitcher) {
    const rawMatchupAvg = pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight;
    // Use seasonAVG as fallback when split is 0 (missing data, not actually .000)
    const matchupAvg = rawMatchupAvg > 0 ? rawMatchupAvg : batter.seasonAVG;
    matchup = clamp((matchupAvg / 0.360) * W_VSHAND, W_VSHAND);
    components.push({
      label: `AVG vs ${pitcher.hand === "L" ? "LHP" : "RHP"}`,
      earned: Math.round(matchup),
      max: W_VSHAND,
      value: rawMatchupAvg > 0 ? fmt(rawMatchupAvg) : `${fmt(batter.seasonAVG)} (season, no split)`,
    });
  } else {
    matchup = clamp((batter.seasonAVG / 0.340) * (W_VSHAND * 0.7), W_VSHAND);
    components.push({
      label: "Season AVG (no SP)",
      earned: Math.round(matchup),
      max: W_VSHAND,
      value: fmt(batter.seasonAVG),
    });
  }

  // 3b. Home / Away split (0–HIT_WEIGHTS.homeAway)
  const W_HA = HIT_WEIGHTS.homeAway; // 7
  let homeAwayScore = 0;
  const hasHomeSplit = batter.homeAVG !== undefined && batter.awayAVG !== undefined
    && (batter.homeAVG > 0 || batter.awayAVG > 0);
  if (hasHomeSplit && batter.isHome !== undefined) {
    const situationalAvg = batter.isHome ? batter.homeAVG! : batter.awayAVG!;
    homeAwayScore = clamp((situationalAvg / 0.340) * W_HA, W_HA);
    const diff = (batter.homeAVG! - batter.awayAVG!) * 1000;
    const splitNote = Math.abs(diff) >= 25
      ? ` (${diff > 0 ? "+" : ""}${diff.toFixed(0)} H/A split)`
      : "";
    components.push({
      label: batter.isHome ? "Home AVG" : "Road AVG",
      earned: Math.round(homeAwayScore),
      max: W_HA,
      value: `${fmt(situationalAvg)}${splitNote}`,
    });
  }

  // 4. Hitting streak — logarithmic curve: significant points only for streaks ≥ 5
  //    log(1+streak)/log(1+maxStreak) × maxPts gives convex shape:
  //      streak=1 → ~1.2 pts, streak=3 → ~2.3, streak=5 → ~3.1, streak=8 → ~4.1, streak=12 → ~5
  const W_STREAK = HIT_WEIGHTS.streak; // 5
  const maxStreakRef = 15; // reference for log normalization
  const streakScore = batter.hittingStreak > 0
    ? clamp((Math.log(1 + batter.hittingStreak) / Math.log(1 + maxStreakRef)) * W_STREAK, W_STREAK)
    : 0;
  components.push({
    label: "Hit Streak",
    earned: Math.round(streakScore),
    max: W_STREAK,
    value: batter.hittingStreak > 0 ? `${batter.hittingStreak} games` : "—",
  });

  // 5. Park factor (0–4, reduced from prior 6 — near-zero correlation in data)
  const park = clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * 4, 4);
  const parkTier =
    parkFactor >= 1.10 ? "Very Hitter Friendly" :
    parkFactor >= 1.04 ? "Hitter Friendly" :
    parkFactor <= 0.92 ? "Pitcher Friendly" :
    parkFactor <= 0.96 ? "Slight Pitcher Friendly" : "Neutral";
  components.push({
    label: "Park Factor",
    earned: Math.round(park),
    max: 4,
    value: `${parkTier} (${parkFactor.toFixed(2)})`,
  });

  // 6. Pitcher H/9 rate (0–HIT_WEIGHTS.pitcherH)
  //    Rate-based so relievers and starters are comparable.
  //    5.0 H/9 = elite (0 pts), 11.0 H/9 = very hittable (max pts). League avg ~8.5.
  const W_PITCHER_H = HIT_WEIGHTS.pitcherH; // 4
  let pitcherScore = 0;
  if (pitcher) {
    const h9 = pitcher.last3InningsPitched > 0
      ? (pitcher.last3HitsAllowed / pitcher.last3InningsPitched) * 9
      : null;
    if (h9 !== null) {
      pitcherScore = clamp(((h9 - 5.0) / 6.0) * W_PITCHER_H, W_PITCHER_H);
    }
    const pitcherTier =
      h9 === null          ? "no data" :
      h9 >= 10.0           ? "very hittable" :
      h9 >= 8.5            ? "above avg" :
      h9 >= 7.0            ? "average" : "tough";
    const ipLabel = pitcher.last3InningsPitched > 0
      ? `${pitcher.last3HitsAllowed}H / ${pitcher.last3InningsPitched.toFixed(1)}IP`
      : `${pitcher.last3HitsAllowed} hits`;
    components.push({
      label: "Pitcher H/9 (L3 apps)",
      earned: Math.round(pitcherScore),
      max: W_PITCHER_H,
      value: h9 !== null ? `${h9.toFixed(1)} H/9 (${ipLabel}) — ${pitcherTier}` : `${ipLabel} — ${pitcherTier}`,
    });
  }

  // 6b. Pitcher BAA split vs batter hand (0–4)
  //     How does this pitcher perform specifically vs L or R batters?
  let pitcherSplitScore = 0;
  if (pitcher && (pitcher.baaVsLeft !== undefined || pitcher.baaVsRight !== undefined)) {
    const baaVsHand = batter.hand === "L" ? pitcher.baaVsLeft : pitcher.baaVsRight;
    if (baaVsHand !== undefined && baaVsHand > 0) {
      // .190 = elite vs this hand (0 pts), .340 = very hittable (4 pts)
      pitcherSplitScore = clamp(((baaVsHand - 0.190) / 0.150) * 4, 4);
      const splitTier =
        baaVsHand >= 0.290 ? "hittable" :
        baaVsHand >= 0.250 ? "average"  : "tough";
      const handLabel = batter.hand === "L" ? "vs LHB" : "vs RHB";
      components.push({
        label: `Pitcher BAA ${handLabel}`,
        earned: Math.round(pitcherSplitScore),
        max: 4,
        value: `${fmt(baaVsHand)} — ${splitTier}`,
      });
    }
  }

  // 7. Weather (0–8)
  if (opts.weather && opts.cfBearing !== undefined) {
    const { score: wx, value: wxLabel } = calcWeatherComponent(opts.weather, opts.cfBearing, 8);
    components.push({ label: "Wind & Weather", earned: wx, max: 8, value: wxLabel });
  }

  // 8. xBA (0–HIT_WEIGHTS.xBA)
  const W_XBA = HIT_WEIGHTS.xBA; // 9
  let xBAScore = 0;
  if (batter.xBA !== undefined && batter.xBA > 0) {
    xBAScore = clamp((batter.xBA / 0.340) * W_XBA, W_XBA);
  }
  components.push({
    label: "xBA (Statcast)",
    earned: Math.round(xBAScore),
    max: W_XBA,
    value: batter.xBA !== undefined ? fmt(batter.xBA) : "—",
  });

  // 9. Hard Hit % (0–HIT_WEIGHTS.hardHit)
  const W_HH = HIT_WEIGHTS.hardHit; // 3
  let hardHitScore = 0;
  if (batter.hardHitPct !== undefined && batter.hardHitPct > 0) {
    hardHitScore = clamp((batter.hardHitPct / 55) * W_HH, W_HH);
  }
  components.push({
    label: "Hard Hit %",
    earned: Math.round(hardHitScore),
    max: W_HH,
    value: batter.hardHitPct !== undefined ? `${batter.hardHitPct.toFixed(1)}%` : "—",
  });

  // 10. H2H vs current pitcher (0–HIT_WEIGHTS.h2h, min 5 AB)
  const W_H2H = HIT_WEIGHTS.h2h; // 3
  let h2hScore = 0;
  const h2h = batter.vsCurrentPitcher;
  if (h2h && h2h.atBats >= 5) {
    h2hScore = clamp((h2h.avg / 0.300) * W_H2H, W_H2H);
  }
  components.push({
    label: "vs This Pitcher (career)",
    earned: Math.round(h2hScore),
    max: W_H2H,
    value: h2h && h2h.atBats >= 5
      ? `${fmt(h2h.avg)} (${h2h.hits}/${h2h.atBats} AB)`
      : h2h && h2h.atBats > 0
      ? `${h2h.hits}/${h2h.atBats} AB (small sample)`
      : "—",
  });

  // 11. Pitch matchup — pitcher arsenal vs batter discipline (0–8, baseline 4 = neutral)
  let pitchMatchupScore = 0;
  if (pitcher) {
    const pm = calcPitchMatchup(batter, pitcher);
    pitchMatchupScore = pm.earned - 4; // offset from neutral baseline so it doesn't double-count
    components.push({ label: "Pitch Matchup", earned: pm.earned, max: pm.max, value: pm.value });
  }

  // 12. Momentum — bounce-back bonus (hitless exactly yesterday, quality hitter)
  //     or cold streak penalty (2+ consecutive hitless games).
  //     Data: coldStreak=1 + score ≥60 shows +7.7pp lift; coldStreak ≥5 shows -16pp drag.
  const coldStreak = getColdStreak(batter);
  let momentumMod = 0;
  if (coldStreak === 1) {
    const rate = batter.hitRate20 ?? batter.hitRate10 ??
      (batter.last10Games.length > 0
        ? batter.last10Games.filter(g => g.hits > 0).length / batter.last10Games.length
        : 0);
    if (rate >= 0.65)      { momentumMod = 3; }
    else if (rate >= 0.50) { momentumMod = 2; }
    else if (rate >= 0.40) { momentumMod = 1; }
    if (momentumMod > 0) {
      components.push({
        label: "Bounce-back",
        earned: momentumMod,
        max: 3,
        value: `hitless yday, rate ${Math.round(rate * 100)}% (+${momentumMod} pts)`,
      });
    }
  } else if (coldStreak >= 2) {
    momentumMod = coldStreak >= 7 ? -5 : coldStreak >= 5 ? -4 : coldStreak >= 3 ? -2 : -1;
    components.push({
      label: "Cold Streak",
      earned: momentumMod,
      max: 0,
      value: `${coldStreak} hitless games (${momentumMod} pts)`,
    });
  }

  // 13. Lineup slot modifier — bottom-order batters get fewer ABs/game so lower hit probability.
  //     Data: slots 7-9 underperform same-score-band top order by 4–9pp.
  const slot = batter.battingOrder ?? 0;
  const slotMod = slot >= 9 ? -3 : slot >= 7 ? -2 : 0;
  if (slotMod < 0) {
    components.push({
      label: `Lineup Slot (${slot})`,
      earned: slotMod,
      max: 0,
      value: `Slot ${slot} — fewer ABs/game (${slotMod} pts)`,
    });
  }

  const total = Math.min(100, Math.max(0, Math.round(
    form + consistencyScore + matchup + homeAwayScore + streakScore + park + pitcherScore + pitcherSplitScore +
    (opts.weather && opts.cfBearing !== undefined ? components.find(c => c.label === "Wind & Weather")!.earned : 0) +
    xBAScore + hardHitScore + h2hScore + pitchMatchupScore + momentumMod + slotMod
  )));

  return { total, components };
}

/**
 * HR Score (0–100)
 *
 *  20 — Recent HR activity (L3/L6/L10)            (HR_WEIGHTS.recentHR)
 *   9 — Season SLG                                 (HR_WEIGHTS.seasonSLG)
 *   9 — Matchup SLG vs pitcher hand                (HR_WEIGHTS.slgVsHand)
 *   7 — Recent SLG last 10                         (HR_WEIGHTS.recentSLG)
 *  11 — Barrel %                                   (HR_WEIGHTS.barrel)
 *   6 — Hard Hit %                                 (HR_WEIGHTS.hardHit)
 *   6 — Pitcher HR/9 vs batter hand (L/R split)   (HR_WEIGHTS.pitcherHR)
 *   8 — xwOBA (expected weighted OBA)              (HR_WEIGHTS.xwOBA)
 *   6 — Fly ball rate                              (HR_WEIGHTS.flyBall)
 *   3 — Park factor                                (HR_WEIGHTS.park)
 *   ~7 — Pull-side field distance                  [modifier]
 *   ~8 — Weather (wind toward pull side + temp)    [modifier]
 */
export function calcHRScoreBreakdown(
  batter: MLBBatter,
  pitcher?: MLBPitcher,
  parkFactor = 1.0,
  opts: ScoreOptions = {}
): ScoreBreakdown {
  const components: ScoreComponent[] = [];

  // 1. Recent HR activity (0–HR_WEIGHTS.recentHR)
  //    last3HR dominates (r=0.557), last6HR (r=0.404), last10HR (r=0.058)
  const W_RECENT_HR = HR_WEIGHTS.recentHR; // 22
  const recentHR =
    clamp(((batter.last3HR  ?? 0) / 2) * (W_RECENT_HR * 0.50), W_RECENT_HR * 0.50) +
    clamp(((batter.last6HR  ?? 0) / 3) * (W_RECENT_HR * 0.35), W_RECENT_HR * 0.35) +
    clamp(((batter.last10HR ?? 0) / 4) * (W_RECENT_HR * 0.15), W_RECENT_HR * 0.15);
  components.push({
    label: "Recent HRs (L3/L6/L10)",
    earned: Math.round(recentHR),
    max: W_RECENT_HR,
    value: `${batter.last3HR} / ${batter.last6HR} / ${batter.last10HR}`,
  });

  // 2. Season SLG (0–HR_WEIGHTS.seasonSLG)
  const W_SLG = HR_WEIGHTS.seasonSLG; // 12
  const slg = clamp((batter.seasonSLG / 0.620) * W_SLG, W_SLG);
  components.push({
    label: "Season SLG",
    earned: Math.round(slg),
    max: W_SLG,
    value: fmt(batter.seasonSLG),
  });

  // 3. Matchup SLG vs pitcher hand (0–HR_WEIGHTS.slgVsHand)
  const W_SLG_HAND = HR_WEIGHTS.slgVsHand; // 11
  let matchup: number;
  if (pitcher) {
    const matchupSLG = pitcher.hand === "L" ? batter.slgVsLeft : batter.slgVsRight;
    matchup = clamp((matchupSLG / 0.680) * W_SLG_HAND, W_SLG_HAND);
    components.push({
      label: `SLG vs ${pitcher.hand === "L" ? "LHP" : "RHP"}`,
      earned: Math.round(matchup),
      max: W_SLG_HAND,
      value: fmt(matchupSLG),
    });
  } else {
    matchup = clamp((batter.seasonSLG / 0.600) * (W_SLG_HAND * 0.7), W_SLG_HAND);
    components.push({
      label: "Season SLG (no SP)",
      earned: Math.round(matchup),
      max: W_SLG_HAND,
      value: fmt(batter.seasonSLG),
    });
  }

  // 4. Park factor — general (0–HR_WEIGHTS.park)
  const W_PARK_HR = HR_WEIGHTS.park; // 3
  const park = clamp(((parkFactor - 0.88) / (1.24 - 0.88)) * W_PARK_HR, W_PARK_HR);
  const parkTierHR =
    parkFactor >= 1.10 ? "Very Hitter Friendly" :
    parkFactor >= 1.04 ? "Hitter Friendly" :
    parkFactor <= 0.92 ? "Pitcher Friendly" :
    parkFactor <= 0.96 ? "Slight Pitcher Friendly" : "Neutral";
  components.push({
    label: "Park Factor",
    earned: Math.round(park),
    max: W_PARK_HR,
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

  // 6. Weather — scored toward pull side, not CF (LHH pull to RF ≈ cfBearing+45, RHH to LF ≈ cfBearing-45)
  let wxScore = 0;
  if (opts.weather && opts.cfBearing !== undefined) {
    const cf = opts.cfBearing;
    const pullBearing =
      batter.hand === "L" ? (cf + 45) % 360 :
      batter.hand === "R" ? (cf - 45 + 360) % 360 :
      cf;
    const { score: wx, value: wxLabel } = calcWeatherComponent(opts.weather, cf, 8, pullBearing);
    wxScore = wx;
    components.push({ label: "Wind & Weather", earned: wx, max: 8, value: wxLabel });
  }

  // 7. Recent SLG last 10 (0–HR_WEIGHTS.recentSLG)
  const W_RECENT_SLG = HR_WEIGHTS.recentSLG; // 10
  const recentSlg = clamp((batter.last10SLG / 0.700) * W_RECENT_SLG, W_RECENT_SLG);
  components.push({
    label: "SLG Last 10",
    earned: Math.round(recentSlg),
    max: W_RECENT_SLG,
    value: fmt(batter.last10SLG),
  });

  // 8. Barrel % (0–HR_WEIGHTS.barrel) — top Statcast HR predictor (r=0.106)
  const W_BARREL = HR_WEIGHTS.barrel; // 12
  let barrelScore = 0;
  if (batter.barrelPct !== undefined && batter.barrelPct > 0) {
    barrelScore = clamp((batter.barrelPct / 20) * W_BARREL, W_BARREL);
  }
  components.push({
    label: "Barrel %",
    earned: Math.round(barrelScore),
    max: W_BARREL,
    value: batter.barrelPct !== undefined ? `${batter.barrelPct.toFixed(1)}%` : "—",
  });

  // 9. Hard Hit % (0–HR_WEIGHTS.hardHit)
  const W_HH_HR = HR_WEIGHTS.hardHit; // 8
  let hardHitHRScore = 0;
  if (batter.hardHitPct !== undefined && batter.hardHitPct > 0) {
    hardHitHRScore = clamp((batter.hardHitPct / 55) * W_HH_HR, W_HH_HR);
  }
  components.push({
    label: "Hard Hit %",
    earned: Math.round(hardHitHRScore),
    max: W_HH_HR,
    value: batter.hardHitPct !== undefined ? `${batter.hardHitPct.toFixed(1)}%` : "—",
  });

  // 10. Pitcher HR/9 vs batter's hand (L/R split) — season data
  const W_PITCHER_HR = HR_WEIGHTS.pitcherHR; // 6
  let pitcherHRScore = 0;
  if (pitcher) {
    const hrP9ByHand =
      batter.hand === "L" ? pitcher.hrPer9VsLeft :
      batter.hand === "R" ? pitcher.hrPer9VsRight :
      ((pitcher.hrPer9VsLeft ?? 0) + (pitcher.hrPer9VsRight ?? 0)) / 2;
    // Fallback to raw L3 rate if splits unavailable
    const l3hr  = pitcher.last3HRAllowed    ?? 0;
    const l3ip  = pitcher.last3InningsPitched ?? 0;
    const szHR  = pitcher.seasonHRAllowed   ?? 0;
    const fallbackHrP9 = l3ip > 0 ? (l3hr / l3ip) * 9 : (szHR > 0 ? szHR / 30 : 0);
    const hrPer9 = hrP9ByHand ?? fallbackHrP9;
    pitcherHRScore = clamp((hrPer9 / 2.0) * W_PITCHER_HR, W_PITCHER_HR);
    const hrTier =
      hrPer9 >= 1.8 ? "HR prone" :
      hrPer9 >= 1.2 ? "above avg" :
      hrPer9 >= 0.6 ? "average" : "suppresses HRs";
    const handLabel = batter.hand === "L" ? "vs LHB" : batter.hand === "R" ? "vs RHB" : "overall";
    components.push({
      label: `Pitcher HR/9 (${handLabel})`,
      earned: Math.round(pitcherHRScore),
      max: W_PITCHER_HR,
      value: `${hrPer9.toFixed(2)} HR/9 — ${hrTier}`,
    });
  }

  // 10b. xwOBA — expected weighted on-base average (0–HR_WEIGHTS.xwOBA)
  const W_XWOBA = HR_WEIGHTS.xwOBA; // 8
  let xwobaScore = 0;
  if (batter.xwOBA !== undefined && batter.xwOBA > 0) {
    // .270 = league avg, .400+ = elite power; scale linearly
    xwobaScore = clamp(((batter.xwOBA - 0.270) / 0.130) * W_XWOBA, W_XWOBA);
  }
  const xwobaLabel =
    (batter.xwOBA ?? 0) >= 0.380 ? "elite power" :
    (batter.xwOBA ?? 0) >= 0.330 ? "above avg" :
    (batter.xwOBA ?? 0) >= 0.290 ? "avg" : "below avg";
  components.push({
    label: "xwOBA",
    earned: Math.round(xwobaScore),
    max: W_XWOBA,
    value: batter.xwOBA !== undefined ? `${batter.xwOBA.toFixed(3)} — ${xwobaLabel}` : "—",
  });

  // 10c. Fly ball rate (0–HR_WEIGHTS.flyBall)
  const W_FLYBALL = HR_WEIGHTS.flyBall; // 6
  let flyBallScore = 0;
  if (batter.flyBallRate !== undefined && batter.flyBallRate > 0) {
    // 0.30 = low FB, 0.55 = high FB tendency; 0.65+ = extreme fly ball hitter
    flyBallScore = clamp(((batter.flyBallRate - 0.30) / 0.35) * W_FLYBALL, W_FLYBALL);
  }
  const fbTier =
    (batter.flyBallRate ?? 0) >= 0.60 ? "high FB%" :
    (batter.flyBallRate ?? 0) >= 0.50 ? "above avg FB%" :
    (batter.flyBallRate ?? 0) >= 0.40 ? "avg FB%" : "ground ball tendency";
  components.push({
    label: "Fly Ball Rate",
    earned: Math.round(flyBallScore),
    max: W_FLYBALL,
    value: batter.flyBallRate !== undefined
      ? `${(batter.flyBallRate * 100).toFixed(0)}% — ${fbTier}`
      : "—",
  });

  // 11. H2H HR rate vs current pitcher (0–4, min 8 AB)
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

  // 12. Lineup slot modifier — same AB-opportunity logic as hit score.
  const hrSlot = batter.battingOrder ?? 0;
  const hrSlotMod = hrSlot >= 9 ? -3 : hrSlot >= 7 ? -2 : 0;
  if (hrSlotMod < 0) {
    components.push({
      label: `Lineup Slot (${hrSlot})`,
      earned: hrSlotMod,
      max: 0,
      value: `Slot ${hrSlot} — fewer ABs/game (${hrSlotMod} pts)`,
    });
  }

  const total = Math.min(100, Math.max(0, Math.round(
    recentHR + slg + matchup + park + pullScore + wxScore +
    recentSlg + barrelScore + hardHitHRScore + pitcherHRScore +
    xwobaScore + flyBallScore + h2hScore + hrSlotMod
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

/** Count consecutive hitless games entering today (cold streak length) */
export function getColdStreak(batter: MLBBatter): number {
  let n = 0;
  for (const g of batter.last10Games) {
    if ((g.hits ?? 0) === 0) n++;
    else break;
  }
  return n;
}

/**
 * True if the batter is a bounce-back candidate: hitless exactly yesterday
 * (not a multi-day cold streak), trending well, and score high enough to be meaningful.
 * Data shows +3–8pp lift for quality hitters in this situation.
 */
export function isBouncebackHit(batter: MLBBatter, hitScore: number): boolean {
  if (hitScore < 50) return false;
  if (getColdStreak(batter) !== 1) return false; // must be hitless EXACTLY yesterday
  const rate = batter.hitRate20 ?? batter.hitRate10 ?? 0;
  return rate >= 0.50 || batter.last10AVG >= 0.250;
}

/** True if the batter is due for a HR: no HR last game but has been hitting HRs recently */
export function isBouncebackHR(batter: MLBBatter, hrScore: number): boolean {
  if (hrScore < 50) return false;
  const last = batter.last10Games[0];
  if (!last || last.hr > 0) return false; // hit HR last game
  return batter.last6HR >= 1 || batter.last10HR >= 2;
}

// Zone number → readable location label (catcher's perspective, RHH default)
const ZONE_LABELS: Record<number, string> = {
  1: "Up-In",   2: "Up",      3: "Up-Out",
  4: "Mid-In",  5: "Heart",   6: "Mid-Out",
  7: "Low-In",  8: "Low",     9: "Low-Out",
  11: "Hi-Chase", 12: "Hi-Chase",
  13: "Lo-Chase", 14: "Lo-Chase",
};

function zoneLabel(zone: number): string {
  return ZONE_LABELS[zone] ?? `Zone ${zone}`;
}

// Is the zone in the lower third of the strike zone / low chase?
function isLowZone(z: number) { return (z >= 7 && z <= 9) || z === 13 || z === 14; }
// Is the zone a chase zone (outside the strike zone)?
function isChaseZone(z: number) { return z >= 11; }

/**
 * Zone Fit — directly overlaps the pitcher's most-targeted in-zone locations
 * against the batter's personal hot/cold zone map (both from statcast_search data).
 *
 * Hot zone:  batter xBA > 0.310 in that zone → batter edge when pitcher attacks it
 * Cold zone: batter xBA < 0.210 in that zone → pitcher edge when they attack there
 */
export function calcZoneFit(
  batter: MLBBatter,
  pitcher: MLBPitcher
): { favor: "pitcher" | "batter"; label: string; detail: string } | null {
  const pitcherZones = pitcher.zoneProfile?.filter((z) => z.zone >= 1 && z.zone <= 9);
  const batterZones  = batter.zoneProfile?.filter((z)  => z.zone >= 1 && z.zone <= 9 && z.pitches >= 5);

  if (!pitcherZones?.length || !batterZones?.length) return null;

  // Pitcher's top 2 in-zone targets (where they live most)
  const pitcherTargets = pitcherZones.slice(0, 2).map((z) => z.zone);

  // Batter's hot and cold zones from their personal xBA map
  const hotZones  = batterZones.filter((z) => z.xBA > 0.310).map((z) => z.zone);
  const coldZones = batterZones.filter((z) => z.xBA < 0.210).map((z) => z.zone);

  const hotMatch  = pitcherTargets.find((z) => hotZones.includes(z));
  const coldMatch = pitcherTargets.find((z) => coldZones.includes(z));

  if (!hotMatch && !coldMatch) return null;

  // When both overlap, surface the stronger signal
  if (hotMatch && coldMatch) {
    const hotXBA  = batterZones.find((z) => z.zone === hotMatch)?.xBA  ?? 0.260;
    const coldXBA = batterZones.find((z) => z.zone === coldMatch)?.xBA ?? 0.260;
    if (hotXBA - 0.260 >= 0.260 - coldXBA) {
      return { favor: "batter",  label: `Zone Fit: ${zoneLabel(hotMatch)} ↑`,  detail: `xBA .${Math.round(hotXBA * 1000)} in hot zone` };
    }
    return { favor: "pitcher", label: `Zone Fit: ${zoneLabel(coldMatch)} ↓`, detail: `xBA .${Math.round(coldXBA * 1000)} in cold zone` };
  }

  if (hotMatch) {
    const xBA = batterZones.find((z) => z.zone === hotMatch)?.xBA ?? 0;
    return { favor: "batter",  label: `Zone Fit: ${zoneLabel(hotMatch)} ↑`,  detail: `xBA .${Math.round(xBA * 1000)} in hot zone` };
  }

  const xBA = batterZones.find((z) => z.zone === coldMatch)?.xBA ?? 0;
  return { favor: "pitcher", label: `Zone Fit: ${zoneLabel(coldMatch!)} ↓`, detail: `xBA .${Math.round(xBA * 1000)} in cold zone` };
}

/**
 * Pitcher sweet spot — dominant arsenal type + top zone location.
 * Used as a standalone badge on PitcherCard.
 */
export function pitcherSweetSpot(
  pitcher: MLBPitcher
): { label: string; color: string } | null {
  const fbPct  = pitcher.fastballPct  ?? 0;
  const brPct  = pitcher.breakingPct  ?? 0;
  const offPct = pitcher.offspeedPct  ?? 0;

  if (fbPct === 0 && brPct === 0 && offPct === 0) return null;

  const dominant = fbPct >= brPct && fbPct >= offPct ? "FB" : brPct >= offPct ? "Breaking" : "Offspeed";
  const pct = Math.max(fbPct, brPct, offPct);

  let qualifier = "";
  if (dominant === "FB") {
    qualifier = (pitcher.kPct ?? 0) > 26 || (pitcher.whiffPct ?? 0) > 28 ? "Power" : "Reliant";
  } else if (dominant === "Breaking") {
    qualifier = (pitcher.kPct ?? 0) > 24 ? "Specialist" : "Heavy";
  } else {
    qualifier = (pitcher.hardHitAllowedPct ?? 50) < 32 ? "Deceptive" : "Heavy";
  }

  // Append top zone if we have a real zone profile
  const topZone = pitcher.zoneProfile?.[0];
  const zoneSuffix = topZone ? ` · ${zoneLabel(topZone.zone)}` : "";

  const color =
    dominant === "Breaking" ? "bg-violet-500/80 text-white" :
    dominant === "FB"       ? "bg-blue-500/80 text-white" :
                              "bg-amber-600/80 text-white";

  return { label: `${pct.toFixed(0)}% ${dominant} ${qualifier}${zoneSuffix}`, color };
}
