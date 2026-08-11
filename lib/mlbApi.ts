import type {
  MLBGame,
  MLBTeam,
  MLBBatter,
  MLBPitcher,
  BatterGameLog,
  PitcherStart,
  PitcherZoneSlot,
  BatterZoneSlot,
  PitchArsenalEntry,
  DailySnapshot,
} from "@/types/mlb";
import { getParkFactor } from "./parkFactors";

const BASE = "https://statsapi.mlb.com/api/v1";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`MLB API error: ${path} → ${res.status}`);
  return res.json();
}

// ─── Baseball Savant (Statcast) ────────────────────────────────────────────────

type StatcastEntry = {
  xBA: number;
  xwOBA: number;
  xSLG: number;
  barrelPct: number;
  hardHitPct: number;
  avgLaunchAngle: number;
  flyBallRate: number;
};

export async function fetchStatcastData(season: number): Promise<Map<number, StatcastEntry>> {
  const map = new Map<number, StatcastEntry>();
  const empty = (): StatcastEntry => ({ xBA: 0, xwOBA: 0, xSLG: 0, barrelPct: 0, hardHitPct: 0, avgLaunchAngle: 0, flyBallRate: 0 });
  try {
    const [xbaRes, statcastRes] = await Promise.allSettled([
      fetch(
        `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${season}&position=&team=&min=1&csv=true`,
        { cache: "no-store" }
      ),
      fetch(
        `https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${season}&position=&team=&min=1&csv=true`,
        { cache: "no-store" }
      ),
    ]);

    const parseCol = (cols: string[], idx: number) =>
      idx >= 0 ? cols[idx]?.replace(/"/g, "").trim() ?? "" : "";

    if (xbaRes.status === "fulfilled" && xbaRes.value.ok) {
      const text = await xbaRes.value.text();
      const lines = text.trim().split("\n");
      const header = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
      const idIdx    = header.indexOf("player_id");
      const xbaIdx   = header.indexOf("est_ba") >= 0 ? header.indexOf("est_ba") : header.indexOf("xba");
      const xwobaIdx = header.indexOf("est_woba");
      const xslgIdx  = header.indexOf("est_slg");
      if (idIdx >= 0 && xbaIdx >= 0) {
        for (const line of lines.slice(1)) {
          const cols = line.split(",");
          const id   = parseInt(parseCol(cols, idIdx));
          const xBA  = parseFloat(parseCol(cols, xbaIdx));
          if (isNaN(id) || isNaN(xBA)) continue;
          const prev = map.get(id) ?? empty();
          map.set(id, {
            ...prev,
            xBA,
            xwOBA: xwobaIdx >= 0 ? (parseFloat(parseCol(cols, xwobaIdx)) || prev.xwOBA) : prev.xwOBA,
            xSLG:  xslgIdx  >= 0 ? (parseFloat(parseCol(cols, xslgIdx))  || prev.xSLG)  : prev.xSLG,
          });
        }
      }
    }

    if (statcastRes.status === "fulfilled" && statcastRes.value.ok) {
      const text = await statcastRes.value.text();
      const lines = text.trim().split("\n");
      const header = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
      const idIdx    = header.indexOf("player_id");
      const brlIdx   = header.indexOf("brl_percent") >= 0 ? header.indexOf("brl_percent") : header.indexOf("barrel_batted_rate");
      const evIdx    = header.indexOf("ev95percent") >= 0 ? header.indexOf("ev95percent") : header.indexOf("hard_hit_percent");
      const laIdx    = header.indexOf("avg_hit_angle");
      const fbldIdx  = header.indexOf("fbld");
      const gbIdx    = header.indexOf("gb");
      if (idIdx >= 0) {
        for (const line of lines.slice(1)) {
          const cols = line.split(",");
          const id = parseInt(parseCol(cols, idIdx));
          if (isNaN(id)) continue;
          const barrelPct      = brlIdx  >= 0 ? parseFloat(parseCol(cols, brlIdx))  : NaN;
          const hardHitPct     = evIdx   >= 0 ? parseFloat(parseCol(cols, evIdx))   : NaN;
          const avgLaunchAngle = laIdx   >= 0 ? parseFloat(parseCol(cols, laIdx))   : NaN;
          const fbld           = fbldIdx >= 0 ? parseFloat(parseCol(cols, fbldIdx)) : NaN;
          const gb             = gbIdx   >= 0 ? parseFloat(parseCol(cols, gbIdx))   : NaN;
          const flyBallRate    = !isNaN(fbld) && !isNaN(gb) && (fbld + gb) > 0 ? fbld / (fbld + gb) : NaN;
          const prev = map.get(id) ?? empty();
          map.set(id, {
            ...prev,
            barrelPct:      isNaN(barrelPct)      ? prev.barrelPct      : barrelPct,
            hardHitPct:     isNaN(hardHitPct)     ? prev.hardHitPct     : hardHitPct,
            avgLaunchAngle: isNaN(avgLaunchAngle) ? prev.avgLaunchAngle : avgLaunchAngle,
            flyBallRate:    isNaN(flyBallRate)     ? prev.flyBallRate    : flyBallRate,
          });
        }
      }
    }
  } catch {
    // Statcast is optional — return whatever we have
  }
  return map;
}

// ─── Pitcher Zone Stats (Baseball Savant statcast_search) ─────────────────────
// Fetches per-pitch season data for a single pitcher and aggregates:
// pitch mix %, zone profile (top 5 zones by frequency + xBA against per zone),
// whiff%, hard-hit%, barrel%, overall xBA against, K%.

const FASTBALL_TYPES  = new Set(["FF", "SI", "FC"]);
const BREAKING_TYPES  = new Set(["SL", "CU", "KC", "CS", "SV", "ST"]);
const OFFSPEED_TYPES  = new Set(["CH", "FS", "FO", "KN"]);

const SAVANT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": "https://baseballsavant.mlb.com/",
};

// Proper CSV line parser — handles quoted fields containing commas (e.g. "Alcantara, Sandy")
function splitCSVLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

type PitcherZoneStatsResult = {
  fastballPct: number;
  breakingPct: number;
  offspeedPct: number;
  hardHitAllowedPct: number;
  barrelAllowedPct: number;
  xBAAgainst: number;
  whiffPct: number;
  kPct: number;
  zoneProfile: PitcherZoneSlot[];
};

export async function fetchPitcherZoneStats(
  pitcherId: number,
  season: number,
): Promise<Partial<PitcherZoneStatsResult>> {
  try {
    const url =
      `https://baseballsavant.mlb.com/statcast_search/csv?all=true` +
      `&player_type=pitcher&pitchers_lookup%5B%5D=${pitcherId}` +
      `&year=${season}&type=details`;

    const res = await fetch(url, { cache: "no-store", headers: SAVANT_HEADERS });
    if (!res.ok) return {};

    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return {};

    const header = splitCSVLine(lines[0]);
    const idx = (name: string) => header.indexOf(name);

    const ptypeIdx  = idx("pitch_type");
    const zoneIdx   = idx("zone");
    const descIdx   = idx("description");
    const xbaIdx    = idx("estimated_ba_using_speedangle");
    const evIdx     = idx("launch_speed");
    const lsaIdx    = idx("launch_speed_angle");
    const eventsIdx = idx("events");
    const abNumIdx  = idx("at_bat_number");
    const gameDateIdx = idx("game_date");

    if (ptypeIdx < 0 || zoneIdx < 0) return {};

    const pitchTypeCount: Record<string, number> = {};
    const zoneCount:      Record<number, number> = {};
    const zoneXBASum:     Record<number, number> = {};
    const zoneXBACount:   Record<number, number> = {};
    let totalPitches = 0, totalSwings = 0, totalWhiffs = 0;
    let ballsInPlay = 0, hardHits = 0, barrels = 0;
    let xBATotal = 0, xBACount = 0;
    const atBatNums = new Set<string>();
    const strikeoutABs = new Set<string>();

    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const cols = splitCSVLine(line);

      const ptype  = cols[ptypeIdx]?.trim().toUpperCase() ?? "";
      const zone   = parseInt(cols[zoneIdx]  ?? "");
      const desc   = cols[descIdx]?.trim()   ?? "";
      const xbaStr = cols[xbaIdx]?.trim()    ?? "";
      const evStr  = cols[evIdx]?.trim()     ?? "";
      const lsaStr = cols[lsaIdx]?.trim()    ?? "";
      const events = cols[eventsIdx]?.trim() ?? "";
      const abNum  = cols[abNumIdx]?.trim()  ?? "";
      const gameDate = cols[gameDateIdx]?.trim() ?? "";

      if (!ptype) continue;
      totalPitches++;

      pitchTypeCount[ptype] = (pitchTypeCount[ptype] ?? 0) + 1;

      if (!isNaN(zone) && zone > 0) {
        zoneCount[zone] = (zoneCount[zone] ?? 0) + 1;
        const xba = parseFloat(xbaStr);
        if (!isNaN(xba)) {
          zoneXBASum[zone]   = (zoneXBASum[zone]   ?? 0) + xba;
          zoneXBACount[zone] = (zoneXBACount[zone] ?? 0) + 1;
          xBATotal += xba;
          xBACount++;
        }
      }

      const isSwing = ["swinging_strike","swinging_strike_blocked","foul","foul_bunt","foul_tip","hit_into_play"].includes(desc);
      const isWhiff = ["swinging_strike","swinging_strike_blocked"].includes(desc);
      if (isSwing) totalSwings++;
      if (isWhiff) totalWhiffs++;

      if (desc === "hit_into_play") {
        ballsInPlay++;
        const ev = parseFloat(evStr);
        if (!isNaN(ev) && ev >= 95) hardHits++;
        if (parseInt(lsaStr) === 6) barrels++;
      }

      // at_bat_number resets to 1 at the start of every game, so it must be
      // paired with game_date before going into a season-spanning Set —
      // otherwise at-bat #1 from every start collapses into one entry,
      // undercounting the denominator and badly inflating K%.
      if (abNum && gameDate) {
        const abKey = `${gameDate}:${abNum}`;
        atBatNums.add(abKey);
        if (events === "strikeout") strikeoutABs.add(abKey);
      }
    }

    if (totalPitches === 0) return {};

    const sumTypes = (set: Set<string>) =>
      Object.entries(pitchTypeCount)
        .filter(([t]) => set.has(t))
        .reduce((s, [, c]) => s + c, 0);

    // Keep every zone the pitcher actually threw to (at most 9 in-zone + 4 chase
    // zones exist), sorted most-frequent first. Previously this was capped to
    // the top 5 by frequency, which silently dropped zones a pitcher gets hurt
    // in but doesn't throw to often — exactly the kind of vulnerable-but-rare
    // location a zone-fit check needs to see.
    const zoneProfile: PitcherZoneSlot[] = Object.entries(zoneCount)
      .map(([z, count]) => {
        const zone = parseInt(z);
        const n = zoneXBACount[zone] ?? 0;
        return {
          zone,
          pct:     (count / totalPitches) * 100,
          pitches: count,
          xBA:     n > 0 ? zoneXBASum[zone] / n : null,
        };
      })
      .sort((a, b) => b.pct - a.pct);

    return {
      fastballPct:      (sumTypes(FASTBALL_TYPES) / totalPitches) * 100,
      breakingPct:      (sumTypes(BREAKING_TYPES) / totalPitches) * 100,
      offspeedPct:      (sumTypes(OFFSPEED_TYPES) / totalPitches) * 100,
      whiffPct:         totalSwings > 0 ? (totalWhiffs / totalSwings) * 100 : 0,
      hardHitAllowedPct: ballsInPlay > 0 ? (hardHits / ballsInPlay) * 100 : 0,
      barrelAllowedPct:  ballsInPlay > 0 ? (barrels  / ballsInPlay) * 100 : 0,
      xBAAgainst:        xBACount   > 0 ? xBATotal / xBACount : 0,
      kPct:              atBatNums.size > 0 ? (strikeoutABs.size / atBatNums.size) * 100 : 0,
      zoneProfile,
    };
  } catch {
    return {};
  }
}

// ─── Batter Zone Profiles (Baseball Savant statcast_search) ───────────────────
// Batch-fetches all batters in a game in one HTTP request and returns a per-batter
// map of zone contact profiles (xBA by zone, sorted hot→cold).

export async function fetchBatterZoneProfiles(
  batterIds: number[],
  season: number,
): Promise<Map<number, BatterZoneSlot[]>> {
  const map = new Map<number, BatterZoneSlot[]>();
  if (batterIds.length === 0) return map;
  try {
    const idParams = batterIds.map((id) => `batters_lookup%5B%5D=${id}`).join("&");
    const url =
      `https://baseballsavant.mlb.com/statcast_search/csv?all=true` +
      `&player_type=batter&${idParams}&year=${season}&type=details`;

    const res = await fetch(url, { cache: "no-store", headers: SAVANT_HEADERS });
    if (!res.ok) return map;

    const text  = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return map;

    const header    = splitCSVLine(lines[0]);
    const batterIdx = header.indexOf("batter");
    const zoneIdx   = header.indexOf("zone");
    const xbaIdx    = header.indexOf("estimated_ba_using_speedangle");
    if (batterIdx < 0 || zoneIdx < 0) return map;

    // Accumulate xBA per (batter, zone)
    type Acc = { xbaSum: number; contacts: number; total: number };
    const acc = new Map<string, Acc>();

    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const cols     = splitCSVLine(line);
      const batterId = parseInt(cols[batterIdx] ?? "");
      const zone     = parseInt(cols[zoneIdx]   ?? "");
      if (isNaN(batterId) || isNaN(zone) || zone < 1) continue;

      const key   = `${batterId}:${zone}`;
      const entry = acc.get(key) ?? { xbaSum: 0, contacts: 0, total: 0 };
      entry.total++;
      const xba = parseFloat(cols[xbaIdx]?.trim() ?? "");
      if (!isNaN(xba)) { entry.xbaSum += xba; entry.contacts++; }
      acc.set(key, entry);
    }

    // Build per-batter sorted zone profile (min 3 contacts for reliable xBA)
    const byBatter = new Map<number, BatterZoneSlot[]>();
    for (const [key, { xbaSum, contacts, total }] of acc.entries()) {
      if (contacts < 3) continue;
      const [bidStr, zStr] = key.split(":");
      const batterId = parseInt(bidStr);
      const zone     = parseInt(zStr);
      if (!byBatter.has(batterId)) byBatter.set(batterId, []);
      byBatter.get(batterId)!.push({ zone, xBA: xbaSum / contacts, pitches: total });
    }

    for (const [id, slots] of byBatter.entries()) {
      map.set(id, slots.sort((a, b) => b.xBA - a.xBA));
    }
  } catch {
    // optional — return whatever we have
  }
  return map;
}

// ─── Pitch Arsenal (Baseball Savant pitch-arsenal-stats) ──────────────────────
// One row per exact pitch type per player (FF, SI, FC, SL, ST, CU, CH, FS, ...),
// covering the whole league in a single request. Works for both a pitcher's
// arsenal (what they throw, how it performs) and a batter's per-pitch splits
// (how they perform against each exact pitch type). `pa` is the sample-size
// gate — always check it before trusting `ba`/`xba`/`whiff` on a pitch type.

export async function fetchPitchArsenalStats(
  season: number,
  type: "batter" | "pitcher"
): Promise<Map<number, PitchArsenalEntry[]>> {
  const map = new Map<number, PitchArsenalEntry[]>();
  try {
    const res = await fetch(
      `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=${type}&year=${season}&min=1&csv=true`,
      { cache: "no-store", headers: SAVANT_HEADERS }
    );
    if (!res.ok) return map;

    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return map;

    const header = splitCSVLine(lines[0]).map((h) => h.replace(/"/g, "").trim());
    const idIdx      = header.indexOf("player_id");
    const typeIdx     = header.indexOf("pitch_type");
    const pitchesIdx  = header.indexOf("pitches");
    const usageIdx    = header.indexOf("pitch_usage");
    const paIdx        = header.indexOf("pa");
    const baIdx         = header.indexOf("ba");
    const xbaIdx        = header.indexOf("est_ba");
    const whiffIdx       = header.indexOf("whiff_percent");
    const rvIdx           = header.indexOf("run_value_per_100");
    if (idIdx < 0 || typeIdx < 0) return map;

    const clean = (s: string | undefined) => s?.replace(/"/g, "").trim() ?? "";
    const num = (cols: string[], idx: number) => {
      if (idx < 0) return undefined;
      const v = parseFloat(clean(cols[idx]));
      return isNaN(v) ? undefined : v;
    };

    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const cols  = splitCSVLine(line);
      const id    = parseInt(clean(cols[idIdx]));
      const ptype = clean(cols[typeIdx]).toUpperCase();
      if (isNaN(id) || !ptype) continue;

      const entry: PitchArsenalEntry = {
        type: ptype,
        pitches: num(cols, pitchesIdx) ?? 0,
        usage: num(cols, usageIdx) ?? 0,
        pa: num(cols, paIdx) ?? 0,
        ba: num(cols, baIdx),
        xba: num(cols, xbaIdx),
        whiff: num(cols, whiffIdx),
        runValue: num(cols, rvIdx),
      };

      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(entry);
    }

    for (const entries of map.values()) entries.sort((a, b) => b.usage - a.usage);
  } catch {
    // optional data — return whatever we have
  }
  return map;
}

// Sample-size gate for any per-pitch outcome stat (ba/xba/whiff) — this is what
// prevents a 1-PA fluke (e.g. a single 1-for-1 at-bat) from swinging an average.
const MIN_PA_FOR_SPLIT = 10;

function bucketOf(ptype: string): "fastball" | "breaking" | "offspeed" | null {
  if (FASTBALL_TYPES.has(ptype)) return "fastball";
  if (BREAKING_TYPES.has(ptype)) return "breaking";
  if (OFFSPEED_TYPES.has(ptype)) return "offspeed";
  return null;
}

// PA-weighted average of a per-pitch stat across a set of arsenal entries,
// skipping any entry below MIN_PA_FOR_SPLIT. Replaces the old naive running
// mean that let a single tiny-sample pitch type dominate the result.
function weightedAvg(entries: PitchArsenalEntry[], key: "ba" | "whiff"): number | undefined {
  let wSum = 0, vSum = 0;
  for (const e of entries) {
    const v = e[key];
    if (v === undefined || e.pa < MIN_PA_FOR_SPLIT) continue;
    wSum += e.pa;
    vSum += v * e.pa;
  }
  return wSum > 0 ? vSum / wSum : undefined;
}

/**
 * Derives the legacy fastball/breaking/offspeed bucket fields from exact-pitch
 * arsenal data — usage% is a straight pitch-count share (no sample concern),
 * while BA/whiff are PA-weighted and sample-gated via weightedAvg.
 */
export function deriveArsenalBuckets(entries: PitchArsenalEntry[] | undefined): {
  fastballPct?: number; breakingPct?: number; offspeedPct?: number;
  baVsFastball?: number; baVsBreaking?: number; whiffVsBreaking?: number;
} {
  if (!entries || entries.length === 0) return {};
  const totalPitches = entries.reduce((s, e) => s + e.pitches, 0);
  if (totalPitches === 0) return {};

  const byBucket: Record<"fastball" | "breaking" | "offspeed", PitchArsenalEntry[]> =
    { fastball: [], breaking: [], offspeed: [] };
  for (const e of entries) {
    const b = bucketOf(e.type);
    if (b) byBucket[b].push(e);
  }

  const pctOf = (b: "fastball" | "breaking" | "offspeed") =>
    (byBucket[b].reduce((s, e) => s + e.pitches, 0) / totalPitches) * 100;

  return {
    fastballPct: pctOf("fastball"),
    breakingPct: pctOf("breaking"),
    offspeedPct: pctOf("offspeed"),
    baVsFastball: weightedAvg(byBucket.fastball, "ba"),
    baVsBreaking: weightedAvg(byBucket.breaking, "ba"),
    whiffVsBreaking: weightedAvg(byBucket.breaking, "whiff"),
  };
}

// ─── Batter vs Pitcher (career H2H) ───────────────────────────────────────────

export async function fetchBatterVsPitcher(
  batterId: number,
  pitcherId: number
): Promise<MLBBatter["vsCurrentPitcher"] | undefined> {
  try {
    const data = await get<any>(
      `/people/${batterId}/stats?stats=vsPlayerTotal&group=hitting&sportId=1&opposingPlayerId=${pitcherId}`
    );
    const stat = data.stats?.[0]?.splits?.[0]?.stat;
    if (!stat || (stat.atBats ?? 0) === 0) return undefined;
    return {
      atBats: stat.atBats ?? 0,
      hits:   stat.hits ?? 0,
      avg:    parseFloat(stat.avg ?? "0"),
      hr:     stat.homeRuns ?? 0,
    };
  } catch {
    return undefined;
  }
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export async function fetchSchedule(date: string): Promise<{ gamePk: number; venueId: number; homeTeam: MLBTeam; awayTeam: MLBTeam; status: string; gameDate: string; homeProbablePitcherId?: number; awayProbablePitcherId?: number; homeProbablePitcherName?: string; awayProbablePitcherName?: string }[]> {
  const data = await get<any>(
    `/schedule?sportId=1&date=${date}&hydrate=team,venue,lineups,probablePitcher`
  );

  const games: any[] = [];
  for (const date of data.dates ?? []) {
    for (const g of date.games ?? []) {
      games.push({
        gamePk: g.gamePk,
        venueId: g.venue?.id ?? 0,
        venueName: g.venue?.name ?? "",
        gameDate: g.gameDate,
        status: g.status?.detailedState ?? "",
        homeTeam: {
          id: g.teams.home.team.id,
          name: g.teams.home.team.name,
          abbreviation: g.teams.home.team.abbreviation ?? "",
        },
        awayTeam: {
          id: g.teams.away.team.id,
          name: g.teams.away.team.name,
          abbreviation: g.teams.away.team.abbreviation ?? "",
        },
        homeProbablePitcherId: g.teams.home.probablePitcher?.id,
        awayProbablePitcherId: g.teams.away.probablePitcher?.id,
        homeProbablePitcherName: g.teams.home.probablePitcher?.fullName,
        awayProbablePitcherName: g.teams.away.probablePitcher?.fullName,
      });
    }
  }
  return games;
}

// ─── Lineups & Starters ────────────────────────────────────────────────────────

export async function fetchBoxscore(gamePk: number): Promise<{
  homeLineup: { id: number; name: string; position: string; battingOrder: number }[];
  awayLineup: { id: number; name: string; position: string; battingOrder: number }[];
  homePitcherId?: number;
  awayPitcherId?: number;
}> {
  try {
    const data = await get<any>(`/game/${gamePk}/boxscore`);
    const extractLineup = (side: any) => {
      const batters: any[] = [];
      const players = side.players ?? {};
      for (const key of Object.keys(players)) {
        const p = players[key];
        if (p.battingOrder) {
          batters.push({
            id: p.person.id,
            name: p.person.fullName,
            position: p.position?.abbreviation ?? "",
            battingOrder: parseInt(p.battingOrder) / 100,
          });
        }
      }
      return batters.sort((a, b) => a.battingOrder - b.battingOrder);
    };

    const homePitchers = data.teams?.home?.pitchers ?? [];
    const awayPitchers = data.teams?.away?.pitchers ?? [];

    return {
      homeLineup: extractLineup(data.teams?.home ?? {}),
      awayLineup: extractLineup(data.teams?.away ?? {}),
      homePitcherId: homePitchers[0],
      awayPitcherId: awayPitchers[0],
    };
  } catch {
    return { homeLineup: [], awayLineup: [], homePitcherId: undefined, awayPitcherId: undefined };
  }
}

// ─── Batter Stats ──────────────────────────────────────────────────────────────

export async function fetchBatterStats(playerId: number, season: number): Promise<Partial<MLBBatter>> {
  try {
    const [gameLogRes, splitsRes, seasonRes] = await Promise.allSettled([
      get<any>(`/people/${playerId}/stats?stats=gameLog&season=${season}&group=hitting`),
      get<any>(`/people/${playerId}/stats?stats=statSplits&season=${season}&group=hitting&sitCodes=vl,vr,h,a`),
      get<any>(`/people/${playerId}/stats?stats=season&season=${season}&group=hitting`),
    ]);

    // Season stats
    let seasonAVG = 0, seasonSLG = 0, seasonHR = 0, hand: "L" | "R" | "S" = "R";
    if (seasonRes.status === "fulfilled") {
      const s = seasonRes.value.stats?.[0]?.splits?.[0]?.stat ?? {};
      seasonAVG = parseFloat(s.avg ?? "0");
      seasonSLG = parseFloat(s.slg ?? "0");
      seasonHR = s.homeRuns ?? 0;
    }

    // Player handedness
    try {
      const personRes = await get<any>(`/people/${playerId}`);
      const bats = personRes.people?.[0]?.batSide?.code;
      hand = (bats === "L" ? "L" : bats === "S" ? "S" : "R") as "L" | "R" | "S";
    } catch {}

    // Game logs — last 40 for consistency rates, last 10 for chart
    let last10Games: BatterGameLog[] = [];
    let last3AVG = 0, last6AVG = 0, last10AVG = 0;
    let last3SLG = 0, last6SLG = 0, last10SLG = 0;
    let last3HR = 0, last6HR = 0, last10HR = 0;
    let hittingStreak = 0;
    let hitRate10 = 0, hitRate20 = 0, hitRate30 = 0, hitRate40 = 0;
    let gameLogCount = 0;

    if (gameLogRes.status === "fulfilled") {
      const splits = gameLogRes.value.stats?.[0]?.splits ?? [];
      const recent40 = splits.slice(-40).reverse(); // up to 40 most recent, newest first
      gameLogCount = recent40.length;
      const recent = recent40.slice(0, 10);

      const hitRateFor = (n: number) => {
        const w = recent40.slice(0, n);
        if (w.length === 0) return 0;
        return w.filter((g: any) => (g.stat.hits ?? 0) > 0).length / w.length;
      };
      hitRate10 = hitRateFor(10);
      hitRate20 = hitRateFor(20);
      hitRate30 = hitRateFor(30);
      hitRate40 = hitRateFor(40);

      last10Games = recent.map((s: any) => ({
        date: s.date,
        opponent: s.opponent?.name ?? "",
        atBats: s.stat.atBats ?? 0,
        hits: s.stat.hits ?? 0,
        hr: s.stat.homeRuns ?? 0,
        avg: parseFloat(s.stat.avg ?? "0"),
        slg: parseFloat(s.stat.slg ?? "0"),
      }));

      // Calculate streak
      for (const g of recent) {
        if ((g.stat.hits ?? 0) > 0) hittingStreak++;
        else break;
      }

      const calcWindow = (games: any[], n: number) => {
        const w = games.slice(0, n);
        const ab = w.reduce((s: number, g: any) => s + (g.stat.atBats ?? 0), 0);
        const h = w.reduce((s: number, g: any) => s + (g.stat.hits ?? 0), 0);
        const hr = w.reduce((s: number, g: any) => s + (g.stat.homeRuns ?? 0), 0);
        const tb = w.reduce((s: number, g: any) => s + (g.stat.totalBases ?? 0), 0);
        return {
          avg: ab > 0 ? h / ab : 0,
          slg: ab > 0 ? tb / ab : 0,
          hr,
        };
      };

      const w3 = calcWindow(recent, 3);
      const w6 = calcWindow(recent, 6);
      const w10 = calcWindow(recent, 10);
      last3AVG = w3.avg; last6AVG = w6.avg; last10AVG = w10.avg;
      last3SLG = w3.slg; last6SLG = w6.slg; last10SLG = w10.slg;
      last3HR = w3.hr; last6HR = w6.hr; last10HR = w10.hr;
    }

    // Splits vs L/R and Home/Away
    let avgVsLeft = 0, avgVsRight = 0, slgVsLeft = 0, slgVsRight = 0;
    let homeAVG = 0, awayAVG = 0, homeSLG = 0, awaySLG = 0;
    if (splitsRes.status === "fulfilled") {
      for (const block of splitsRes.value.stats ?? []) {
        for (const split of block.splits ?? []) {
          const code = split.split?.code;
          if (code === "vl") { avgVsLeft  = parseFloat(split.stat.avg ?? "0"); slgVsLeft  = parseFloat(split.stat.slg ?? "0"); }
          if (code === "vr") { avgVsRight = parseFloat(split.stat.avg ?? "0"); slgVsRight = parseFloat(split.stat.slg ?? "0"); }
          if (code === "h")  { homeAVG    = parseFloat(split.stat.avg ?? "0"); homeSLG    = parseFloat(split.stat.slg ?? "0"); }
          if (code === "a")  { awayAVG    = parseFloat(split.stat.avg ?? "0"); awaySLG    = parseFloat(split.stat.slg ?? "0"); }
        }
      }
    }

    return {
      hand,
      seasonAVG, seasonSLG, seasonHR,
      last3AVG, last6AVG, last10AVG,
      last3SLG, last6SLG, last10SLG,
      last3HR, last6HR, last10HR,
      hittingStreak,
      hitRate10, hitRate20, hitRate30, hitRate40,
      gameLogCount,
      avgVsLeft, avgVsRight,
      slgVsLeft, slgVsRight,
      homeAVG, awayAVG, homeSLG, awaySLG,
      last10Games,
    };
  } catch {
    return {};
  }
}

// ─── Pitcher Stats ─────────────────────────────────────────────────────────────

export async function fetchPitcherStats(playerId: number, season: number): Promise<Partial<MLBPitcher>> {
  try {
    const [gameLogRes, seasonRes, personRes, splitsRes] = await Promise.allSettled([
      get<any>(`/people/${playerId}/stats?stats=gameLog&season=${season}&group=pitching`),
      get<any>(`/people/${playerId}/stats?stats=season&season=${season}&group=pitching`),
      get<any>(`/people/${playerId}`),
      get<any>(`/people/${playerId}/stats?stats=statSplits&season=${season}&group=pitching&sitCodes=vl,vr`),
    ]);

    let seasonERA = 0;
    let hand: "L" | "R" = "R";

    if (seasonRes.status === "fulfilled") {
      const s = seasonRes.value.stats?.[0]?.splits?.[0]?.stat ?? {};
      seasonERA = parseFloat(s.era ?? "0");
    }

    if (personRes.status === "fulfilled") {
      const throws = personRes.value.people?.[0]?.pitchHand?.code;
      hand = throws === "L" ? "L" : "R";
    }

    let last3ERA = 0, last6ERA = 0;
    let last3HitsAllowed = 0, last6HitsAllowed = 0, last9HitsAllowed = 0;
    let last3Strikeouts = 0, last3InningsPitched = 0;
    let last3Starts: PitcherStart[] = [];

    if (gameLogRes.status === "fulfilled") {
      const splits = gameLogRes.value.stats?.[0]?.splits ?? [];
      // Filter to starts only (IP >= 1)
      const starts = splits
        .filter((s: any) => (s.stat.inningsPitched ?? 0) >= 1)
        .slice(-9)
        .reverse();

      last3Starts = starts.slice(0, 3).map((s: any) => ({
        date: s.date,
        era: parseFloat(s.stat.era ?? "0"),
        hitsAllowed: s.stat.hits ?? 0,
        inningsPitched: parseFloat(s.stat.inningsPitched ?? "0"),
        strikeouts: s.stat.strikeOuts ?? 0,
        opponent: s.opponent?.name ?? "",
      }));

      const calcPitcherWindow = (games: any[], n: number) => {
        const w = games.slice(0, n);
        const ip = w.reduce((s: number, g: any) => s + parseFloat(g.stat.inningsPitched ?? "0"), 0);
        const er = w.reduce((s: number, g: any) => s + (g.stat.earnedRuns ?? 0), 0);
        const h = w.reduce((s: number, g: any) => s + (g.stat.hits ?? 0), 0);
        const k = w.reduce((s: number, g: any) => s + (g.stat.strikeOuts ?? 0), 0);
        return {
          era: ip > 0 ? (er / ip) * 9 : 0,
          hitsAllowed: h,
          strikeouts: k,
          inningsPitched: ip,
        };
      };

      const w3 = calcPitcherWindow(starts, 3);
      const w6 = calcPitcherWindow(starts, 6);
      const w9 = calcPitcherWindow(starts, 9);
      last3ERA = w3.era; last6ERA = w6.era;
      last3HitsAllowed = w3.hitsAllowed; last6HitsAllowed = w6.hitsAllowed; last9HitsAllowed = w9.hitsAllowed;
      last3Strikeouts = w3.strikeouts;
      last3InningsPitched = w3.inningsPitched;
    }

    let seasonHRAllowed = 0;
    let seasonHitsAllowed = 0, seasonInningsPitched = 0;
    if (seasonRes.status === "fulfilled") {
      const s = seasonRes.value.stats?.[0]?.splits?.[0]?.stat ?? {};
      seasonHRAllowed = s.homeRuns ?? 0;
      seasonHitsAllowed = s.hits ?? 0;
      seasonInningsPitched = parseFloat(s.inningsPitched ?? "0");
    }
    const last3HRAllowed = last3Starts.reduce((s, g) => s + ((g as any).hr || 0), 0);

    // Pitcher splits vs left/right-handed batters — BAA and HR/9
    let baaVsLeft: number | undefined;
    let baaVsRight: number | undefined;
    let hrPer9VsLeft: number | undefined;
    let hrPer9VsRight: number | undefined;
    if (splitsRes.status === "fulfilled") {
      const splitRows: any[] = splitsRes.value.stats?.[0]?.splits ?? [];
      for (const row of splitRows) {
        const stat = row.stat ?? {};
        const avg = parseFloat(stat.avg ?? "0");
        const hrP9 = parseFloat(stat.homeRunsPer9 ?? "0");
        if (row.split?.code === "vl") {
          if (avg)  baaVsLeft     = avg;
          if (hrP9) hrPer9VsLeft  = hrP9;
        }
        if (row.split?.code === "vr") {
          if (avg)  baaVsRight    = avg;
          if (hrP9) hrPer9VsRight = hrP9;
        }
      }
    }

    return {
      hand,
      seasonERA,
      last3ERA, last6ERA,
      last3HitsAllowed, last6HitsAllowed, last9HitsAllowed,
      last3Strikeouts,
      last3InningsPitched,
      last3Starts,
      seasonHRAllowed,
      seasonHitsAllowed,
      seasonInningsPitched,
      last3HRAllowed,
      baaVsLeft,
      baaVsRight,
      hrPer9VsLeft,
      hrPer9VsRight,
    };
  } catch {
    return {};
  }
}

// ─── Team Recent Strikeout Rate ────────────────────────────────────────────────
// Whole-team K% over a trailing window (not just the top-PA lineup) — feeds the
// "team is striking out a lot lately, and today's starter is a strikeout
// pitcher" flag. One MLB Stats API call per team per day.

const TEAM_K_RATE_LOOKBACK_DAYS = 10;

export async function fetchTeamRecentKRate(
  teamId: number,
  asOfDate: string
): Promise<{ kPct: number; plateAppearances: number } | null> {
  try {
    const end = new Date(asOfDate);
    const start = new Date(end);
    start.setDate(start.getDate() - TEAM_K_RATE_LOOKBACK_DAYS);
    const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

    const data = await get<any>(
      `/teams/${teamId}/stats?stats=byDateRange&group=hitting&sportId=1&startDate=${fmtDate(start)}&endDate=${fmtDate(end)}`
    );
    const stat = data.stats?.[0]?.splits?.[0]?.stat;
    const pa = stat?.plateAppearances ?? 0;
    const k  = stat?.strikeOuts ?? 0;
    if (!pa) return null;
    return { kPct: (k / pa) * 100, plateAppearances: pa };
  } catch {
    return null;
  }
}

// ─── Team Top Batters by Plate Appearances ────────────────────────────────────

export async function fetchTeamTopBatters(
  teamId: number,
  season: number,
  limit = 12
): Promise<{ id: number; name: string; position: string; battingOrder: number }[]> {
  try {
    // Get full active roster — more reliable than the stats endpoint early in season
    const rosterData = await get<any>(
      `/teams/${teamId}/roster?rosterType=active&season=${season}`
    );
    const roster: any[] = rosterData.roster ?? [];

    // Position players only (exclude pitchers)
    const posPlayers = roster.filter(
      (p) => p.position?.type !== "Pitcher" && p.position?.code !== "1"
    );

    // Fetch season PA for each position player in parallel
    const withPA = await Promise.all(
      posPlayers.map(async (p) => {
        try {
          const res = await get<any>(
            `/people/${p.person.id}/stats?stats=season&season=${season}&group=hitting`
          );
          const stat = res.stats?.[0]?.splits?.[0]?.stat ?? {};
          return {
            id: p.person.id as number,
            name: (p.person.fullName ?? "Unknown") as string,
            position: (p.position?.abbreviation ?? "—") as string,
            pa: (stat.plateAppearances ?? 0) as number,
          };
        } catch {
          return {
            id: p.person.id as number,
            name: (p.person.fullName ?? "Unknown") as string,
            position: (p.position?.abbreviation ?? "—") as string,
            pa: 0,
          };
        }
      })
    );

    return withPA
      .sort((a, b) => b.pa - a.pa)
      .slice(0, limit)
      .map((p, i) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        battingOrder: i + 1,
      }));
  } catch {
    return [];
  }
}

// ─── Build Full Daily Snapshot ─────────────────────────────────────────────────

export async function buildDailySnapshot(date: string): Promise<DailySnapshot> {
  const season = new Date(date).getFullYear();

  // Fetch schedule + season-level Statcast leaderboards in parallel.
  // batterArsenalMap/pitcherArsenalMap cover the whole league in one request
  // each (Savant leaderboard), same pattern as statcastMap — not per-batter/
  // per-pitcher, so this doesn't multiply per-game requests.
  const [scheduleItems, statcastMap, batterArsenalMap, pitcherArsenalMap] = await Promise.all([
    fetchSchedule(date),
    fetchStatcastData(season),
    fetchPitchArsenalStats(season, "batter"),
    fetchPitchArsenalStats(season, "pitcher"),
  ]);

  const games: MLBGame[] = await Promise.all(
    scheduleItems.map(async (item) => {
      // Fetch boxscore for pitcher IDs + top-PA lineups in parallel
      const [boxscore, homeTopBatters, awayTopBatters] = await Promise.all([
        fetchBoxscore(item.gamePk),
        fetchTeamTopBatters(item.homeTeam.id, season),
        fetchTeamTopBatters(item.awayTeam.id, season),
      ]);

      const homePitcherId = boxscore.homePitcherId ?? item.homeProbablePitcherId;
      const awayPitcherId = boxscore.awayPitcherId ?? item.awayProbablePitcherId;

      // Use top-PA batters as lineup (available before lineup is officially posted)
      const homeLineup = homeTopBatters;
      const awayLineup = awayTopBatters;

      const parkInfo = getParkFactor(item.venueId);

      const homeBatterIds = homeLineup.map((p) => p.id);
      const awayBatterIds = awayLineup.map((p) => p.id);
      const allBatterIds  = [...homeBatterIds, ...awayBatterIds];

      const [batterStatsArr, batterZoneMap, homePitcherStats, awayPitcherStats, homePitcherZone, awayPitcherZone, homeTeamKRate, awayTeamKRate] = await Promise.all([
        Promise.all(allBatterIds.map((id) => fetchBatterStats(id, season))),
        fetchBatterZoneProfiles(allBatterIds, season),
        homePitcherId ? fetchPitcherStats(homePitcherId, season)     : Promise.resolve({}),
        awayPitcherId ? fetchPitcherStats(awayPitcherId, season)     : Promise.resolve({}),
        homePitcherId ? fetchPitcherZoneStats(homePitcherId, season)  : Promise.resolve({}),
        awayPitcherId ? fetchPitcherZoneStats(awayPitcherId, season)  : Promise.resolve({}),
        fetchTeamRecentKRate(item.homeTeam.id, date),
        fetchTeamRecentKRate(item.awayTeam.id, date),
      ]);

      const batterStatsMap: Record<number, Partial<MLBBatter>> = {};
      allBatterIds.forEach((id, i) => {
        const pitchArsenal = batterArsenalMap.get(id);
        batterStatsMap[id] = {
          ...batterStatsArr[i],
          ...(statcastMap.has(id) ? statcastMap.get(id)! : {}),
          pitchArsenal,
          ...deriveArsenalBuckets(pitchArsenal),
        };
      });

      // Fetch career H2H: home batters vs away pitcher, away batters vs home pitcher
      const h2hFetches = [
        ...homeBatterIds.map((id) =>
          awayPitcherId
            ? fetchBatterVsPitcher(id, awayPitcherId).then((r) => ({ id, r }))
            : Promise.resolve({ id, r: undefined as MLBBatter["vsCurrentPitcher"] })
        ),
        ...awayBatterIds.map((id) =>
          homePitcherId
            ? fetchBatterVsPitcher(id, homePitcherId).then((r) => ({ id, r }))
            : Promise.resolve({ id, r: undefined as MLBBatter["vsCurrentPitcher"] })
        ),
      ];
      const h2hResults = await Promise.all(h2hFetches);
      for (const { id, r } of h2hResults) {
        if (r) batterStatsMap[id] = { ...batterStatsMap[id], vsCurrentPitcher: r };
      }

      const buildBatter = (
        p: { id: number; name: string; position: string; battingOrder: number },
        isHome: boolean,
      ): MLBBatter => ({
        id: p.id,
        name: p.name,
        position: p.position,
        battingOrder: p.battingOrder,
        hand: "R",
        seasonAVG: 0, seasonSLG: 0, seasonHR: 0,
        last3AVG: 0, last6AVG: 0, last10AVG: 0,
        last3SLG: 0, last6SLG: 0, last10SLG: 0,
        last3HR: 0, last6HR: 0, last10HR: 0,
        hittingStreak: 0,
        avgVsLeft: 0, avgVsRight: 0,
        slgVsLeft: 0, slgVsRight: 0,
        last10Games: [],
        ...batterStatsMap[p.id],
        isHome,
        zoneProfile: batterZoneMap.get(p.id),
      });

      const buildPitcher = (
        id: number | undefined,
        stats: Partial<MLBPitcher>,
        zoneStats: Partial<PitcherZoneStatsResult>,
        nameMap: Map<number, string>,
        opposingTeamKPct: number | undefined,
      ): MLBPitcher | undefined => {
        if (!id) return undefined;
        const pitchArsenal = pitcherArsenalMap.get(id);
        return {
          id,
          name: nameMap.get(id) ?? "Unknown",
          hand: "R",
          seasonERA: 0,
          last3ERA: 0, last6ERA: 0,
          last3HitsAllowed: 0, last6HitsAllowed: 0, last9HitsAllowed: 0,
          last3Strikeouts: 0, last3InningsPitched: 0,
          last3Starts: [],
          seasonHRAllowed: 0,
          last3HRAllowed: 0,
          ...stats,
          ...zoneStats,
          opposingTeamKPct,
          pitchArsenal,
          // Arsenal usage% is Savant's own per-pitch-type share — more accurate
          // than the raw pitch-by-pitch bucket count above, so it wins here.
          // (Only the usage fields apply to a pitcher — baVs*/whiffVs* from
          // deriveArsenalBuckets are batting stats and belong on batters only.)
          ...(({ fastballPct, breakingPct, offspeedPct }) => ({ fastballPct, breakingPct, offspeedPct }))(deriveArsenalBuckets(pitchArsenal)),
        };
      };

      // Build name lookup from lineups + probable pitcher names from schedule
      const nameMap = new Map<number, string>();
      [...homeLineup, ...awayLineup].forEach((p) => nameMap.set(p.id, p.name));
      if (item.homeProbablePitcherId && item.homeProbablePitcherName) nameMap.set(item.homeProbablePitcherId, item.homeProbablePitcherName);
      if (item.awayProbablePitcherId && item.awayProbablePitcherName) nameMap.set(item.awayProbablePitcherId, item.awayProbablePitcherName);

      // Fetch pitcher names if not in lineup
      const fetchName = async (id?: number) => {
        if (!id || nameMap.has(id)) return;
        try {
          const p = await get<any>(`/people/${id}`);
          nameMap.set(id, p.people?.[0]?.fullName ?? "Unknown");
        } catch {}
      };
      await Promise.all([fetchName(homePitcherId), fetchName(awayPitcherId)]);

      return {
        gamePk: item.gamePk,
        gameDate: item.gameDate,
        status: item.status,
        homeTeam: item.homeTeam,
        awayTeam: item.awayTeam,
        venue: (item as any).venueName ?? "",
        venueId: item.venueId,
        parkFactor: parkInfo.factor,
        homeLineup: homeLineup.map((p) => buildBatter(p, true)),
        awayLineup: awayLineup.map((p) => buildBatter(p, false)),
        // A pitcher's "opposing team K rate" is the OTHER team's recent strikeout
        // rate — the home starter faces the away lineup, and vice versa.
        homeStartingPitcher: buildPitcher(homePitcherId, homePitcherStats, homePitcherZone, nameMap, awayTeamKRate?.kPct),
        awayStartingPitcher: buildPitcher(awayPitcherId, awayPitcherStats, awayPitcherZone, nameMap, homeTeamKRate?.kPct),
      };
    })
  );

  return {
    date,
    syncedAt: new Date().toISOString(),
    games,
  };
}
