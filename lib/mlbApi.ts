import type {
  MLBGame,
  MLBTeam,
  MLBBatter,
  MLBPitcher,
  BatterGameLog,
  PitcherStart,
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

type StatcastEntry = { xBA: number; barrelPct: number; hardHitPct: number };

export async function fetchStatcastData(season: number): Promise<Map<number, StatcastEntry>> {
  const map = new Map<number, StatcastEntry>();
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
      const idIdx  = header.indexOf("player_id");
      // try both known column names
      const xbaIdx = header.indexOf("est_ba") >= 0 ? header.indexOf("est_ba") : header.indexOf("xba");
      if (idIdx >= 0 && xbaIdx >= 0) {
        for (const line of lines.slice(1)) {
          const cols = line.split(",");
          const id  = parseInt(parseCol(cols, idIdx));
          const xBA = parseFloat(parseCol(cols, xbaIdx));
          if (!isNaN(id) && !isNaN(xBA)) {
            const prev = map.get(id) ?? { xBA: 0, barrelPct: 0, hardHitPct: 0 };
            map.set(id, { ...prev, xBA });
          }
        }
      }
    }

    if (statcastRes.status === "fulfilled" && statcastRes.value.ok) {
      const text = await statcastRes.value.text();
      const lines = text.trim().split("\n");
      const header = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
      const idIdx  = header.indexOf("player_id");
      const brlIdx = header.indexOf("brl_percent") >= 0 ? header.indexOf("brl_percent") : header.indexOf("barrel_batted_rate");
      const evIdx  = header.indexOf("ev95percent") >= 0 ? header.indexOf("ev95percent") : header.indexOf("hard_hit_percent");
      if (idIdx >= 0) {
        for (const line of lines.slice(1)) {
          const cols = line.split(",");
          const id = parseInt(parseCol(cols, idIdx));
          if (isNaN(id)) continue;
          const barrelPct  = brlIdx >= 0 ? parseFloat(parseCol(cols, brlIdx))  : NaN;
          const hardHitPct = evIdx  >= 0 ? parseFloat(parseCol(cols, evIdx))   : NaN;
          const prev = map.get(id) ?? { xBA: 0, barrelPct: 0, hardHitPct: 0 };
          map.set(id, {
            ...prev,
            barrelPct:  isNaN(barrelPct)  ? prev.barrelPct  : barrelPct,
            hardHitPct: isNaN(hardHitPct) ? prev.hardHitPct : hardHitPct,
          });
        }
      }
    }
  } catch {
    // Statcast is optional — return whatever we have
  }
  return map;
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

export async function fetchSchedule(date: string): Promise<{ gamePk: number; venueId: number; homeTeam: MLBTeam; awayTeam: MLBTeam; status: string; gameDate: string }[]> {
  const data = await get<any>(
    `/schedule?sportId=1&date=${date}&hydrate=team,venue,lineups`
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
      get<any>(`/people/${playerId}/stats?stats=statSplits&season=${season}&group=hitting&sitCodes=vl,vr`),
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

    // Game logs — last 10
    let last10Games: BatterGameLog[] = [];
    let last3AVG = 0, last6AVG = 0, last10AVG = 0;
    let last3SLG = 0, last6SLG = 0, last10SLG = 0;
    let last3HR = 0, last6HR = 0, last10HR = 0;
    let hittingStreak = 0;

    if (gameLogRes.status === "fulfilled") {
      const splits = gameLogRes.value.stats?.[0]?.splits ?? [];
      const recent = splits.slice(-10).reverse(); // most recent first

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

    // Splits vs L/R
    let avgVsLeft = 0, avgVsRight = 0, slgVsLeft = 0, slgVsRight = 0;
    if (splitsRes.status === "fulfilled") {
      for (const block of splitsRes.value.stats ?? []) {
        for (const split of block.splits ?? []) {
          if (split.split?.code === "vl") {
            avgVsLeft = parseFloat(split.stat.avg ?? "0");
            slgVsLeft = parseFloat(split.stat.slg ?? "0");
          }
          if (split.split?.code === "vr") {
            avgVsRight = parseFloat(split.stat.avg ?? "0");
            slgVsRight = parseFloat(split.stat.slg ?? "0");
          }
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
      avgVsLeft, avgVsRight,
      slgVsLeft, slgVsRight,
      last10Games,
    };
  } catch {
    return {};
  }
}

// ─── Pitcher Stats ─────────────────────────────────────────────────────────────

export async function fetchPitcherStats(playerId: number, season: number): Promise<Partial<MLBPitcher>> {
  try {
    const [gameLogRes, seasonRes, personRes] = await Promise.allSettled([
      get<any>(`/people/${playerId}/stats?stats=gameLog&season=${season}&group=pitching`),
      get<any>(`/people/${playerId}/stats?stats=season&season=${season}&group=pitching`),
      get<any>(`/people/${playerId}`),
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
    let last3HitsAllowed = 0, last6HitsAllowed = 0;
    let last3Strikeouts = 0, last3InningsPitched = 0;
    let last3Starts: PitcherStart[] = [];

    if (gameLogRes.status === "fulfilled") {
      const splits = gameLogRes.value.stats?.[0]?.splits ?? [];
      // Filter to starts only (IP >= 1)
      const starts = splits
        .filter((s: any) => (s.stat.inningsPitched ?? 0) >= 1)
        .slice(-6)
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
      last3ERA = w3.era; last6ERA = w6.era;
      last3HitsAllowed = w3.hitsAllowed; last6HitsAllowed = w6.hitsAllowed;
      last3Strikeouts = w3.strikeouts;
      last3InningsPitched = w3.inningsPitched;
    }

    return {
      hand,
      seasonERA,
      last3ERA, last6ERA,
      last3HitsAllowed, last6HitsAllowed,
      last3Strikeouts: (last3Starts.reduce((s, g) => s + g.strikeouts, 0)),
      last3InningsPitched: (last3Starts.reduce((s, g) => s + g.inningsPitched, 0)),
      last3Starts,
    };
  } catch {
    return {};
  }
}

// ─── Build Full Daily Snapshot ─────────────────────────────────────────────────

export async function buildDailySnapshot(date: string): Promise<DailySnapshot> {
  const season = new Date(date).getFullYear();

  // Fetch schedule + Statcast leaderboards in parallel (Statcast is one-time for the whole snapshot)
  const [scheduleItems, statcastMap] = await Promise.all([
    fetchSchedule(date),
    fetchStatcastData(season),
  ]);

  const games: MLBGame[] = await Promise.all(
    scheduleItems.map(async (item) => {
      const { homeLineup, awayLineup, homePitcherId, awayPitcherId } = await fetchBoxscore(item.gamePk);
      const parkInfo = getParkFactor(item.venueId);

      const homeBatterIds = homeLineup.map((p) => p.id);
      const awayBatterIds = awayLineup.map((p) => p.id);
      const allBatterIds  = [...homeBatterIds, ...awayBatterIds];

      const [batterStatsArr, homePitcherStats, awayPitcherStats] = await Promise.all([
        Promise.all(allBatterIds.map((id) => fetchBatterStats(id, season))),
        homePitcherId ? fetchPitcherStats(homePitcherId, season) : Promise.resolve({}),
        awayPitcherId ? fetchPitcherStats(awayPitcherId, season) : Promise.resolve({}),
      ]);

      const batterStatsMap: Record<number, Partial<MLBBatter>> = {};
      allBatterIds.forEach((id, i) => {
        batterStatsMap[id] = {
          ...batterStatsArr[i],
          // Merge Statcast data when available
          ...(statcastMap.has(id) ? statcastMap.get(id)! : {}),
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

      const buildBatter = (p: { id: number; name: string; position: string; battingOrder: number }): MLBBatter => ({
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
      });

      const buildPitcher = (id: number | undefined, stats: Partial<MLBPitcher>, nameMap: Map<number, string>): MLBPitcher | undefined => {
        if (!id) return undefined;
        return {
          id,
          name: nameMap.get(id) ?? "Unknown",
          hand: "R",
          seasonERA: 0,
          last3ERA: 0, last6ERA: 0,
          last3HitsAllowed: 0, last6HitsAllowed: 0,
          last3Strikeouts: 0, last3InningsPitched: 0,
          last3Starts: [],
          ...stats,
        };
      };

      // Build name lookup from lineups (pitchers may not be in batting lineup)
      const nameMap = new Map<number, string>();
      [...homeLineup, ...awayLineup].forEach((p) => nameMap.set(p.id, p.name));

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
        homeLineup: homeLineup.map(buildBatter),
        awayLineup: awayLineup.map(buildBatter),
        homeStartingPitcher: buildPitcher(homePitcherId, homePitcherStats, nameMap),
        awayStartingPitcher: buildPitcher(awayPitcherId, awayPitcherStats, nameMap),
      };
    })
  );

  return {
    date,
    syncedAt: new Date().toISOString(),
    games,
  };
}
