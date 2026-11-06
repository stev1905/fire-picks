// Builds the daily NBA first-basket snapshot.
// Source (free, no key): ESPN scoreboard, team schedules and game summaries
// (box score + play-by-play). Each completed game is reduced to a tiny extract
// (opening tip, first shots, first baskets, who played/started) and cached in
// Supabase, so a sync only downloads games it hasn't seen yet.
/* eslint-disable @typescript-eslint/no-explicit-any -- ESPN responses are untyped JSON */
import type {
  NBADailySnapshot, NBAGame, NBAFirstBasketRow, NBAGameExtract, NBAGamePlayer, NBAPbpCache, NBATeamRef,
} from "@/types/nba";

export const NBA_SCHEMA_VERSION = 1;

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

// ── Model constants ─────────────────────────────────────────────────────────
// Tip: a jumper's win rate is shrunk toward 50% with this many phantom tips
const TIP_PRIOR_TIPS = 4;
// Prior for "team that wins the tip makes the first FG", blended with the
// observed league rate this season (prior counts as this many games)
const TIP_WINNER_FIRST_PRIOR = 0.57;
const TIP_WINNER_FIRST_PRIOR_N = 40;
// Share of a team's first FG made by a non-starter (prior + phantom games)
const BENCH_SHARE_PRIOR = 0.03;
const BENCH_SHARE_PRIOR_N = 100;
// Player share: counts are shrunk toward his FGA share with this many phantom starts
const SHARE_PRIOR_STARTS = 5;
const RECENT_PRIOR_STARTS = 2;
// Blend of the three share estimates (sum = 1)
export const SHARE_WEIGHTS = { firstShot: 0.4, firstBasket: 0.35, recent: 0.25 } as const;
// prob → 0–100 score (a 25% first-basket chance maps to 100)
const SCORE_SCALE = 400;

// ── Fetch helpers ───────────────────────────────────────────────────────────
async function getJson<T = any>(url: string, tries = 3): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 404) return null;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ESPN labels the 2026-27 season as 2027
export function seasonForDate(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return m >= 8 ? y + 1 : y;
}

// ── Game extraction ─────────────────────────────────────────────────────────
const isFreeThrow = (p: any) => /free throw/i.test(p?.type?.text ?? "");

function boxPlayers(summary: any): NBAGamePlayer[] {
  const out: NBAGamePlayer[] = [];
  for (const side of summary?.boxscore?.players ?? []) {
    const teamId = String(side.team?.id ?? "");
    const stat = side.statistics?.[0];
    if (!stat) continue;
    const keys: string[] = stat.keys ?? [];
    const minIdx = keys.indexOf("minutes");
    const fgIdx = keys.indexOf("fieldGoalsMade-fieldGoalsAttempted");
    for (const a of stat.athletes ?? []) {
      if (a.didNotPlay) continue;
      const stats: string[] = a.stats ?? [];
      const min = Number(stats[minIdx]) || 0;
      if (!a.starter && min <= 0) continue;
      const fga = Number(String(stats[fgIdx] ?? "0-0").split("-")[1]) || 0;
      out.push({
        id: String(a.athlete?.id),
        name: a.athlete?.displayName ?? "Unknown",
        pos: a.athlete?.position?.abbreviation ?? "",
        teamId,
        starter: !!a.starter,
        fga,
      });
    }
  }
  return out;
}

export function extractGame(summary: any): NBAGameExtract | null {
  const comp = summary?.header?.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c: any) => c.homeAway === "home");
  const away = comp.competitors?.find((c: any) => c.homeAway === "away");
  const plays: any[] = summary?.plays ?? [];
  const players = boxPlayers(summary);
  if (!home || !away || plays.length === 0 || players.length === 0) return null;

  const teamOf = new Map(players.map((p) => [p.id, p.teamId]));
  const playTeam = (p: any): string | undefined => {
    const pid = p?.participants?.[0]?.athlete?.id;
    return p?.team?.id ? String(p.team.id) : pid ? teamOf.get(String(pid)) : undefined;
  };

  // Opening tip = a 1st-period jump ball before any shot
  let tip: NBAGameExtract["tip"] = null;
  for (const p of plays) {
    if (p.shootingPlay) break;
    if ((p.period?.number ?? 1) !== 1) break;
    if (/jump ?ball/i.test(p.type?.text ?? "")) {
      const parts = (p.participants ?? []).map((x: any) => String(x.athlete?.id));
      const jumpers = parts.slice(0, 2).filter((id: string) => teamOf.has(id));
      let winner = p.team?.id ? String(p.team.id) : undefined;
      if (!winner && parts[2]) winner = teamOf.get(parts[2]);
      if (jumpers.length === 2 && winner) tip = { jumpers, winnerTeamId: winner };
      break;
    }
  }

  let firstShot: NBAGameExtract["firstShot"] = null;
  let firstFG: NBAGameExtract["firstFG"] = null;
  const teamFirstShot: Record<string, string> = {};
  const teamFirstFG: Record<string, string> = {};
  for (const p of plays) {
    if (!p.shootingPlay || isFreeThrow(p)) continue;
    const pid = p.participants?.[0]?.athlete?.id;
    const tid = playTeam(p);
    if (!pid || !tid) continue;
    const playerId = String(pid);
    if (!firstShot) firstShot = { playerId, teamId: tid };
    if (!teamFirstShot[tid]) teamFirstShot[tid] = playerId;
    if (p.scoringPlay) {
      if (!firstFG) firstFG = { playerId, teamId: tid };
      if (!teamFirstFG[tid]) teamFirstFG[tid] = playerId;
    }
    if (firstFG && Object.keys(teamFirstFG).length >= 2) break;
  }

  return {
    id: String(summary.header.id ?? comp.id),
    date: comp.date ?? "",
    homeId: String(home.team?.id ?? home.id),
    awayId: String(away.team?.id ?? away.id),
    tip, firstShot, firstFG, teamFirstShot, teamFirstFG, players,
  };
}

// ── Player history ──────────────────────────────────────────────────────────
interface PlayerHistory {
  id: string;
  name: string;
  pos: string;
  lastTeamId: string;
  lastDate: string;
  gamesPlayed: number;
  tipsTaken: number;
  tipsWon: number;
  firstGameShots: number;
  firstTeamShots: number;
  firstGameBaskets: number;
  firstTeamBaskets: number;
  recent: { firstGameBasket: boolean }[];   // newest first
  // Starts only — used by the share model
  starts: { teamId: string; fga: number; teamFirstShot: boolean; teamFirstFG: boolean }[]; // newest first
}

function buildHistories(games: NBAGameExtract[]): Map<string, PlayerHistory> {
  const hist = new Map<string, PlayerHistory>();
  const sorted = [...games].sort((a, b) => b.date.localeCompare(a.date)); // newest first
  for (const g of sorted) {
    for (const p of g.players) {
      let h = hist.get(p.id);
      if (!h) {
        h = {
          id: p.id, name: p.name, pos: p.pos, lastTeamId: p.teamId, lastDate: g.date,
          gamesPlayed: 0, tipsTaken: 0, tipsWon: 0, firstGameShots: 0, firstTeamShots: 0,
          firstGameBaskets: 0, firstTeamBaskets: 0, recent: [], starts: [],
        };
        hist.set(p.id, h);
      }
      h.gamesPlayed++;
      if (g.tip?.jumpers.includes(p.id)) {
        h.tipsTaken++;
        if (g.tip.winnerTeamId === p.teamId) h.tipsWon++;
      }
      const tShot = g.teamFirstShot[p.teamId] === p.id;
      const tFG = g.teamFirstFG[p.teamId] === p.id;
      const gFG = g.firstFG?.playerId === p.id;
      if (g.firstShot?.playerId === p.id) h.firstGameShots++;
      if (tShot) h.firstTeamShots++;
      if (gFG) h.firstGameBaskets++;
      if (tFG) h.firstTeamBaskets++;
      h.recent.push({ firstGameBasket: gFG });
      if (p.starter) h.starts.push({ teamId: p.teamId, fga: p.fga, teamFirstShot: tShot, teamFirstFG: tFG });
    }
  }
  return hist;
}

// ── Model pieces ────────────────────────────────────────────────────────────
const shrunkTip = (h: PlayerHistory | undefined) =>
  h ? (h.tipsWon + TIP_PRIOR_TIPS / 2) / (h.tipsTaken + TIP_PRIOR_TIPS) : 0.5;

// Log5: chance A beats B given each one's win rate vs the league
function log5(a: number, b: number): number {
  const num = a * (1 - b);
  const den = num + b * (1 - a);
  return den > 0 ? num / den : 0.5;
}

function fairOdds(p: number): string {
  if (p <= 0) return "—";
  if (p >= 0.5) return `${Math.round((-100 * p) / (1 - p))}`;
  return `+${Math.round((100 * (1 - p)) / p)}`;
}

function leagueRates(games: NBAGameExtract[]) {
  let tipN = 0, tipFirst = 0, teamFG = 0, benchFG = 0;
  for (const g of games) {
    if (g.tip && g.firstFG) {
      tipN++;
      if (g.firstFG.teamId === g.tip.winnerTeamId) tipFirst++;
    }
    const starters = new Set(g.players.filter((p) => p.starter).map((p) => p.id));
    for (const pid of Object.values(g.teamFirstFG)) {
      teamFG++;
      if (!starters.has(pid)) benchFG++;
    }
  }
  return {
    tipWinnerScoresFirst:
      (tipFirst + TIP_WINNER_FIRST_PRIOR * TIP_WINNER_FIRST_PRIOR_N) / (tipN + TIP_WINNER_FIRST_PRIOR_N),
    benchShare: (benchFG + BENCH_SHARE_PRIOR * BENCH_SHARE_PRIOR_N) / (teamFG + BENCH_SHARE_PRIOR_N),
  };
}

const isOut = (status: string | null | undefined) => {
  const s = (status ?? "").toLowerCase();
  return s === "out" || s.includes("suspen") || s.includes("injured reserve");
};

// Last game's five, with anyone ruled out replaced by the next most frequent recent starter
function projectStarters(
  teamId: string, teamGames: NBAGameExtract[], hist: Map<string, PlayerHistory>, injuries: Map<string, string>,
): string[] {
  const onTeam = (id: string) => hist.get(id)?.lastTeamId === teamId && !isOut(injuries.get(id));
  const last = teamGames[0];
  const five = (last?.players ?? []).filter((p) => p.teamId === teamId && p.starter).map((p) => p.id).filter(onTeam);
  if (five.length >= 5) return five.slice(0, 5);

  // Rank candidates by starts in the last 10 team games, then shot volume
  const score = new Map<string, number>();
  for (const g of teamGames.slice(0, 10)) {
    for (const p of g.players) {
      if (p.teamId !== teamId) continue;
      score.set(p.id, (score.get(p.id) ?? 0) + (p.starter ? 100 : 0) + p.fga);
    }
  }
  const pool = [...score.entries()]
    .filter(([id]) => onTeam(id) && !five.includes(id))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  return [...five, ...pool].slice(0, 5);
}

// Most tips taken among the five; fall back to the listed center
function pickJumper(starters: string[], hist: Map<string, PlayerHistory>): string | null {
  let best: string | null = null;
  let bestTips = 0;
  for (const id of starters) {
    const t = hist.get(id)?.tipsTaken ?? 0;
    if (t > bestTips) { best = id; bestTips = t; }
  }
  if (best) return best;
  return starters.find((id) => hist.get(id)?.pos === "C") ?? starters.find((id) => /F/.test(hist.get(id)?.pos ?? "")) ?? starters[0] ?? null;
}

// P(player makes his team's first FG), for each of the five; sums to (1 − bench share)
function teamShares(starters: string[], teamId: string, hist: Map<string, PlayerHistory>, benchShare: number) {
  const rows = starters.map((id) => {
    const h = hist.get(id);
    const starts = (h?.starts ?? []).filter((s) => s.teamId === teamId);
    const all = starts.length ? starts : h?.starts ?? [];
    const fgaPer = all.length
      ? all.reduce((s, x) => s + x.fga, 0) / all.length
      : h && h.gamesPlayed ? 8 : 6;
    return { id, starts: all, fgaPer };
  });
  const fgaTotal = rows.reduce((s, r) => s + r.fgaPer, 0) || 1;

  const raw = rows.map((r) => {
    const prior = r.fgaPer / fgaTotal;   // his slice of the five's shot volume
    const n = r.starts.length;
    const fs = r.starts.filter((s) => s.teamFirstShot).length;
    const fb = r.starts.filter((s) => s.teamFirstFG).length;
    const last5 = r.starts.slice(0, 5);
    const rec = last5.reduce((s, x) => s + (Number(x.teamFirstShot) + Number(x.teamFirstFG)) / 2, 0);
    const shot = (fs + SHARE_PRIOR_STARTS * prior) / (n + SHARE_PRIOR_STARTS);
    const make = (fb + SHARE_PRIOR_STARTS * prior) / (n + SHARE_PRIOR_STARTS);
    const recent = (rec + RECENT_PRIOR_STARTS * prior) / (last5.length + RECENT_PRIOR_STARTS);
    return {
      id: r.id,
      v: SHARE_WEIGHTS.firstShot * shot + SHARE_WEIGHTS.firstBasket * make + SHARE_WEIGHTS.recent * recent,
    };
  });
  const sum = raw.reduce((s, r) => s + r.v, 0) || 1;
  return new Map(raw.map((r) => [r.id, (r.v / sum) * (1 - benchShare)]));
}

// ── Snapshot ────────────────────────────────────────────────────────────────
function teamRef(c: any): NBATeamRef {
  return {
    id: String(c.team?.id ?? c.id),
    abbr: c.team?.abbreviation ?? "?",
    name: c.team?.displayName ?? c.team?.name ?? "",
    record: c.records?.find((r: any) => r.type === "total")?.summary ?? c.record?.find?.((r: any) => r.type === "total")?.summary,
  };
}

export async function buildNBASnapshot(
  opts: { date?: string; cache?: NBAPbpCache | null } = {},
): Promise<{ snapshot: NBADailySnapshot; cache: NBAPbpCache }> {
  const date = opts.date ?? todayET();
  const season = seasonForDate(date);
  const cache: NBAPbpCache =
    opts.cache && opts.cache.season === season ? opts.cache : { season, games: {} };

  const sb = await getJson(`${ESPN}/scoreboard?dates=${date.replace(/-/g, "")}`);
  const events: any[] = sb?.events ?? [];
  const todayIds = new Set(events.map((e) => String(e.id)));

  const games: NBAGame[] = events.map((e) => {
    const c = e.competitions?.[0] ?? {};
    const home = c.competitors?.find((x: any) => x.homeAway === "home");
    const away = c.competitors?.find((x: any) => x.homeAway === "away");
    return {
      id: String(e.id),
      startTime: e.date,
      status: e.status?.type?.name ?? c.status?.type?.name ?? "STATUS_SCHEDULED",
      home: teamRef(home ?? {}),
      away: teamRef(away ?? {}),
      lineup: {},
    };
  });

  // Every completed regular-season game for the teams on today's slate
  const teamIds = [...new Set(games.flatMap((g) => [g.home.id, g.away.id]))];
  const schedules = await mapLimit(teamIds, 6, (id) => getJson(`${ESPN}/teams/${id}/schedule?season=${season}`));
  const finalIds = new Set<string>();
  for (const s of schedules) {
    for (const e of s?.events ?? []) {
      const status = e.competitions?.[0]?.status?.type?.name;
      const id = String(e.id);
      if (status === "STATUS_FINAL" && !todayIds.has(id)) finalIds.add(id);
    }
  }
  const missing = [...finalIds].filter((id) => !cache.games[id]);
  const fetched = await mapLimit(missing, 6, async (id) => extractGame(await getJson(`${ESPN}/summary?event=${id}`)));
  for (const g of fetched) if (g) cache.games[g.id] = g;

  // Today's summaries: injuries, and real starters once a game has tipped
  const todaySummaries = await mapLimit(games, 6, (g) => getJson(`${ESPN}/summary?event=${g.id}`));

  const history = Object.values(cache.games).filter((g) => !todayIds.has(g.id) && g.date < `${date}T12:00`);
  const hist = buildHistories(history);
  const { tipWinnerScoresFirst, benchShare } = leagueRates(history);

  const players: NBAFirstBasketRow[] = [];
  games.forEach((game, gi) => {
    const summary = todaySummaries[gi];
    const injuries = new Map<string, string>();
    for (const t of summary?.injuries ?? []) {
      for (const i of t.injuries ?? []) if (i.athlete?.id) injuries.set(String(i.athlete.id), i.status ?? "");
    }
    const live = game.status !== "STATUS_SCHEDULED" ? boxPlayers(summary) : [];
    // Players appearing only today (rookie debut, new signing) still need a name
    for (const p of live) {
      if (!hist.has(p.id)) {
        hist.set(p.id, {
          id: p.id, name: p.name, pos: p.pos, lastTeamId: p.teamId, lastDate: game.startTime,
          gamesPlayed: 0, tipsTaken: 0, tipsWon: 0, firstGameShots: 0, firstTeamShots: 0,
          firstGameBaskets: 0, firstTeamBaskets: 0, recent: [], starts: [],
        });
      }
    }

    const sides = [game.home, game.away].map((team) => {
      const teamGames = history
        .filter((g) => g.homeId === team.id || g.awayId === team.id)
        .sort((a, b) => b.date.localeCompare(a.date));
      const confirmed = live.filter((p) => p.teamId === team.id && p.starter).map((p) => p.id);
      const starters = confirmed.length === 5 ? confirmed : projectStarters(team.id, teamGames, hist, injuries);
      game.lineup[team.id] = confirmed.length === 5 ? "confirmed" : "projected";
      const jumper = pickJumper(starters, hist);
      return { team, starters, jumper };
    });

    const [homeSide, awaySide] = sides;
    const pHomeTip = log5(shrunkTip(hist.get(homeSide.jumper ?? "")), shrunkTip(hist.get(awaySide.jumper ?? "")));
    const pHomeFirst = pHomeTip * tipWinnerScoresFirst + (1 - pHomeTip) * (1 - tipWinnerScoresFirst);

    sides.forEach((side, si) => {
      const isHome = si === 0;
      const opp = isHome ? game.away : game.home;
      const pTeamFirst = isHome ? pHomeFirst : 1 - pHomeFirst;
      const shares = teamShares(side.starters, side.team.id, hist, benchShare);
      for (const id of side.starters) {
        const h = hist.get(id);
        if (!h) continue;
        const teamShare = shares.get(id) ?? 0;
        const prob = pTeamFirst * teamShare;
        const l5 = h.recent.slice(0, 5);
        const status = injuries.get(id) ?? null;
        players.push({
          id, name: h.name, pos: h.pos,
          teamId: side.team.id, team: side.team.abbr, opponent: opp.abbr, isHome,
          gameId: game.id, startTime: game.startTime,
          lineup: game.lineup[side.team.id],
          injuryStatus: status && !isOut(status) ? status : null,
          isJumper: id === side.jumper,
          gamesPlayed: h.gamesPlayed,
          tipsTaken: h.tipsTaken, tipsWon: h.tipsWon,
          firstGameShots: h.firstGameShots, firstTeamShots: h.firstTeamShots,
          firstGameBaskets: h.firstGameBaskets, firstTeamBaskets: h.firstTeamBaskets,
          firstBasketsL5: l5.filter((r) => r.firstGameBasket).length, l5Games: l5.length,
          pTeamFirst, teamShare, prob,
          score: Math.min(100, Math.round(prob * SCORE_SCALE)),
          fairOdds: fairOdds(prob),
        });
      }
    });
  });

  players.sort((a, b) => b.prob - a.prob);

  return {
    snapshot: {
      schemaVersion: NBA_SCHEMA_VERSION,
      date, season,
      syncedAt: new Date().toISOString(),
      gamesOfData: history.length,
      tipWinnerScoresFirst,
      games,
      players,
    },
    cache,
  };
}
