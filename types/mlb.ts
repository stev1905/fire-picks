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
  venueId: number;
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
  seasonHRAllowed: number;
  last3HRAllowed: number;
  // Pitch arsenal (Baseball Savant)
  fastballPct?: number;    // % fastballs thrown (FF + SI + FC)
  breakingPct?: number;    // % breaking balls (SL + CU + KC + CS)
  offspeedPct?: number;    // % offspeed (CH + FS)
  zonePct?: number;        // % pitches thrown in the strike zone
  chaseInducePct?: number; // opponent o-swing% outside zone
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
  // Statcast (Baseball Savant)
  xBA?: number;
  barrelPct?: number;
  hardHitPct?: number;
  // Plate discipline (Baseball Savant)
  chasePct?: number;       // o-swing% — how often batter swings at pitches outside zone
  baVsFastball?: number;   // batting avg vs fastballs
  baVsBreaking?: number;   // batting avg vs breaking balls
  whiffVsBreaking?: number; // whiff rate vs breaking balls
  // Career head-to-head vs opposing pitcher
  vsCurrentPitcher?: {
    atBats: number;
    hits: number;
    avg: number;
    hr: number;
  };
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
