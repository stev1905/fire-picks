export interface NHLDailySnapshot {
  date: string;
  syncedAt: string;
  games: NHLGame[];
}

export interface NHLGame {
  id: number;
  startTimeUTC: string;
  homeTeam: NHLTeam;
  awayTeam: NHLTeam;
  venue: string;
  homeRoster: NHLGameRoster;
  awayRoster: NHLGameRoster;
}

export interface NHLTeam {
  id: number;
  name: string;
  abbreviation: string;
  ppPct: number;   // e.g. 21.4 (as percentage)
  pkPct: number;   // e.g. 82.3 (as percentage)
}

export interface NHLGameRoster {
  forwards: NHLSkater[];
  defensemen: NHLSkater[];
  goalies: NHLGoalie[];
}

export interface NHLSkater {
  id: number;
  name: string;
  position: string;       // C, L, R, D
  sweaterNumber: number;
  avgToi: string;         // "18:30"
  seasonGP: number;
  seasonGoals: number;
  seasonAssists: number;
  seasonPoints: number;
  seasonSOG: number;
  last3Goals: number;
  last6Goals: number;
  last10Goals: number;
  last3SOG: number;
  last6SOG: number;
  last10SOG: number;
  last3Points: number;
  last6Points: number;
  last10Points: number;
  goalStreak: number;     // consecutive games with ≥1 goal (most recent)
  recentGames: SkaterGameLog[];
}

export interface SkaterGameLog {
  date: string;
  opponent: string;
  goals: number;
  assists: number;
  points: number;
  sog: number;
  toi: string;
}

export interface NHLGoalie {
  id: number;
  name: string;
  sweaterNumber: number;
  seasonGP: number;
  seasonWins: number;
  seasonLosses: number;
  seasonOtLosses: number;
  seasonSavePct: number;  // 0.0–1.0
  seasonGAA: number;
  last3SavePct: number;
  last3GAA: number;
  recentGames: GoalieGameLog[];
}

export interface GoalieGameLog {
  date: string;
  opponent: string;
  decision: string;       // W, L, O, ND
  savePct: number;
  shotsAgainst: number;
  saves: number;
  toi: string;
}
