export interface MLBGame {
  gamePk: number;
  gameDate: string;
  status: string;
  homeTeam: MLBTeam;
  awayTeam: MLBTeam;
  homeStartingPitcher?: MLBPitcher;
  awayStartingPitcher?: MLBPitcher;
  homeLineup: MLBBatter[];
  awayLineup: MLBBatter[];
  venue: string;
  parkFactor: number;
}

export interface MLBTeam {
  id: number;
  name: string;
  abbreviation: string;
  logo?: string;
}

export interface MLBPitcher {
  id: number;
  name: string;
  hand: "L" | "R";
  seasonERA: number;
  last3ERA: number;
  last6ERA: number;
  last3HitsAllowed: number;
  last6HitsAllowed: number;
  last3Strikeouts: number;
  last3InningsPitched: number;
  last3Starts: PitcherStart[];
  teamAbbreviation?: string;
}

export interface PitcherStart {
  date: string;
  era: number;
  hitsAllowed: number;
  inningsPitched: number;
  strikeouts: number;
  opponent: string;
}

export interface MLBBatter {
  id: number;
  name: string;
  position: string;
  battingOrder: number;
  hand: "L" | "R" | "S"; // S = switch
  teamAbbreviation?: string;
  seasonAVG: number;
  seasonSLG: number;
  seasonHR: number;
  // Rolling windows
  last3AVG: number;
  last6AVG: number;
  last10AVG: number;
  last3SLG: number;
  last6SLG: number;
  last10SLG: number;
  last3HR: number;
  last6HR: number;
  last10HR: number;
  // Streak
  hittingStreak: number;
  // Splits
  avgVsLeft: number;
  avgVsRight: number;
  slgVsLeft: number;
  slgVsRight: number;
  // Game logs for charts
  last10Games: BatterGameLog[];
}

export interface BatterGameLog {
  date: string;
  opponent: string;
  atBats: number;
  hits: number;
  hr: number;
  avg: number;
  slg: number;
}

export interface DailySnapshot {
  date: string;
  syncedAt: string;
  games: MLBGame[];
}

export interface MatchupRating {
  label: string;
  rating: "favorable" | "unfavorable" | "neutral";
  reason: string;
}
