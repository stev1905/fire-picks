import type {
  NHLDailySnapshot, NHLGame, NHLSkater, NHLGoalie, NHLTeam,
  SkaterGameLog, GoalieGameLog,
} from "@/types/nhl";

const BASE = "https://api-web.nhle.com";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`NHL API ${res.status}: ${path}`);
  return res.json();
}

function getSeason(date: string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  return month >= 10 ? `${year}${year + 1}` : `${year - 1}${year}`;
}

function parseToi(toi: string): number {
  if (!toi) return 0;
  const parts = toi.split(":");
  return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
}

function formatToi(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface RosterPlayer {
  id: number;
  firstName: { default: string };
  lastName: { default: string };
  sweaterNumber: number;
  positionCode: string;
}

async function fetchScheduleGames(date: string): Promise<any[]> {
  try {
    const data = await get<any>(`/v1/schedule/${date}`);
    const dayData = data.gameWeek?.find((d: any) => d.date === date);
    return dayData?.games ?? [];
  } catch {
    return [];
  }
}

async function fetchRoster(teamAbbr: string): Promise<{ forwards: RosterPlayer[]; defensemen: RosterPlayer[]; goalies: RosterPlayer[] }> {
  try {
    const data = await get<any>(`/v1/roster/${teamAbbr}/current`);
    return {
      forwards: data.forwards ?? [],
      defensemen: data.defensemen ?? [],
      goalies: data.goalies ?? [],
    };
  } catch {
    return { forwards: [], defensemen: [], goalies: [] };
  }
}

async function fetchSkaterGameLog(playerId: number, season: string): Promise<any[]> {
  try {
    const data = await get<any>(`/v1/player/${playerId}/game-log/${season}/2`);
    return data.gameLog ?? [];
  } catch {
    return [];
  }
}

async function fetchGoalieLanding(playerId: number): Promise<any> {
  try {
    return await get<any>(`/v1/player/${playerId}/landing`);
  } catch {
    return null;
  }
}

async function fetchAllTeamPPK(season: string): Promise<Record<number, { ppPct: number; pkPct: number }>> {
  try {
    const url = `https://api.nhle.com/stats/rest/en/team/summary?isAggregate=false&isGame=false&start=0&limit=50&cayenneExp=seasonId%3D${season}%20and%20gameTypeId%3D2`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return {};
    const data = await res.json();
    const map: Record<number, { ppPct: number; pkPct: number }> = {};
    for (const t of data.data ?? []) {
      map[t.teamId] = {
        ppPct: t.powerPlayPct ?? 0,
        pkPct: t.penaltyKillPct ?? 0,
      };
    }
    return map;
  } catch {
    return {};
  }
}

function buildSkater(player: RosterPlayer, gameLog: any[]): NHLSkater {
  const sorted = [...gameLog].sort((a, b) =>
    (b.gameDate ?? "").localeCompare(a.gameDate ?? "")
  );

  const seasonGP = sorted.length;
  const sum = (arr: any[], key: string) => arr.reduce((s, g) => s + (g[key] ?? 0), 0);

  const totalToi = sorted.reduce((s, g) => s + parseToi(g.toi ?? ""), 0);
  const avgToi = seasonGP > 0 ? formatToi(Math.round(totalToi / seasonGP)) : "0:00";

  let goalStreak = 0;
  for (const g of sorted) {
    if ((g.goals ?? 0) > 0) goalStreak++;
    else break;
  }

  const l3 = sorted.slice(0, 3);
  const l6 = sorted.slice(0, 6);
  const l10 = sorted.slice(0, 10);

  const recentGames: SkaterGameLog[] = sorted.slice(0, 10).map((g) => ({
    date: g.gameDate ?? "",
    opponent: g.opponentAbbrev ?? "",
    goals: g.goals ?? 0,
    assists: g.assists ?? 0,
    points: g.points ?? 0,
    sog: g.shots ?? 0,
    toi: g.toi ?? "0:00",
  }));

  return {
    id: player.id,
    name: `${player.firstName.default} ${player.lastName.default}`,
    position: player.positionCode,
    sweaterNumber: player.sweaterNumber,
    avgToi,
    seasonGP,
    seasonGoals: sum(sorted, "goals"),
    seasonAssists: sum(sorted, "assists"),
    seasonPoints: sum(sorted, "points"),
    seasonSOG: sum(sorted, "shots"),
    last3Goals: sum(l3, "goals"),
    last6Goals: sum(l6, "goals"),
    last10Goals: sum(l10, "goals"),
    last3SOG: sum(l3, "shots"),
    last6SOG: sum(l6, "shots"),
    last10SOG: sum(l10, "shots"),
    last3Points: sum(l3, "points"),
    last6Points: sum(l6, "points"),
    last10Points: sum(l10, "points"),
    goalStreak,
    recentGames,
  };
}

function buildGoalie(player: RosterPlayer, landing: any): NHLGoalie {
  if (!landing) {
    return {
      id: player.id,
      name: `${player.firstName.default} ${player.lastName.default}`,
      sweaterNumber: player.sweaterNumber,
      seasonGP: 0, seasonWins: 0, seasonLosses: 0, seasonOtLosses: 0,
      seasonSavePct: 0, seasonGAA: 0,
      last3SavePct: 0, last3GAA: 0,
      recentGames: [],
    };
  }

  const ss = landing.featuredStats?.regularSeason?.subSeason ?? {};
  const last5: any[] = landing.last5Games ?? [];
  const last3 = last5.slice(0, 3);

  const last3SA = last3.reduce((s: number, g: any) => s + (g.shotsAgainst ?? 0), 0);
  const last3GA = last3.reduce((s: number, g: any) => s + (g.goalsAgainst ?? 0), 0);
  const last3SavePct = last3SA > 0 ? (last3SA - last3GA) / last3SA : 0;

  const last3ToiSec = last3.reduce((s: number, g: any) => s + parseToi(g.toi ?? ""), 0);
  const last3GAA = last3ToiSec > 0 ? (last3GA * 3600) / last3ToiSec : 0;

  const recentGames: GoalieGameLog[] = last5.map((g) => ({
    date: g.gameDate ?? "",
    opponent: g.opponentAbbrev ?? "",
    decision: g.decision ?? "ND",
    savePct: g.savePctg ?? 0,
    shotsAgainst: g.shotsAgainst ?? 0,
    saves: (g.shotsAgainst ?? 0) - (g.goalsAgainst ?? 0),
    toi: g.toi ?? "0:00",
  }));

  return {
    id: player.id,
    name: `${player.firstName.default} ${player.lastName.default}`,
    sweaterNumber: player.sweaterNumber,
    seasonGP: ss.gamesPlayed ?? 0,
    seasonWins: ss.wins ?? 0,
    seasonLosses: ss.losses ?? 0,
    seasonOtLosses: ss.otLosses ?? 0,
    seasonSavePct: ss.savePctg ?? 0,
    seasonGAA: ss.goalsAgainstAvg ?? 0,
    last3SavePct,
    last3GAA,
    recentGames,
  };
}

// Fetch items in sequential batches to avoid rate-limiting
async function batchFetch<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

export async function buildDailyNHLSnapshot(date: string): Promise<NHLDailySnapshot> {
  const season = getSeason(date);

  // Fetch schedule + all team PP/PK in parallel (2 calls total)
  const [scheduleGames, teamPPK] = await Promise.all([
    fetchScheduleGames(date),
    fetchAllTeamPPK(season),
  ]);
  const regularGames = scheduleGames.filter((g) => g.gameType === 2);

  const games: NHLGame[] = await Promise.all(
    regularGames.map(async (g) => {
      const homeAbbr: string = g.homeTeam.abbrev;
      const awayAbbr: string = g.awayTeam.abbrev;

      const [homeRosterRaw, awayRosterRaw] = await Promise.all([
        fetchRoster(homeAbbr),
        fetchRoster(awayAbbr),
      ]);

      // Batch game log fetches 10 at a time to avoid CloudFlare rate limiting
      const buildSkaters = async (players: RosterPlayer[]): Promise<NHLSkater[]> => {
        const logs = await batchFetch(players, 10, (p) => fetchSkaterGameLog(p.id, season));
        return players.map((p, i) => buildSkater(p, logs[i]));
      };

      const buildGoalies = async (players: RosterPlayer[]): Promise<NHLGoalie[]> => {
        const landings = await batchFetch(players, 5, (p) => fetchGoalieLanding(p.id));
        return players.map((p, i) => buildGoalie(p, landings[i]));
      };

      const [
        homeForwards, homeDefense, homeGoalies,
        awayForwards, awayDefense, awayGoalies,
      ] = await Promise.all([
        buildSkaters(homeRosterRaw.forwards),
        buildSkaters(homeRosterRaw.defensemen),
        buildGoalies(homeRosterRaw.goalies),
        buildSkaters(awayRosterRaw.forwards),
        buildSkaters(awayRosterRaw.defensemen),
        buildGoalies(awayRosterRaw.goalies),
      ]);

      const homeStats = teamPPK[g.homeTeam.id] ?? { ppPct: 0, pkPct: 0 };
      const awayStats = teamPPK[g.awayTeam.id] ?? { ppPct: 0, pkPct: 0 };

      const homeTeam: NHLTeam = {
        id: g.homeTeam.id,
        name: g.homeTeam.commonName?.default ?? g.homeTeam.placeName?.default ?? homeAbbr,
        abbreviation: homeAbbr,
        ppPct: homeStats.ppPct,
        pkPct: homeStats.pkPct,
      };

      const awayTeam: NHLTeam = {
        id: g.awayTeam.id,
        name: g.awayTeam.commonName?.default ?? g.awayTeam.placeName?.default ?? awayAbbr,
        abbreviation: awayAbbr,
        ppPct: awayStats.ppPct,
        pkPct: awayStats.pkPct,
      };

      return {
        id: g.id,
        startTimeUTC: g.startTimeUTC,
        homeTeam,
        awayTeam,
        venue: g.venue?.default ?? "",
        homeRoster: { forwards: homeForwards, defensemen: homeDefense, goalies: homeGoalies },
        awayRoster: { forwards: awayForwards, defensemen: awayDefense, goalies: awayGoalies },
      };
    })
  );

  return { date, syncedAt: new Date().toISOString(), games };
}
