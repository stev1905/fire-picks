import type { DailySnapshot, MLBBatter, MLBPitcher } from "@/types/mlb";

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

/** Top 10 hottest pitchers by ERA + K rate */
export function getHottestPitchers(snapshot: DailySnapshot): RankedPitcher[] {
  const pitchers: RankedPitcher[] = [];

  for (const game of snapshot.games) {
    if (game.awayStartingPitcher) {
      const p = game.awayStartingPitcher;
      const ip = p.last3InningsPitched || 1;
      const kPerGame = p.last3Strikeouts / Math.max(p.last3Starts.length, 1);
      pitchers.push({
        ...p,
        teamAbbreviation: game.awayTeam.abbreviation,
        kPerGame,
        score: 0,
      });
    }
    if (game.homeStartingPitcher) {
      const p = game.homeStartingPitcher;
      const ip = p.last3InningsPitched || 1;
      const kPerGame = p.last3Strikeouts / Math.max(p.last3Starts.length, 1);
      pitchers.push({
        ...p,
        teamAbbreviation: game.homeTeam.abbreviation,
        kPerGame,
        score: 0,
      });
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
