import type { DailySnapshot, MLBBatter, MLBGame, MLBPitcher } from "@/types/mlb";
import { calcHitScore, calcHRScore, getColdStreak } from "@/lib/scores";

export interface PitcherAnalyticsRow {
  id: number;
  name: string;
  hand: "L" | "R";
  teamAbbreviation: string;
  isPlayingToday: boolean;
  opponentAbbreviation?: string;
  gamePk?: number;
  last3HitsAllowed: number;
  last6HitsAllowed: number;
  last9HitsAllowed: number;
  avgHitsPerStart: number;
  seasonERA: number;
  last3ERA: number;
  last3HRAllowed: number;
  seasonHRAllowed: number;
  starts: number;
  hardHitAllowedPct?: number;
  barrelAllowedPct?: number;
  xBAAgainst?: number;
  whiffPct?: number;
  kPct?: number;
  fastballPct?: number;
  breakingPct?: number;
  offspeedPct?: number;
}

export function buildPitcherAnalyticsRows(
  snapshots: DailySnapshot[],
  today: string
): PitcherAnalyticsRow[] {
  // Build today's starter lookup from the most recent snapshot matching today
  const todayPitcherIds = new Set<number>();
  const todayGameMap = new Map<number, { opponentAbbreviation: string; gamePk: number }>();
  const todaySnap = snapshots.find((s) => s.date === today);
  if (todaySnap) {
    for (const game of todaySnap.games) {
      if (game.awayStartingPitcher) {
        todayPitcherIds.add(game.awayStartingPitcher.id);
        todayGameMap.set(game.awayStartingPitcher.id, { opponentAbbreviation: game.homeTeam.abbreviation, gamePk: game.gamePk });
      }
      if (game.homeStartingPitcher) {
        todayPitcherIds.add(game.homeStartingPitcher.id);
        todayGameMap.set(game.homeStartingPitcher.id, { opponentAbbreviation: game.awayTeam.abbreviation, gamePk: game.gamePk });
      }
    }
  }

  const toRow = (p: MLBPitcher, team: string, opp: string, gamePk: number): PitcherAnalyticsRow => {
    const starts = Math.max(p.last3Starts?.length ?? 0, 1);
    const isToday = todayPitcherIds.has(p.id);
    const todayCtx = todayGameMap.get(p.id);
    return {
      id: p.id,
      name: p.name,
      hand: p.hand,
      teamAbbreviation: team,
      isPlayingToday: isToday,
      opponentAbbreviation: isToday ? (todayCtx?.opponentAbbreviation ?? opp) : undefined,
      gamePk: isToday ? (todayCtx?.gamePk ?? gamePk) : undefined,
      last3HitsAllowed: p.last3HitsAllowed,
      last6HitsAllowed: p.last6HitsAllowed,
      last9HitsAllowed: p.last9HitsAllowed ?? 0,
      avgHitsPerStart: parseFloat((p.last3HitsAllowed / starts).toFixed(1)),
      seasonERA: p.seasonERA,
      last3ERA: p.last3ERA,
      last3HRAllowed: p.last3HRAllowed ?? 0,
      seasonHRAllowed: p.seasonHRAllowed ?? 0,
      starts,
      hardHitAllowedPct: p.hardHitAllowedPct,
      barrelAllowedPct: p.barrelAllowedPct,
      xBAAgainst: p.xBAAgainst,
      whiffPct: p.whiffPct,
      kPct: p.kPct,
      fastballPct: p.fastballPct,
      breakingPct: p.breakingPct,
      offspeedPct: p.offspeedPct,
    };
  };

  // Snapshots are newest-first; first occurrence of each pitcher = most recent stats
  const seen = new Map<number, PitcherAnalyticsRow>();
  for (const snap of snapshots) {
    for (const game of snap.games) {
      const addPitcher = (p: MLBPitcher | undefined, team: string, opp: string) => {
        if (!p) return;
        const row = toRow(p, team, opp, game.gamePk);
        if (!seen.has(p.id)) {
          seen.set(p.id, row);
        } else if (row.isPlayingToday && snap.date === today) {
          // Overwrite with today's data only when processing the today snapshot
          seen.set(p.id, row);
        }
      };
      addPitcher(game.awayStartingPitcher, game.awayTeam.abbreviation, game.homeTeam.abbreviation);
      addPitcher(game.homeStartingPitcher, game.homeTeam.abbreviation, game.awayTeam.abbreviation);
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export interface RankedBatter extends MLBBatter {
  teamAbbreviation: string;
  score: number;
  opposingPitcherHand?: "L" | "R";
}

export interface RankedPitcher extends MLBPitcher {
  teamAbbreviation: string;
  score: number;
  kPerGame: number;
}

/** Flatten all batters from the snapshot, tagging each with team + opposing pitcher hand */
function flattenBatters(snapshot: DailySnapshot): RankedBatter[] {
  const batters: RankedBatter[] = [];
  for (const game of snapshot.games) {
    const homePitcherHand = game.homeStartingPitcher?.hand;
    const awayPitcherHand = game.awayStartingPitcher?.hand;

    for (const b of game.awayLineup) {
      batters.push({
        ...b,
        teamAbbreviation: game.awayTeam.abbreviation,
        score: 0,
        opposingPitcherHand: homePitcherHand,
      });
    }
    for (const b of game.homeLineup) {
      batters.push({
        ...b,
        teamAbbreviation: game.homeTeam.abbreviation,
        score: 0,
        opposingPitcherHand: awayPitcherHand,
      });
    }
  }
  return batters;
}

function matchupBonus(batter: RankedBatter): number {
  const avg =
    batter.opposingPitcherHand === "L"
      ? batter.avgVsLeft
      : batter.avgVsRight;
  if (avg >= 0.280) return 0.05;
  if (avg <= 0.210) return -0.05;
  return 0;
}

function hitterScore(b: RankedBatter): number {
  return (
    b.last3AVG * 0.4 +
    b.last6AVG * 0.2 +
    b.hittingStreak * 0.02 +
    matchupBonus(b)
  );
}

/** Top 10 hottest hitters by composite score */
export function getHottestHitters(snapshot: DailySnapshot): RankedBatter[] {
  return flattenBatters(snapshot)
    .map((b) => ({ ...b, score: hitterScore(b) }))
    .filter((b) => b.last3AVG > 0 || b.hittingStreak > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

/** Bottom 10 coldest hitters */
export function getColdestHitters(snapshot: DailySnapshot): RankedBatter[] {
  return flattenBatters(snapshot)
    .map((b) => ({ ...b, score: hitterScore(b) }))
    .filter((b) => b.seasonAVG > 0.150) // exclude empty/no-data players
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);
}

function hrScore(b: RankedBatter): number {
  return b.last3HR * 0.6 + b.last6HR * 0.4;
}

/** Top 10 hottest HR hitters */
export function getHottestHRHitters(snapshot: DailySnapshot): RankedBatter[] {
  return flattenBatters(snapshot)
    .map((b) => ({ ...b, score: hrScore(b) }))
    .filter((b) => b.last6HR > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

/** Top 10 coldest HR hitters (min 5 season HRs to filter non-power hitters) */
export function getColdestHRHitters(snapshot: DailySnapshot): RankedBatter[] {
  return flattenBatters(snapshot)
    .map((b) => ({ ...b, score: hrScore(b) }))
    .filter((b) => b.seasonHR >= 5)
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);
}

export interface PitcherTodayRow {
  id: number;
  name: string;
  hand: "L" | "R";
  teamAbbreviation: string;
  opponentAbbreviation: string;
  gamePk: number;
  seasonERA: number;
  last3HitsAllowed: number;
  avgHitsPerStart: number;
  last3HRAllowed: number;
  seasonHRAllowed: number;
  starts: number;
}

/** All starting pitchers today with hit-rate context */
export function getPitchersToday(snapshot: DailySnapshot): PitcherTodayRow[] {
  const rows: PitcherTodayRow[] = [];
  for (const game of snapshot.games) {
    const add = (p: MLBPitcher, team: string, opp: string) => {
      const starts = p.last3Starts.length || 1;
      rows.push({
        id: p.id,
        name: p.name,
        hand: p.hand,
        teamAbbreviation: team,
        opponentAbbreviation: opp,
        gamePk: game.gamePk,
        seasonERA: p.seasonERA,
        last3HitsAllowed: p.last3HitsAllowed,
        avgHitsPerStart: parseFloat((p.last3HitsAllowed / starts).toFixed(1)),
        last3HRAllowed: p.last3HRAllowed ?? 0,
        seasonHRAllowed: p.seasonHRAllowed ?? 0,
        starts,
      });
    };
    if (game.awayStartingPitcher)
      add(game.awayStartingPitcher, game.awayTeam.abbreviation, game.homeTeam.abbreviation);
    if (game.homeStartingPitcher)
      add(game.homeStartingPitcher, game.homeTeam.abbreviation, game.awayTeam.abbreviation);
  }
  return rows.sort((a, b) => a.avgHitsPerStart - b.avgHitsPerStart);
}

export interface HitConsistencyRow {
  id: number;
  name: string;
  teamAbbreviation: string;
  gamePk: number;
  opposingPitcherName: string;
  opposingPitcherHand: "L" | "R" | null;
  pitcherL3Hits: number;
  hitRate10: number;
  hitRate20: number;
  hitRate30: number;
  hitRate40: number;
  gameLogCount: number;
  consistencyScore: number; // weighted composite for default sort
}

/** Top 40 batters by season-long hit consistency across 10/20/30/40 game windows */
export function getHitConsistency(snapshot: DailySnapshot): HitConsistencyRow[] {
  const rows: HitConsistencyRow[] = [];

  for (const game of snapshot.games) {
    const addBatters = (
      lineup: MLBBatter[],
      teamAbbr: string,
      opposingPitcher: MLBPitcher | undefined,
    ) => {
      for (const b of lineup) {
        if ((b.gameLogCount ?? 0) < 30) continue; // require at least 30 games played
        const consistencyScore =
          (b.hitRate10 ?? 0) * 0.4 +
          (b.hitRate20 ?? 0) * 0.3 +
          (b.hitRate30 ?? 0) * 0.2 +
          (b.hitRate40 ?? 0) * 0.1;
        rows.push({
          id: b.id,
          name: b.name,
          teamAbbreviation: teamAbbr,
          gamePk: game.gamePk,
          opposingPitcherName: opposingPitcher?.name ?? "TBD",
          opposingPitcherHand: opposingPitcher?.hand ?? null,
          pitcherL3Hits: opposingPitcher?.last3HitsAllowed ?? 0,
          hitRate10: b.hitRate10 ?? 0,
          hitRate20: b.hitRate20 ?? 0,
          hitRate30: b.hitRate30 ?? 0,
          hitRate40: b.hitRate40 ?? 0,
          gameLogCount: b.gameLogCount ?? 0,
          consistencyScore,
        });
      }
    };

    addBatters(game.awayLineup, game.awayTeam.abbreviation, game.homeStartingPitcher);
    addBatters(game.homeLineup, game.homeTeam.abbreviation, game.awayStartingPitcher);
  }

  return rows
    .sort((a, b) => b.consistencyScore - a.consistencyScore)
    .slice(0, 40);
}

export interface AiPickRow {
  id: number;
  name: string;
  team: string;
  gamePk: number;
  gameTime: string;
  gameTimeIso: string;
  hitScore: number;
  slot: number;
  pitcherName: string;
  pitcherHand: "L" | "R";
  pitcherERA: number;
  pitcherH9: number | null;
  hitRate: number;
  streak: number;
  coldStreak: number;
  bounceback: boolean;
  vsHand: number;
  blurb: string;
}

function formatGameTime(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " ET";
  } catch {
    return isoStr;
  }
}

function makeBlurb(
  name: string,
  hitRate: number,
  streak: number,
  coldStreak: number,
  bounceback: boolean,
  pitcherName: string,
  pitcherHand: "L" | "R",
  pitcherH9: number | null,
  vsHand: number,
): string {
  const parts: string[] = [];

  if (bounceback) {
    parts.push(`Bounce-back spot — ${Math.round(hitRate * 100)}% hit rate, hitless yesterday`);
  } else if (coldStreak >= 3) {
    parts.push(`${coldStreak}-game cold streak — fading`);
  }

  if (streak >= 5) parts.push(`${streak}-game hit streak`);
  else if (streak >= 3 && !bounceback) parts.push(`${streak}-game streak`);

  if (pitcherH9 !== null && pitcherH9 >= 11.0) {
    parts.push(`${pitcherName} allowing ${pitcherH9.toFixed(1)} H/9`);
  } else if (pitcherH9 !== null && pitcherH9 >= 9.5) {
    parts.push(`${pitcherName} hittable (${pitcherH9.toFixed(1)} H/9)`);
  }

  if (vsHand >= 0.300) {
    parts.push(`.${Math.round(vsHand * 1000)} avg vs ${pitcherHand}HP`);
  }

  if (parts.length === 0 && hitRate >= 0.70) {
    parts.push(`${Math.round(hitRate * 100)}% hit rate over last 20 games`);
  }

  if (parts.length === 0) parts.push(`Strong composite score vs ${pitcherName}`);

  return parts.join(" · ");
}

/** All batters today scoring ≥60 on the full hit model, sorted by score desc */
export function buildAiPicksRows(snapshot: DailySnapshot): AiPickRow[] {
  const rows: AiPickRow[] = [];

  for (const game of snapshot.games) {
    const pairs: [MLBBatter[], MLBPitcher | undefined][] = [
      [game.awayLineup, game.homeStartingPitcher],
      [game.homeLineup, game.awayStartingPitcher],
    ];
    for (const [lineup, pitcher] of pairs) {
      for (const batter of lineup) {
        const score = calcHitScore(batter, pitcher, game.parkFactor);
        if (score < 60) continue;

        const prior = batter.last10Games ?? [];
        const coldStreak = getColdStreak(batter);
        const hitRate =
          batter.hitRate20 ??
          (prior.length > 0 ? prior.filter((g) => (g.hits ?? 0) > 0).length / prior.length : 0);
        const bounceback =
          coldStreak === 1 && score >= 50 && hitRate >= 0.50;
        const h9 =
          pitcher && pitcher.last3InningsPitched > 0
            ? (pitcher.last3HitsAllowed / pitcher.last3InningsPitched) * 9
            : null;
        const vsHand =
          pitcher?.hand === "L" ? batter.avgVsLeft : batter.avgVsRight ?? 0;

        rows.push({
          id: batter.id,
          name: batter.name,
          team: batter.teamAbbreviation ?? game.awayTeam.abbreviation,
          gamePk: game.gamePk,
          gameTime: formatGameTime(game.gameDate),
          gameTimeIso: game.gameDate,
          hitScore: score,
          slot: batter.battingOrder ?? 0,
          pitcherName: pitcher?.name ?? "TBD",
          pitcherHand: pitcher?.hand ?? "R",
          pitcherERA: pitcher?.seasonERA ?? 0,
          pitcherH9: h9,
          hitRate,
          streak: batter.hittingStreak ?? 0,
          coldStreak,
          bounceback,
          vsHand,
          blurb: makeBlurb(
            batter.name,
            hitRate,
            batter.hittingStreak ?? 0,
            coldStreak,
            bounceback,
            pitcher?.name ?? "TBD",
            pitcher?.hand ?? "R",
            h9,
            vsHand,
          ),
        });
      }
    }
  }

  return rows.sort((a, b) => b.hitScore - a.hitScore);
}

export interface BestSluggerRow {
  id: number;
  name: string;
  team: string;
  gamePk: number;
  gameTime: string;
  gameTimeIso: string;
  hrScore: number;
  slot: number;
  // Batter power metrics
  barrelPct: number | null;
  hardHitPct: number | null;
  xwOBA: number | null;
  xSLG: number | null;
  flyBallRate: number | null;
  avgLaunchAngle: number | null;
  // Pitcher HR context
  pitcherName: string;
  pitcherHand: "L" | "R";
  pitcherERA: number;
  pitcherHrP9Overall: number | null;
  pitcherHrP9VsHand: number | null;   // HR/9 vs this batter's hand
  pitcherSeasonHR: number;
}

/** All batters today ranked by HR score — for Best Sluggers analytics table */
export function buildBestSluggersRows(snapshot: DailySnapshot): BestSluggerRow[] {
  const rows: BestSluggerRow[] = [];

  for (const game of snapshot.games) {
    const pairs: [MLBBatter[], MLBPitcher | undefined][] = [
      [game.awayLineup, game.homeStartingPitcher],
      [game.homeLineup, game.awayStartingPitcher],
    ];
    for (const [lineup, pitcher] of pairs) {
      for (const batter of lineup) {
        const hrScore = calcHRScore(batter, pitcher, game.parkFactor);
        const l3ip = pitcher?.last3InningsPitched ?? 0;
        const l3hr = pitcher?.last3HRAllowed ?? 0;
        const szHR = pitcher?.seasonHRAllowed ?? 0;
        const hrP9Overall = l3ip > 0 ? (l3hr / l3ip) * 9 : (szHR > 0 ? szHR / 30 : null);
        const hrP9VsHand =
          batter.hand === "L" ? pitcher?.hrPer9VsLeft :
          batter.hand === "R" ? pitcher?.hrPer9VsRight :
          undefined;

        rows.push({
          id: batter.id,
          name: batter.name,
          team: batter.teamAbbreviation ?? "",
          gamePk: game.gamePk,
          gameTime: formatGameTime(game.gameDate),
          gameTimeIso: game.gameDate,
          hrScore,
          slot: batter.battingOrder ?? 0,
          barrelPct: batter.barrelPct ?? null,
          hardHitPct: batter.hardHitPct ?? null,
          xwOBA: batter.xwOBA ?? null,
          xSLG: batter.xSLG ?? null,
          flyBallRate: batter.flyBallRate ?? null,
          avgLaunchAngle: batter.avgLaunchAngle ?? null,
          pitcherName: pitcher?.name ?? "TBD",
          pitcherHand: pitcher?.hand ?? "R",
          pitcherERA: pitcher?.seasonERA ?? 0,
          pitcherHrP9Overall: hrP9Overall,
          pitcherHrP9VsHand: hrP9VsHand ?? null,
          pitcherSeasonHR: pitcher?.seasonHRAllowed ?? 0,
        });
      }
    }
  }

  return rows.sort((a, b) => b.hrScore - a.hrScore).slice(0, 50);
}

/** Top 10 hottest pitchers by ERA + K rate */
export function getHottestPitchers(snapshot: DailySnapshot): RankedPitcher[] {
  const pitchers: RankedPitcher[] = [];

  for (const game of snapshot.games) {
    if (game.awayStartingPitcher) {
      const p = game.awayStartingPitcher;
      const kPerGame = p.last3Strikeouts / Math.max(p.last3Starts.length, 1);
      pitchers.push({ ...p, teamAbbreviation: game.awayTeam.abbreviation, kPerGame, score: 0 });
    }
    if (game.homeStartingPitcher) {
      const p = game.homeStartingPitcher;
      const kPerGame = p.last3Strikeouts / Math.max(p.last3Starts.length, 1);
      pitchers.push({ ...p, teamAbbreviation: game.homeTeam.abbreviation, kPerGame, score: 0 });
    }
  }

  // Normalise ERA across pool (lower = better → negate)
  const eraValues = pitchers.map((p) => p.last3ERA).filter((e) => e > 0);
  const maxERA = Math.max(...eraValues, 1);

  return pitchers
    .map((p) => ({
      ...p,
      score:
        (1 - p.last3ERA / maxERA) * 0.55 +
        (p.kPerGame / 12) * 0.45, // 12 K/game as ceiling
    }))
    .filter((p) => p.last3Starts.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}
