import type { MLBBatter, MLBPitcher, PitchArsenalEntry } from "@/types/mlb";
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

// Shared reliability bar for a pitcher's recent-outings sample — below this,
// last3* numbers are too likely to be a bullpen game / spot start / opener
// (a couple short relief innings) rather than real starts, and season-level
// numbers should be trusted instead. Used by both the Hit Score's pitcher H/9
// component and the strikeout projection below.
const MIN_RELIABLE_RECENT_IP = 9;  // ~3 real starts worth
const MIN_RELIABLE_SEASON_IP = 10;

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

const PITCH_NAMES: Record<string, string> = {
  FF: "Fastball", SI: "Sinker", FC: "Cutter",
  SL: "Slider", ST: "Sweeper", CU: "Curveball", KC: "Knuckle Curve", CS: "Slow Curve", SV: "Slurve",
  CH: "Changeup", FS: "Splitter", FO: "Forkball", KN: "Knuckleball",
};

function pitchName(type: string): string {
  return PITCH_NAMES[type] ?? type;
}

function clampSigned(v: number, max: number) {
  return Math.max(-max, Math.min(max, v));
}

// A pitch has to be a real part of the arsenal (not a show-me pitch) and have
// enough of the pitcher's own PAs behind it before it's trusted as a signal.
const PITCHER_PITCH_MIN_USAGE = 15; // %
const PITCHER_PITCH_MIN_PA = 15;
// Batter's split on that exact pitch needs its own sample before it counts —
// this is the guardrail that stops a 1-PA fluke from swinging the score.
const BATTER_PITCH_MIN_PA = 10;
// A hand-specific arsenal (arsenalVsLeft/arsenalVsRight) needs a real season's
// worth of pitches behind it before it's trusted over the bigger-sample
// combined arsenal — pitchers often do genuinely attack lefties and righties
// differently (a different pitch, or the same pitch located differently), but
// a thin hand-split sample is just noise.
const MIN_HAND_SPLIT_PITCHES = 150;

/**
 * Pick the pitcher's arsenal to score against for this specific batter: the
 * hand-specific split (computed from raw pitch data, see fetchPitcherZoneStats)
 * when it has enough pitches behind it, else the season-leaderboard-sourced
 * combined arsenal.
 */
function arsenalForBatter(batter: MLBBatter, pitcher: MLBPitcher): PitchArsenalEntry[] {
  const handArsenal = batter.hand === "L" ? pitcher.arsenalVsLeft
    : batter.hand === "R" ? pitcher.arsenalVsRight
    : undefined;
  const handTotal = handArsenal?.reduce((s, p) => s + p.pitches, 0) ?? 0;
  return handTotal >= MIN_HAND_SPLIT_PITCHES ? handArsenal! : (pitcher.pitchArsenal ?? []);
}

/**
 * Derive a pitch matchup score component (0–8, baseline 4) from exact
 * pitch-type arsenal data (Baseball Savant pitch-arsenal-stats via
 * MLBPitcher/MLBBatter.pitchArsenal, preferring the pitcher's hand-specific
 * arsenal against today's batter when reliably sampled — see arsenalForBatter).
 * Only pitches that are a real, reliably sampled part of the pitcher's arsenal
 * are considered; each is weighted by how often the pitcher actually throws
 * it, so their most-used pitch dominates the signal rather than a single
 * rare/gimmick pitch "reaching." Combines contact quality (xBA) and contact
 * rate (whiff%) on that exact pitch.
 */
export function calcPitchMatchup(
  batter: MLBBatter,
  pitcher: MLBPitcher
): { earned: number; max: number; value: string } {
  const pitcherPitches = arsenalForBatter(batter, pitcher)
    .filter((p) => p.usage >= PITCHER_PITCH_MIN_USAGE && p.pa >= PITCHER_PITCH_MIN_PA);

  if (pitcherPitches.length === 0 || !batter.pitchArsenal?.length) {
    return { earned: 4, max: 8, value: "—" };
  }

  type Matched = { usage: number; delta: number; note: string };
  const matched: Matched[] = [];

  for (const pp of pitcherPitches) {
    const bp = batter.pitchArsenal.find((e) => e.type === pp.type && e.pa >= BATTER_PITCH_MIN_PA);
    if (!bp) continue;
    const xba = bp.xba ?? bp.ba;
    if (xba === undefined) continue;

    // Contact quality vs a roughly league-average xBA (~.245) — ±3 pts
    const xbaDelta = clampSigned(((xba - 0.245) / 0.070) * 3, 3);
    // Contact rate vs a roughly league-average whiff rate (~24%) — ±1.5 pts
    const whiffDelta = bp.whiff !== undefined
      ? clampSigned(((24 - bp.whiff) / 12) * 1.5, 1.5)
      : 0;

    const delta = xbaDelta + whiffDelta;
    const name = pitchName(pp.type);
    const note =
      delta >= 1  ? `hits ${name} well (${fmt(xba)} xBA, ${pp.usage.toFixed(0)}% usage)` :
      delta <= -1 ? `struggles vs ${name} (${fmt(xba)} xBA, ${pp.usage.toFixed(0)}% usage)` :
                    `neutral vs ${name} (${pp.usage.toFixed(0)}% usage)`;

    matched.push({ usage: pp.usage, delta, note });
  }

  if (matched.length === 0) return { earned: 4, max: 8, value: "—" };

  // Usage-weighted average across every qualifying pitch — a single dominant,
  // well-sampled pitch can still swing the full range; multiple pitches blend
  // proportionally to how often the pitcher actually throws each one.
  const totalUsage = matched.reduce((s, m) => s + m.usage, 0);
  const weightedDelta = matched.reduce((s, m) => s + m.delta * m.usage, 0) / totalUsage;
  const earned = clamp(4 + clampSigned(weightedDelta, 4), 8);

  // Lead with whichever matched pitch drove the biggest swing
  const lead = matched.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a));

  return { earned: Math.round(earned), max: 8, value: lead.note };
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
  //    A batter with no game log yet (true rookie debut, first tracked game)
  //    shouldn't score a flat 0 here just because there's nothing to compute
  //    from — same "missing data isn't the worst case" principle as the
  //    pitcher H/9 neutral default below.
  const W_FORM = HIT_WEIGHTS.form; // 20
  const hasRecentGames = batter.last10Games.length > 0;
  const formRaw = (batter.last10AVG / 0.380) * (W_FORM * 0.65) + (batter.last3AVG / 0.480) * (W_FORM * 0.35);
  const form = hasRecentGames ? clamp(formRaw, W_FORM) : W_FORM / 2;
  components.push({
    label: "Recent AVG (L3/L10)",
    earned: Math.round(form),
    max: W_FORM,
    value: hasRecentGames ? `${fmt(batter.last3AVG)} / ${fmt(batter.last10AVG)}` : "no game log — neutral",
  });

  // 2. Hit consistency — prefer hitRate20 (3× more predictive than hitRate10)
  //    Falls back to hitRate10 (from last10Games) when hitRate20 not available,
  //    and to a neutral midpoint (not 0) when there's no game log at all.
  const W_CONS = HIT_WEIGHTS.consistency; // 18
  let consistencyLabel: string;
  let consistencyScore: number;
  if (batter.hitRate20 !== undefined && batter.hitRate20 > 0) {
    consistencyScore = clamp(batter.hitRate20 * W_CONS, W_CONS);
    const gamesWithHit = Math.round(batter.hitRate20 * 20);
    consistencyLabel = `${gamesWithHit}/20 games (L20)`;
  } else {
    const gp = batter.last10Games.length;
    if (gp > 0) {
      const hitsIn10 = batter.last10Games.filter((g) => g.hits > 0).length;
      consistencyScore = clamp((hitsIn10 / gp) * W_CONS, W_CONS);
      consistencyLabel = `${hitsIn10}/${gp} games (L10)`;
    } else {
      consistencyScore = W_CONS / 2;
      consistencyLabel = "no game log — neutral";
    }
  }
  components.push({
    label: "Hit Consistency",
    earned: Math.round(consistencyScore),
    max: W_CONS,
    value: consistencyLabel,
  });

  // 3. Matchup vs pitcher hand (0–HIT_WEIGHTS.vsHand) — the single biggest
  //    weight, so getting the missing-data case right matters most here.
  //    Falls back split → seasonAVG → neutral midpoint (not 0) when the
  //    batter has no usable average at all (true blank slate).
  const W_VSHAND = HIT_WEIGHTS.vsHand; // 16
  let matchup: number;
  if (pitcher) {
    const rawMatchupAvg = pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight;
    // Use seasonAVG as fallback when split is 0 (missing data, not actually .000)
    const matchupAvg = rawMatchupAvg > 0 ? rawMatchupAvg : batter.seasonAVG;
    matchup = matchupAvg > 0 ? clamp((matchupAvg / 0.360) * W_VSHAND, W_VSHAND) : W_VSHAND / 2;
    components.push({
      label: `AVG vs ${pitcher.hand === "L" ? "LHP" : "RHP"}`,
      earned: Math.round(matchup),
      max: W_VSHAND,
      value: rawMatchupAvg > 0 ? fmt(rawMatchupAvg)
        : matchupAvg > 0 ? `${fmt(batter.seasonAVG)} (season, no split)`
        : "no history — neutral",
    });
  } else {
    matchup = batter.seasonAVG > 0 ? clamp((batter.seasonAVG / 0.340) * (W_VSHAND * 0.7), W_VSHAND) : W_VSHAND / 2;
    components.push({
      label: "Season AVG (no SP)",
      earned: Math.round(matchup),
      max: W_VSHAND,
      value: batter.seasonAVG > 0 ? fmt(batter.seasonAVG) : "no history — neutral",
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

  // 5b. Park Fit (Spray) — small modifier (0–3), distinct from the blanket
  //     Park Factor above (which model-weights.ts notes has ~zero correlation
  //     with "got a hit"). This instead asks a narrower, better-grounded
  //     question: does *this batter's own* spray tendency (real pull/straight/
  //     oppo split, min 20 batted balls) actually reach this specific park's
  //     short side? A short fence only helps a batter who can actually reach
  //     it — reusing the same distance scale as HR Score's pull-distance mod.
  let parkFitScore = 0;
  let parkFitValue = "—";
  if (opts.lf !== undefined && opts.rf !== undefined &&
      batter.pullPct !== undefined && batter.straightPct !== undefined && batter.oppoPct !== undefined) {
    const pullDist = batter.hand === "L" ? opts.rf : batter.hand === "R" ? opts.lf : (opts.lf + opts.rf) / 2;
    const oppoDist = batter.hand === "L" ? opts.lf : batter.hand === "R" ? opts.rf : (opts.lf + opts.rf) / 2;
    const distScore3 = (d: number) => clamp(((365 - d) / 65) * 3, 3);
    parkFitScore =
      (distScore3(pullDist) * batter.pullPct + 1.5 * batter.straightPct + distScore3(oppoDist) * batter.oppoPct) / 100;
    const side = batter.hand === "L" ? "RF" : batter.hand === "R" ? "LF" : "avg";
    parkFitValue = `${batter.pullPct.toFixed(0)}% pull → ${pullDist}ft ${side}`;
  }
  components.push({
    label: "Park Fit (Spray)",
    earned: Math.round(parkFitScore),
    max: 3,
    value: parkFitValue,
  });

  // 6. Pitcher H/9 rate (0–HIT_WEIGHTS.pitcherH)
  //    Rate-based so relievers and starters are comparable.
  //    5.0 H/9 = elite (0 pts), 11.0 H/9 = very hittable (max pts). League avg ~8.5.
  //    A bullpen game / spot start / opener can leave last3InningsPitched tiny
  //    (a couple short relief outings) — too small a sample to trust for this,
  //    the single biggest-weighted component in the whole model. Previously that
  //    thin sample fed straight into the formula anyway, and true no-data cases
  //    scored a flat 0/25 — the single largest possible penalty, purely from not
  //    knowing anything. Now: fall back to season H/9 when the recent sample is
  //    too thin, and default to a neutral midpoint (not 0) when there's truly no
  //    reliable data either way — missing information shouldn't read as "worst
  //    pitcher in the league."
  const W_PITCHER_H = HIT_WEIGHTS.pitcherH; // 25
  let pitcherScore = W_PITCHER_H / 2; // neutral default
  if (pitcher) {
    const recentReliable = pitcher.last3InningsPitched >= MIN_RELIABLE_RECENT_IP;
    const seasonReliable = (pitcher.seasonInningsPitched ?? 0) >= MIN_RELIABLE_SEASON_IP;

    let h9: number | null = null;
    let source: "recent" | "season" | null = null;
    if (recentReliable) {
      h9 = (pitcher.last3HitsAllowed / pitcher.last3InningsPitched) * 9;
      source = "recent";
    } else if (seasonReliable) {
      h9 = (pitcher.seasonHitsAllowed! / pitcher.seasonInningsPitched!) * 9;
      source = "season";
    }

    if (h9 !== null) {
      pitcherScore = clamp(((h9 - 5.0) / 6.0) * W_PITCHER_H, W_PITCHER_H);
    }

    const pitcherTier =
      h9 === null ? "no data — neutral" :
      h9 >= 10.0  ? "very hittable" :
      h9 >= 8.5   ? "above avg" :
      h9 >= 7.0   ? "average" : "tough";

    const ipLabel =
      source === "recent" ? `${pitcher.last3HitsAllowed}H / ${pitcher.last3InningsPitched.toFixed(1)}IP` :
      source === "season" ? `${pitcher.seasonHitsAllowed}H / ${pitcher.seasonInningsPitched!.toFixed(1)}IP` :
      pitcher.last3InningsPitched > 0 ? `${pitcher.last3HitsAllowed}H / ${pitcher.last3InningsPitched.toFixed(1)}IP (thin sample)` :
      "no innings logged";
    const sourceSuffix = source === "season" ? " · season (thin recent sample)" : "";

    components.push({
      label: source === "season" ? "Pitcher H/9 (season)" : "Pitcher H/9 (L3 apps)",
      earned: Math.round(pitcherScore),
      max: W_PITCHER_H,
      value: h9 !== null ? `${h9.toFixed(1)} H/9 (${ipLabel})${sourceSuffix} — ${pitcherTier}` : `${ipLabel} — ${pitcherTier}`,
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

  // 8. xBA (0–HIT_WEIGHTS.xBA) — neutral midpoint (not 0) when Statcast data
  //    isn't available yet, same missing-data principle as everywhere else.
  const W_XBA = HIT_WEIGHTS.xBA; // 9
  const hasXBA = batter.xBA !== undefined && batter.xBA > 0;
  const xBAScore = hasXBA ? clamp((batter.xBA! / 0.340) * W_XBA, W_XBA) : W_XBA / 2;
  components.push({
    label: "xBA (Statcast)",
    earned: Math.round(xBAScore),
    max: W_XBA,
    value: hasXBA ? fmt(batter.xBA!) : "no data — neutral",
  });

  // 9. Hard Hit % (0–HIT_WEIGHTS.hardHit)
  const W_HH = HIT_WEIGHTS.hardHit; // 3
  const hasHardHit = batter.hardHitPct !== undefined && batter.hardHitPct > 0;
  const hardHitScore = hasHardHit ? clamp((batter.hardHitPct! / 55) * W_HH, W_HH) : W_HH / 2;
  components.push({
    label: "Hard Hit %",
    earned: Math.round(hardHitScore),
    max: W_HH,
    value: hasHardHit ? `${batter.hardHitPct!.toFixed(1)}%` : "no data — neutral",
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

  // 11. Matchup — exact pitch-type arsenal + zone-location overlap, combined
  //     into a single 0–8 (baseline 4) modifier. Zone fit is folded into this
  //     same budget rather than added as a new one, so the total score's
  //     achievable range is unchanged from before this component existed.
  let pitchMatchupScore = 0;
  if (pitcher) {
    const pm = calcPitchMatchup(batter, pitcher);
    const zf = calcZoneFitDelta(batter, pitcher);
    const combinedDelta = clampSigned((pm.earned - 4) + zf.delta, 4);
    const earned = clamp(4 + combinedDelta, 8);
    pitchMatchupScore = earned - 4; // offset from neutral baseline so it doesn't double-count
    // Lead with whichever signal is doing more of the work
    const value = zf.note && Math.abs(zf.delta) > Math.abs(pm.earned - 4) ? zf.note : pm.value;
    components.push({ label: "Matchup (Pitch + Zone)", earned: Math.round(earned), max: 8, value });
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
    form + consistencyScore + matchup + homeAwayScore + streakScore + park + parkFitScore + pitcherScore + pitcherSplitScore +
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

  // 5. Pull-side field distance (0–7, based on batter hand) — blended by the
  //    batter's REAL spray tendency when we have it (pullPct/straightPct/
  //    oppoPct, from actual batted-ball location, not just an assumed 100%
  //    pull-by-hand). A batter who only pulls the ball 20% of the time
  //    shouldn't get full credit (or blame) for the pull-side fence distance.
  //    Falls back to the old 100%-pull assumption when spray data isn't
  //    available yet (min 20 batted balls — see fetchBatterZoneProfiles).
  let pullScore = 3; // neutral default
  let pullValue = "—";
  if (opts.lf !== undefined && opts.rf !== undefined) {
    const pullDist =
      batter.hand === "L" ? opts.rf :
      batter.hand === "R" ? opts.lf :
      (opts.lf + opts.rf) / 2; // switch hitter
    const oppoDist =
      batter.hand === "L" ? opts.lf :
      batter.hand === "R" ? opts.rf :
      (opts.lf + opts.rf) / 2;
    // Scale: 300ft = 7pts (very short), 365ft = 0pts (very deep)
    const distScore = (d: number) => clamp(((365 - d) / 65) * 7, 7);
    const pullFieldScore = distScore(pullDist);
    const side = batter.hand === "L" ? "RF" : batter.hand === "R" ? "LF" : "avg";
    const tier = pullDist <= 315 ? "short" : pullDist <= 330 ? "avg" : "deep";

    if (batter.pullPct !== undefined && batter.straightPct !== undefined && batter.oppoPct !== undefined) {
      const oppoFieldScore = distScore(oppoDist);
      const straightScore = 3; // no CF fence-distance data available — neutral
      pullScore =
        (pullFieldScore * batter.pullPct + straightScore * batter.straightPct + oppoFieldScore * batter.oppoPct) / 100;
      pullValue = `${batter.pullPct.toFixed(0)}% pull → ${pullDist}ft ${side} (${tier})`;
    } else {
      pullScore = pullFieldScore;
      pullValue = `${pullDist}ft ${side} — ${tier}`;
    }
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

// A pitcher's zone needs a real sample behind it before its xBA-against is
// trusted as a "vulnerable spot" — otherwise a 1-2 pitch zone with a lucky
// (or unlucky) result looks identical to a real weakness.
const PITCHER_ZONE_MIN_PITCHES = 8;

type ZoneFitMatch = { zone: number; xBA: number; kind: "hot" | "cold" };

/**
 * Pick the pitcher's zone profile to check for this specific batter: the
 * hand-specific split when it has enough pitches behind it (same bar as
 * arsenalForBatter — pitchers often locate differently by batter hand), else
 * the combined profile.
 */
function zoneProfileForBatter(batter: MLBBatter, pitcher: MLBPitcher) {
  const handProfile = batter.hand === "L" ? pitcher.zoneProfileVsLeft
    : batter.hand === "R" ? pitcher.zoneProfileVsRight
    : undefined;
  const handTotal = handProfile?.reduce((s, z) => s + z.pitches, 0) ?? 0;
  return handTotal >= MIN_HAND_SPLIT_PITCHES ? handProfile! : (pitcher.zoneProfile ?? []);
}

/**
 * Finds the strongest overlap between where a batter is hot/cold (by xBA,
 * min 5 pitches seen in that zone) and where the pitcher actually lives —
 * both their most-thrown zones (where they live most) AND their most
 * vulnerable zones (worst xBA against, min 8 pitches so a tiny sample can't
 * manufacture a fake weak spot). Shared by the card badge and the score.
 */
function zoneFitCore(batter: MLBBatter, pitcher: MLBPitcher): ZoneFitMatch | null {
  const inZone = zoneProfileForBatter(batter, pitcher).filter((z) => z.zone >= 1 && z.zone <= 9);
  const batterZones = batter.zoneProfile?.filter((z) => z.zone >= 1 && z.zone <= 9 && z.pitches >= 5);
  if (!inZone.length || !batterZones?.length) return null;

  // Where the pitcher lives most (zoneProfile is sorted most-frequent first)
  const frequentTargets = inZone.slice(0, 2).map((z) => z.zone);
  // Where the pitcher has actually been hurt (worst xBA against, sample-gated)
  const vulnerableTargets = inZone
    .filter((z) => z.pitches >= PITCHER_ZONE_MIN_PITCHES && z.xBA !== null)
    .sort((a, b) => (b.xBA as number) - (a.xBA as number))
    .slice(0, 2)
    .map((z) => z.zone);
  const targets = Array.from(new Set([...frequentTargets, ...vulnerableTargets]));

  // Batter's hot and cold zones from their personal xBA map
  const hotZones  = batterZones.filter((z) => z.xBA > 0.310).map((z) => z.zone);
  const coldZones = batterZones.filter((z) => z.xBA < 0.210).map((z) => z.zone);

  const hotMatch  = targets.find((z) => hotZones.includes(z));
  const coldMatch = targets.find((z) => coldZones.includes(z));
  if (!hotMatch && !coldMatch) return null;

  // When both overlap, surface the stronger signal
  if (hotMatch && coldMatch) {
    const hotXBA  = batterZones.find((z) => z.zone === hotMatch)?.xBA  ?? 0.260;
    const coldXBA = batterZones.find((z) => z.zone === coldMatch)?.xBA ?? 0.260;
    return hotXBA - 0.260 >= 0.260 - coldXBA
      ? { zone: hotMatch,  xBA: hotXBA,  kind: "hot" }
      : { zone: coldMatch, xBA: coldXBA, kind: "cold" };
  }
  if (hotMatch) {
    const xBA = batterZones.find((z) => z.zone === hotMatch)?.xBA ?? 0;
    return { zone: hotMatch, xBA, kind: "hot" };
  }
  const xBA = batterZones.find((z) => z.zone === coldMatch)?.xBA ?? 0;
  return { zone: coldMatch!, xBA, kind: "cold" };
}

/**
 * Zone Fit badge — directly overlaps the pitcher's most-targeted/most-vulnerable
 * in-zone locations against the batter's personal hot/cold zone map. Standalone
 * card badge — unaffected by the scoring change below.
 *
 * Hot zone:  batter xBA > 0.310 in that zone → batter edge when pitcher attacks it
 * Cold zone: batter xBA < 0.210 in that zone → pitcher edge when they attack there
 */
export function calcZoneFit(
  batter: MLBBatter,
  pitcher: MLBPitcher
): { favor: "pitcher" | "batter"; label: string; detail: string } | null {
  const match = zoneFitCore(batter, pitcher);
  if (!match) return null;
  const favor = match.kind === "hot" ? "batter" : "pitcher";
  const arrow = match.kind === "hot" ? "↑" : "↓";
  return {
    favor,
    label: `Zone Fit: ${zoneLabel(match.zone)} ${arrow}`,
    detail: `xBA .${Math.round(match.xBA * 1000)} in ${match.kind} zone`,
  };
}

/**
 * Small (±2) scoring delta from the same zone-fit signal, for use inside
 * calcHitScoreBreakdown — folded into the Pitch Matchup modifier's existing
 * budget rather than adding a new separate one (see calcHitScoreBreakdown).
 */
function calcZoneFitDelta(batter: MLBBatter, pitcher: MLBPitcher): { delta: number; note: string | null } {
  const match = zoneFitCore(batter, pitcher);
  if (!match) return { delta: 0, note: null };
  const delta = match.kind === "hot" ? 2 : -2;
  const note = `${match.kind} zone overlap: ${zoneLabel(match.zone)} (.${Math.round(match.xBA * 1000)} xBA)`;
  return { delta, note };
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

// Real strikeout-pitcher territory (season K% per AB) and a team recently
// running notably hotter than the ~22% league-average whiff rate.
const K_RISK_PITCHER_MIN_KPCT = 25;
const K_RISK_TEAM_MIN_KPCT = 24;

/**
 * Strikeout-risk flag — today's starter has a real strikeout arsenal AND the
 * opposing team has been striking out a lot over their last ~10 days. Both
 * conditions have to hold; either alone isn't a signal (an ace facing a
 * disciplined lineup, or a soft-tosser facing a free-swinging one, isn't the
 * same risk as both stacking together).
 */
export function strikeoutRiskBadge(
  pitcher: MLBPitcher
): { label: string; detail: string; color: string } | null {
  const kPct = pitcher.kPct;
  const teamKPct = pitcher.opposingTeamKPct;
  if (kPct === undefined || teamKPct === undefined) return null;
  if (kPct < K_RISK_PITCHER_MIN_KPCT || teamKPct < K_RISK_TEAM_MIN_KPCT) return null;

  return {
    label: "K Risk",
    detail: `${pitcher.name.split(" ").slice(-1)[0]} ${kPct.toFixed(0)}% K vs a lineup striking out ${teamKPct.toFixed(0)}% lately`,
    color: "bg-red-600/85 text-white",
  };
}

const LEAGUE_AVG_TEAM_K_PCT = 22; // rough MLB-average team strikeout rate
const OPPONENT_K_ADJ_CAP = 0.15;  // cap the opponent-based nudge to ±15% either way
const NEUTRAL_IP_PER_START = 5.5; // fallback expected innings when the recent sample is too thin to trust

/**
 * Projects how many strikeouts a starter is likely to record tonight — their
 * own K/9 rate (recent, falling back to season using the same reliability
 * bar as the Hit Score's pitcher H/9 component) times how deep they've been
 * going lately, nudged up or down by how strikeout-prone tonight's opponent
 * has been recently (capped so one team's small sample can't swing it too
 * far). This is the "would this pitcher get 4+ Ks tonight" number.
 */
export function calcProjectedStrikeouts(pitcher: MLBPitcher): {
  projected: number;
  k9: number | null;
  k9Source: "recent" | "season" | null;
  avgIpPerStart: number;
  opponentAdjPct: number; // e.g. +8 means the opponent nudged the projection up 8%
} {
  const recentReliable = pitcher.last3InningsPitched >= MIN_RELIABLE_RECENT_IP;
  const seasonReliable = (pitcher.seasonInningsPitched ?? 0) >= MIN_RELIABLE_SEASON_IP;

  let k9: number | null = null;
  let k9Source: "recent" | "season" | null = null;
  if (recentReliable) {
    k9 = (pitcher.last3Strikeouts / pitcher.last3InningsPitched) * 9;
    k9Source = "recent";
  } else if (seasonReliable) {
    k9 = (pitcher.seasonStrikeouts! / pitcher.seasonInningsPitched!) * 9;
    k9Source = "season";
  }

  const avgIpPerStart = recentReliable ? pitcher.last3InningsPitched / 3 : NEUTRAL_IP_PER_START;
  const baseProjected = k9 !== null ? (k9 * avgIpPerStart) / 9 : 0;

  const opponentAdj = pitcher.opposingTeamKPct !== undefined
    ? Math.min(1 + OPPONENT_K_ADJ_CAP, Math.max(1 - OPPONENT_K_ADJ_CAP, pitcher.opposingTeamKPct / LEAGUE_AVG_TEAM_K_PCT))
    : 1;

  return {
    projected: Math.round(baseProjected * opponentAdj * 10) / 10,
    k9: k9 !== null ? Math.round(k9 * 10) / 10 : null,
    k9Source,
    avgIpPerStart: Math.round(avgIpPerStart * 10) / 10,
    opponentAdjPct: Math.round((opponentAdj - 1) * 100),
  };
}
