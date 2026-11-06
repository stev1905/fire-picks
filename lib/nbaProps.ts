// Hot Props + Super Safe Picks.
// Lines: DraftKings "Milestones" props via ESPN's core odds API. A milestone is a
// one-sided "N+" bet (e.g. 10+ rebounds), so there's no over/under ambiguity.
// History: ESPN athlete game logs — this season first, topped up with last season
// (cached; it never changes) until there are 20 games.
/* eslint-disable @typescript-eslint/no-explicit-any -- ESPN responses are untyped JSON */
import type {
  NBAGame, NBAGameLogEntry, NBAPrevLogsCache, NBAPropRow, PropStat,
} from "@/types/nba";
import { getJson, mapLimit } from "./espnFetch";

const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba";
const DRAFTKINGS = "100";

const MARKETS: Record<string, PropStat> = {
  "Points Milestones": "PTS",
  "Rebounds Milestones": "REB",
  "Assists Milestones": "AST",
  "Steals Milestones": "STL",
  "Blocks Milestones": "BLK",
};
const STAT_FIELD: Record<PropStat, keyof NBAGameLogEntry> = {
  PTS: "pts", REB: "reb", AST: "ast", STL: "stl", BLK: "blk",
};

// Odds windows
export const HOT_ODDS = { min: -200, max: 200 } as const;
export const SAFE_ODDS = { min: -900, max: -400 } as const;
// Super Safe: at least this many games, and ≥80% over both the last 10 and last 20
export const SAFE_MIN_GAMES = 10;
export const SAFE_MIN_RATE = 0.8;
// Hot: streak length or edge over the book that qualifies on its own
export const HOT_MIN_STREAK = 5;
export const HOT_MIN_EDGE = 0.08;
export const HOT_MIN_L10 = 0.6;
// Blend of shrunk hit rates (sum = 1); each rate gets 2 phantom games at the book's price
export const RATE_WEIGHTS = { l5: 0.25, l10: 0.4, l20: 0.35 } as const;
const PHANTOM = 2;

const LOG_LEN = 20;

// ── Parsing ─────────────────────────────────────────────────────────────────
interface RawProp {
  athleteId: string;
  teamId: string | null;
  stat: PropStat;
  threshold: number;
  odds: number;
  updated: string;
}

const refId = (ref: string | undefined, kind: string) =>
  ref?.match(new RegExp(`/${kind}/(\\d+)`))?.[1] ?? null;

function parseOdds(v: unknown): number | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "EVEN" || s === "EV") return 100;
  const n = Number(s.replace("+", ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

const impliedProb = (o: number) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));

async function fetchGameProps(gameId: string): Promise<RawProp[]> {
  const base = `${CORE}/events/${gameId}/competitions/${gameId}/odds/${DRAFTKINGS}/propBets?lang=en&region=us&limit=1000`;
  const first = await getJson<any>(base);
  if (!first) return [];
  const pages = [first];
  const extra = Array.from({ length: Math.max(0, (first.pageCount ?? 1) - 1) }, (_, i) => i + 2);
  pages.push(...(await mapLimit(extra, 3, (p) => getJson<any>(`${base}&page=${p}`))).filter(Boolean));

  // Rungs per athlete + stat, in feed order
  const groups = new Map<string, RawProp[]>();
  for (const page of pages) {
    for (const it of page.items ?? []) {
      const stat = MARKETS[it.type?.name];
      if (!stat) continue;
      const athleteId = refId(it.athlete?.$ref, "athletes");
      const threshold = Number(it.current?.target?.value);
      const odds = parseOdds(it.odds?.american?.value);
      if (!athleteId || !Number.isFinite(threshold) || odds === null) continue;
      const key = `${athleteId}-${stat}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({
        athleteId, teamId: refId(it.team?.$ref, "teams"), stat, threshold, odds, updated: it.lastUpdated ?? "",
      });
    }
  }
  return [...groups.values()].flatMap(resolveLadder);
}

// ESPN sometimes files a partial-game ladder (e.g. 1st-quarter rebounds) under the
// same full-game market name. Split the feed into contiguous ladders, keep the one
// that crosses even money at the highest line (the full game), then fold in stray
// rungs only where their price fits that ladder monotonically.
function resolveLadder(rungs: RawProp[]): RawProp[] {
  const segments: RawProp[][] = [];
  for (const r of rungs) {
    const seg = segments[segments.length - 1];
    const prev = seg?.[seg.length - 1];
    if (prev && r.threshold > prev.threshold && impliedProb(r.odds) <= impliedProb(prev.odds)) seg.push(r);
    else segments.push([r]);
  }
  const fiftyPoint = (seg: RawProp[]) => {
    const fav = seg.filter((r) => impliedProb(r.odds) >= 0.5);
    return fav.length ? Math.max(...fav.map((r) => r.threshold)) : Math.min(...seg.map((r) => r.threshold)) - 0.5;
  };
  if (segments.length === 0) return [];
  // Prefer real ladders (3+ rungs) over stray single rungs
  const long = segments.filter((seg) => seg.length >= 3);
  const pool = long.length ? long : segments;
  const main = pool.reduce((best, seg) => (fiftyPoint(seg) > fiftyPoint(best) ? seg : best));

  const ladder = [...main];
  for (const seg of segments) {
    if (seg === main) continue;
    for (const r of seg) {
      const p = impliedProb(r.odds);
      const fits = ladder.every((m) =>
        m.threshold === r.threshold ? false : m.threshold < r.threshold ? impliedProb(m.odds) >= p : impliedProb(m.odds) <= p);
      if (fits) ladder.push(r);
    }
  }
  return ladder;
}

// Regular season, play-in and playoffs — never preseason. Newest first.
function parseGameLog(d: any): NBAGameLogEntry[] {
  if (!d) return [];
  const names: string[] = d.names ?? [];
  const idx = (n: string) => names.indexOf(n);
  const iMin = idx("minutes"), iPts = idx("points"), iReb = idx("totalRebounds"),
    iAst = idx("assists"), iStl = idx("steals"), iBlk = idx("blocks");
  const out: NBAGameLogEntry[] = [];
  const seen = new Set<string>();
  for (const st of d.seasonTypes ?? []) {
    if (/preseason/i.test(st.displayName ?? "")) continue;
    for (const cat of st.categories ?? []) {
      for (const e of cat.events ?? []) {
        const id = String(e.eventId);
        if (seen.has(id)) continue;
        const s: string[] = e.stats ?? [];
        const min = Number(s[iMin]) || 0;
        if (min <= 0) continue;
        seen.add(id);
        out.push({
          eventId: id,
          date: d.events?.[id]?.gameDate ?? "",
          min,
          pts: Number(s[iPts]) || 0,
          reb: Number(s[iReb]) || 0,
          ast: Number(s[iAst]) || 0,
          stl: Number(s[iStl]) || 0,
          blk: Number(s[iBlk]) || 0,
        });
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

const fetchLog = async (athleteId: string, season: number) =>
  parseGameLog(await getJson<any>(`${WEB}/athletes/${athleteId}/gamelog?season=${season}`));

// ── Build ───────────────────────────────────────────────────────────────────
export interface PropsContext {
  season: number;
  games: NBAGame[];
  names: Map<string, { name: string; teamId: string }>;
  injuries: Map<string, string>;     // athleteId → ESPN status
  isOut: (status: string | null | undefined) => boolean;
  prevLogs: NBAPrevLogsCache | null;
}

export async function buildNBAProps(ctx: PropsContext): Promise<{ props: NBAPropRow[]; prevLogs: NBAPrevLogsCache }> {
  const { season, games } = ctx;
  const prevLogs: NBAPrevLogsCache =
    ctx.prevLogs && ctx.prevLogs.season === season ? ctx.prevLogs : { season, logs: {} };
  const todayIds = new Set(games.map((g) => g.id));

  // Lines for games that haven't tipped (books pull pregame props at tip)
  const open = games.filter((g) => g.status === "STATUS_SCHEDULED");
  const perGame = await mapLimit(open, 4, async (g) => ({ game: g, props: await fetchGameProps(g.id) }));

  const inWindow = (o: number) =>
    (o >= HOT_ODDS.min && o <= HOT_ODDS.max) || (o >= SAFE_ODDS.min && o <= SAFE_ODDS.max);
  const athletes = [...new Set(perGame.flatMap((x) => x.props.filter((p) => inWindow(p.odds)).map((p) => p.athleteId)))]
    .filter((id) => !ctx.isOut(ctx.injuries.get(id)));

  // This season fresh every sync; last season only when needed and not cached
  const current = await mapLimit(athletes, 8, (id) => fetchLog(id, season));
  const logs = new Map<string, { entries: NBAGameLogEntry[]; prev: number }>();
  const needPrev = athletes.filter((id, i) => current[i].length < LOG_LEN && !(id in prevLogs.logs));
  const prevFetched = await mapLimit(needPrev, 8, (id) => fetchLog(id, season - 1));
  needPrev.forEach((id, i) => { prevLogs.logs[id] = prevFetched[i].slice(0, LOG_LEN); });
  athletes.forEach((id, i) => {
    const cur = current[i].filter((e) => !todayIds.has(e.eventId));
    const prev = cur.length < LOG_LEN ? (prevLogs.logs[id] ?? []).slice(0, LOG_LEN - cur.length) : [];
    logs.set(id, { entries: [...cur, ...prev].slice(0, LOG_LEN), prev: prev.length });
  });

  const rows: NBAPropRow[] = [];
  for (const { game, props } of perGame) {
    for (const p of props) {
      if (!inWindow(p.odds)) continue;
      const log = logs.get(p.athleteId);
      if (!log || log.entries.length === 0) continue;
      const who = ctx.names.get(p.athleteId);
      const teamId = p.teamId ?? who?.teamId;
      const isHome = teamId === game.home.id;
      if (teamId !== game.home.id && teamId !== game.away.id) continue;

      const field = STAT_FIELD[p.stat];
      const last = log.entries.map((e) => e[field] as number);
      const hit = last.map((v) => v >= p.threshold);
      const count = (n: number) => hit.slice(0, n).filter(Boolean).length;
      const nL5 = Math.min(5, last.length), nL10 = Math.min(10, last.length), nL20 = last.length;
      const hitsL5 = count(5), hitsL10 = count(10), hitsL20 = count(20);
      let streak = 0;
      while (streak < hit.length && hit[streak]) streak++;

      const implied = impliedProb(p.odds);
      const shrunk = (h: number, n: number) => (h + PHANTOM * implied) / (n + PHANTOM);
      const modelProb =
        RATE_WEIGHTS.l5 * shrunk(hitsL5, nL5) + RATE_WEIGHTS.l10 * shrunk(hitsL10, nL10) + RATE_WEIGHTS.l20 * shrunk(hitsL20, nL20);
      const edge = modelProb - implied;
      const rate10 = nL10 ? hitsL10 / nL10 : 0;
      const rate20 = nL20 ? hitsL20 / nL20 : 0;

      let category: NBAPropRow["category"] | null = null;
      const reasons: string[] = [];
      if (p.odds >= SAFE_ODDS.min && p.odds <= SAFE_ODDS.max) {
        if (nL20 >= SAFE_MIN_GAMES && rate10 >= SAFE_MIN_RATE && rate20 >= SAFE_MIN_RATE) {
          category = "safe";
          reasons.push(`Hit ${hitsL10}/${nL10} last 10, ${hitsL20}/${nL20} last 20`);
        }
      } else if (nL10 >= 5 && rate10 >= HOT_MIN_L10) {
        if (streak >= HOT_MIN_STREAK) reasons.push(`Hit ${streak} straight`);
        if (edge >= HOT_MIN_EDGE) reasons.push(`Hit rate ${Math.round(edge * 100)} pts above the book's price`);
        if (reasons.length) category = "hot";
      }
      if (!category) continue;

      const status = ctx.injuries.get(p.athleteId) ?? null;
      const l10 = log.entries.slice(0, 10);
      rows.push({
        key: `${p.athleteId}-${p.stat}-${p.threshold}`,
        category,
        athleteId: p.athleteId,
        name: who?.name ?? "Unknown",
        team: isHome ? game.home.abbr : game.away.abbr,
        opponent: isHome ? game.away.abbr : game.home.abbr,
        isHome,
        gameId: game.id,
        startTime: game.startTime,
        injuryStatus: status && !ctx.isOut(status) ? status : null,
        stat: p.stat, threshold: p.threshold, odds: p.odds, implied,
        last, prevSeasonGames: log.prev,
        hitsL5, nL5, hitsL10, nL10, hitsL20, nL20, streak,
        avgL10: l10.reduce((s, e) => s + (e[field] as number), 0) / (l10.length || 1),
        minL10: l10.reduce((s, e) => s + e.min, 0) / (l10.length || 1),
        modelProb, edge,
        hotScore: Math.round(edge * 100 + Math.min(streak, 10) * 2),
        reasons,
      });
    }
  }

  // One row per player-stat: Hot keeps its best-scoring rung, Safe its highest qualifying line
  const best = new Map<string, NBAPropRow>();
  for (const r of rows) {
    const k = `${r.category}-${r.athleteId}-${r.stat}`;
    const prev = best.get(k);
    const better = !prev ||
      (r.category === "safe" ? r.threshold > prev.threshold : r.hotScore > prev.hotScore);
    if (better) best.set(k, r);
  }

  const props = [...best.values()]
    .filter((r) => r.name !== "Unknown")
    .sort((a, b) => b.hotScore - a.hotScore);
  return { props, prevLogs };
}
