// NFL weekly snapshot — built by lib/nflApi.ts, stored in Supabase `snapshots`
// under keys `nfl-{season}-w{week}` and `nfl-latest`.
// Team abbreviations follow nflverse (LA = Rams, WAS = Commanders).

export type SkillPos = "QB" | "RB" | "WR" | "TE";
export type WRRole = "SLOT" | "WIDE";

// Defense-vs-position buckets
export type DvpCategory =
  | "WR_SLOT_REC"
  | "WR_WIDE_REC"
  | "WR_REC"
  | "TE_REC"
  | "RB_REC"
  | "RB_RUSH"
  | "QB_RUSH"
  | "QB_PASS";

export interface NFLDailySnapshot {
  season: number;
  week: number;
  syncedAt: string;
  weeksOfData: number;          // completed weeks feeding the model
  games: NFLGame[];
  players: NFLPlayerMatchup[];  // skill players on teams playing this week
  defense: DefenseVsPosition[]; // all 32 defenses
  leagueAvg: Record<DvpCategory, DvpLine>;
  injuries: NFLInjury[];
  news: NFLNewsItem[];
}

export interface NFLTeamRef {
  abbr: string;       // nflverse abbreviation
  espnId: string;
  name: string;
  record?: string;
}

export interface NFLGame {
  id: string;         // ESPN event id
  startTimeUTC: string;
  status: string;     // STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL
  home: NFLTeamRef;
  away: NFLTeamRef;
  venue: string;
  city: string;
  indoor: boolean;
  spread: number | null;     // home line (negative = home favored)
  total: number | null;
  homeImplied: number | null;
  awayImplied: number | null;
  weather: NFLWeather;
  lineInjuries: {            // starters on the lines who are Out/Doubtful/Questionable
    home: { ol: NFLInjury[]; dl: NFLInjury[]; lb: NFLInjury[]; db: NFLInjury[] };
    away: { ol: NFLInjury[]; dl: NFLInjury[]; lb: NFLInjury[]; db: NFLInjury[] };
  };
  notes: string[];           // auto-generated matchup notes
}

export interface NFLWeather {
  indoor: boolean;
  tempF?: number;
  windMph?: number;
  gustMph?: number;
  precipChance?: number;
  condition?: string;
  icon?: string;
  impact: "none" | "minor" | "moderate" | "major";
  passMult: number;          // multiplier applied to passing/receiving projections
  rushMult: number;
  notes: string[];
}

export interface DvpLine {
  games: number;
  yardsPg: number;
  tdsPg: number;
  volumePg: number;          // targets/g for receiving, carries/g for rushing, attempts/g for pass
  receptionsPg: number;      // receiving only (0 otherwise)
}

export interface DvpCell extends DvpLine {
  yardsRank: number;         // 1 = stingiest, 32 = most generous
  tdsRank: number;
  yardsVsAvg: number;        // e.g. 0.25 = allows 25% more than league avg
  tdsVsAvg: number;
}

export interface DefenseVsPosition {
  team: string;
  name: string;
  opponentThisWeek: string | null;
  cells: Record<DvpCategory, DvpCell>;
}

export interface NFLPlayerUsage {
  games: number;
  targetsPg: number;
  receptionsPg: number;
  recYdsPg: number;
  carriesPg: number;
  rushYdsPg: number;
  passYdsPg: number;
  recTds: number;
  rushTds: number;
  passTds: number;
  targetShare: number;       // share of team targets in games played
  carryShare: number;
  rzTargets: number;         // inside the 20
  rzCarries: number;
  i10Carries: number;        // inside the 10
  rzTargetShare: number;
  rzCarryShare: number;
  teamRzTargets: number;     // team red-zone targets in games played
  teamRzCarries: number;     // team red-zone carries (inside-10 weighted double)
  adot: number | null;
  middleShare: number | null; // share of targets to middle of field
}

export interface TDBreakdown {
  teamImplied: number;
  teamTDs: number;           // expected offensive TDs for the team
  passTdShare: number;       // share of team TDs through the air
  rushLambda: number;        // expected rushing TDs for this player
  recLambda: number;         // expected receiving TDs
  defRushFactor: number;
  defRecFactor: number;
  adjustments: string[];     // human-readable modifiers applied
}

export interface NFLPlayerMatchup {
  id: string;                // gsis id
  espnId: string | null;
  name: string;
  team: string;
  opponent: string;
  gameId: string;
  isHome: boolean;
  position: SkillPos;
  wrRole: WRRole | null;
  wrRoleSignals: string | null; // why we classified slot/wide
  headshot: string | null;
  depthLabel: string | null; // e.g. "WR3", "RB1"
  injuryStatus: string | null;  // Out / Doubtful / Questionable / IR
  injuryNote: string | null;
  usage: NFLPlayerUsage;

  // Primary matchup: the defensive bucket that best describes this player's role
  primaryCategory: DvpCategory;
  secondaryCategory: DvpCategory | null;
  matchupEdge: number;       // shrunk % vs league avg for primary category (0.2 = +20%)
  matchupScore: number;      // 0–100, 50 = neutral
  defRankPrimary: number;    // opponent rank in primary category (32 = softest)
  projYards: number;         // primary-category yards projection
  projRecYds: number;
  projRushYds: number;

  tdProb: number;            // 0–1 anytime TD probability
  tdScore: number;           // 0–100
  tdFairOdds: string;        // American odds, e.g. "+145"
  td: TDBreakdown;

  flags: string[];           // short badges: "OL 2 out", "Wind 18mph", "CB1 out"
}

export interface NFLInjury {
  espnId: string;
  name: string;
  team: string;
  position: string;          // raw position abbreviation (LT, CB, WR…)
  unit: "QB" | "RB" | "WR" | "TE" | "OL" | "DL" | "LB" | "DB" | "ST" | "OTHER";
  status: string;            // Out, Doubtful, Questionable, Injured Reserve, …
  injury: string | null;     // body part
  returnDate: string | null;
  isStarter: boolean;
  depthSlot: string | null;  // e.g. "LT", "RCB", "WR1"
  shortComment: string | null;
  longComment: string | null;
  reporter: string | null;   // parsed "X of Y reports" attribution
  updated: string;
}

export interface NFLNewsItem {
  team: string;
  headline: string;
  description: string;
  byline: string | null;
  published: string;
  url: string | null;
  isInjuryRelated: boolean;
}
