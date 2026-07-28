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

/** One slot in a pitcher's zone frequency profile (top 5 zones by pitch count) */
export interface PitcherZoneSlot {
  zone: number;       // 1-9 = strike zone, 11-14 = chase zones
  pct: number;        // % of all season pitches thrown to this zone
  xBA: number | null; // avg xBA against when pitcher throws to this zone (null if no contact)
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
  last9HitsAllowed: number;
  // Pitch arsenal (Baseball Savant statcast_search)
  fastballPct?: number;    // % fastballs thrown (FF + SI + FC)
  breakingPct?: number;    // % breaking balls (SL + CU + KC + CS)
  offspeedPct?: number;    // % offspeed (CH + FS)
  zonePct?: number;
  chaseInducePct?: number;
  // Pitcher contact stats allowed (derived from statcast_search)
  hardHitAllowedPct?: number;
  barrelAllowedPct?: number;
  xBAAgainst?: number;
  whiffPct?: number;
  kPct?: number;
  // Pitcher splits — batting avg allowed vs left/right-handed batters (season)
  baaVsLeft?: number;
  baaVsRight?: number;
  // HR rate allowed per 9 innings vs each hand (from MLB splits API)
  hrPer9VsLeft?: number;
  hrPer9VsRight?: number;
  // Per-zone pitch location profile (top 5 zones by frequency)
  zoneProfile?: PitcherZoneSlot[];
}

export interface PitcherStart {
  date: string;
  era: number;
  hitsAllowed: number;
  inningsPitched: number;
  strikeouts: number;
  opponent: string;
}

/** One zone slot in a batter's zone contact profile (sorted by xBA descending) */
export interface BatterZoneSlot {
  zone: number;    // 1-9 = strike zone, 11-14 = chase zones
  xBA: number;     // batter's avg xBA on contact in this zone
  pitches: number; // total pitches seen in this zone (season)
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
  // Hit consistency rates (hits in X games / X)
  hitRate10?: number;
  hitRate20?: number;
  hitRate30?: number;
  hitRate40?: number;
  gameLogCount?: number; // number of game log entries available (up to 40)
  // Statcast (Baseball Savant)
  xBA?: number;
  xwOBA?: number;          // expected weighted on-base average (est_woba) — best composite power metric
  xSLG?: number;           // expected SLG (est_slg) — "expected damage"
  barrelPct?: number;
  hardHitPct?: number;
  avgLaunchAngle?: number; // avg launch angle — proxy for fly ball tendency
  flyBallRate?: number;    // (fly balls + line drives) / total batted balls
  // Plate discipline (Baseball Savant)
  chasePct?: number;       // o-swing% — how often batter swings at pitches outside zone
  baVsFastball?: number;   // batting avg vs fastballs
  baVsBreaking?: number;   // batting avg vs breaking balls
  whiffVsBreaking?: number; // whiff rate vs breaking balls
  // Home / Away splits
  homeAVG?: number;
  awayAVG?: number;
  homeSLG?: number;
  awaySLG?: number;
  isHome?: boolean;  // true = batter's team is home in today's game
  // Per-zone contact profile (sorted by xBA desc — hot zones first)
  zoneProfile?: BatterZoneSlot[];
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
