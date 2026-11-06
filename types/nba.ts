// NBA daily snapshot — built by lib/nbaApi.ts, stored in Supabase `snapshots`
// under `nba-{YYYY-MM-DD}` (ET date). Per-game play-by-play extracts are cached
// under `nba-pbp-{seasonYear}` so each sync only fetches newly completed games.
// Team ids / abbreviations are ESPN's (GS, NO, NY, SA, UTAH, WSH).

// "First basket" = first made FIELD GOAL (free throws don't count), matching
// how the major books settle first-basket / first-field-goal markets.

export interface NBATeamRef {
  id: string;
  abbr: string;
  name: string;
  record?: string;
}

export interface NBAGame {
  id: string;
  startTime: string;  // ISO UTC
  status: string;     // ESPN status name, e.g. STATUS_SCHEDULED / STATUS_IN_PROGRESS / STATUS_FINAL
  home: NBATeamRef;
  away: NBATeamRef;
  // Starters per team: "confirmed" once the box score lists them (game has tipped),
  // otherwise "projected" from the last game's lineup minus players ruled out
  lineup: Record<string, "confirmed" | "projected">;
}

export interface NBAFirstBasketRow {
  id: string;           // ESPN athlete id
  name: string;
  pos: string;
  teamId: string;
  team: string;
  opponent: string;
  isHome: boolean;
  gameId: string;
  startTime: string;
  lineup: "confirmed" | "projected";
  injuryStatus: string | null;   // e.g. "Day-To-Day" — Out players are never listed as starters
  isJumper: boolean;             // projected to take the opening tip for his team

  gamesPlayed: number;

  // Opening tip — his TEAM's record this season (any jumper)
  teamTipsWon: number;
  teamTipsGames: number;
  // ...and his own, as a jumper (drives the model's tip matchup)
  tipsTaken: number;
  tipsWon: number;

  // Counts over games played
  firstGameShots: number;   // took the first FGA of the game
  firstTeamShots: number;   // took his team's first FGA
  firstGameBaskets: number; // made the first FG of the game
  firstTeamBaskets: number; // made his team's first FG
  firstBasketsL5: number;   // first FG of the game in his last 5 games played
  l5Games: number;          // = min(5, gamesPlayed)

  // Model
  pTeamFirst: number;   // P(his team makes the first FG of the game)
  teamShare: number;    // P(he makes his team's first FG)
  prob: number;         // pTeamFirst × teamShare
  score: number;        // 0–100 scale of prob
  fairOdds: string;     // no-vig American odds from prob
}

export interface NBADailySnapshot {
  schemaVersion: number;   // see NBA_SCHEMA_VERSION in lib/nbaApi.ts
  date: string;            // YYYY-MM-DD (ET)
  season: number;          // ESPN season year (2027 = 2026-27)
  syncedAt: string;
  gamesOfData: number;     // completed games feeding the model
  // League rate at which the team that wins the opening tip makes the first FG
  tipWinnerScoresFirst: number;
  games: NBAGame[];
  players: NBAFirstBasketRow[];
  props: NBAPropRow[];     // DraftKings milestone props in the Hot / Super Safe odds windows
}

// ── Player props ─────────────────────────────────────────────────────────────

export type PropStat = "PTS" | "REB" | "AST" | "STL" | "BLK";

export interface NBAPropRow {
  key: string;            // athleteId-stat-threshold
  category: "hot" | "safe";
  athleteId: string;
  name: string;
  team: string;
  opponent: string;
  isHome: boolean;
  gameId: string;
  startTime: string;
  injuryStatus: string | null;   // GTD etc.; Out players are dropped

  stat: PropStat;
  threshold: number;      // milestone N+ (e.g. 10 = "10+ points")
  odds: number;           // DraftKings American odds
  implied: number;        // book's implied probability (includes vig)

  // Hit history, newest first (last 20 games, reaching into last season if needed)
  last: number[];         // stat values, up to 20
  prevSeasonGames: number;// how many of `last` came from last season
  hitsL5: number;  nL5: number;
  hitsL10: number; nL10: number;
  hitsL20: number; nL20: number;
  streak: number;         // consecutive hits, most recent game backwards
  avgL10: number;
  minL10: number;         // average minutes, last 10

  modelProb: number;      // blended, shrunk hit rate
  edge: number;           // modelProb − implied
  hotScore: number;       // ranking for Hot Props (edge + streak)
  reasons: string[];
}

export interface NBAGameLogEntry {
  eventId: string;
  date: string;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
}

// Last season's logs never change — cached under `nba-prevlogs-{season}`
export interface NBAPrevLogsCache {
  season: number;                              // the CURRENT season these were fetched for
  logs: Record<string, NBAGameLogEntry[]>;     // athleteId → up to 20, newest first ([] = none)
}

// ── Cache (internal) ─────────────────────────────────────────────────────────

export interface NBAGamePlayer {
  id: string;
  name: string;
  pos: string;
  teamId: string;
  starter: boolean;
  fga: number;
}

export interface NBAGameExtract {
  id: string;
  date: string;             // ISO start time
  homeId: string;
  awayId: string;
  tip: { jumpers: string[]; winnerTeamId: string } | null;   // jumpers = [athleteId, athleteId]
  firstShot: { playerId: string; teamId: string } | null;    // first FGA of the game
  firstFG: { playerId: string; teamId: string } | null;      // first made FG of the game
  teamFirstShot: Record<string, string>;                     // teamId → athleteId
  teamFirstFG: Record<string, string>;                       // teamId → athleteId
  players: NBAGamePlayer[];                                  // everyone who logged minutes
}

export interface NBAPbpCache {
  season: number;
  games: Record<string, NBAGameExtract>;
}
