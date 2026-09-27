// Builds the weekly NFL snapshot.
// Sources (all free, no keys):
//  - ESPN scoreboard: schedule, venue, DraftKings spread/total
//  - ESPN depth charts: starters (OL/DL/LB/DB) and WR1/2/3 slots
//  - ESPN injuries feed: statuses + beat-reporter comments
//  - ESPN team news: headlines with bylines
//  - nflverse: weekly player stats, play-by-play (red zone + target depth), rosters (id mapping)
//  - Open-Meteo: game-time weather
/* eslint-disable @typescript-eslint/no-explicit-any -- ESPN / Open-Meteo responses are untyped JSON */
import { gunzipSync } from "node:zlib";
import type {
  NFLDailySnapshot, NFLGame, NFLInjury, NFLNewsItem, NFLPlayerMatchup,
  NFLPlayerUsage, NFLTeamRef, NFLWeather, DvpCategory, WRRole, SkillPos, DefenseVsPosition,
  NFLFlag, StarterAbsence, TeamTrenchReport,
} from "@/types/nfl";
import {
  type StatRow, normalizePos, classifyWR, buildDefenseVsPosition, shrunkYardsEdge,
  shrunkTdFactor, weatherImpact, unitForPosition, availabilityMult, tdModel,
  finalizeTeamTDs, matchupScoreFromEdge, parseReporter,
} from "./nflModel";
import { describeCode } from "./weather";
import {
  type DepthEntry, type RosterRow, type SnapRow, buildTrenchReports, unitWeight, describeAbsence,
  describeReplacement, normName,
} from "./nflStarters";

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_WEB  = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl";
const NFLVERSE  = "https://github.com/nflverse/nflverse-data/releases/download";

// ESPN ↔ nflverse abbreviation differences
const ESPN_TO_NFLVERSE: Record<string, string> = { WSH: "WAS", LAR: "LA" };
const toAbbr = (espnAbbr: string) => ESPN_TO_NFLVERSE[espnAbbr] ?? espnAbbr;

// All 32 ESPN team ids (used for depth charts so bye-week teams still classify WRs)
const ESPN_TEAM_IDS = [...Array.from({ length: 30 }, (_, i) => String(i + 1)), "33", "34"];

// Home stadium coordinates by nflverse abbreviation (neutral sites are geocoded)
const STADIUMS: Record<string, { lat: number; lng: number }> = {
  ARI: { lat: 33.5276, lng: -112.2626 }, ATL: { lat: 33.7554, lng: -84.4008 },
  BAL: { lat: 39.2780, lng: -76.6227 },  BUF: { lat: 42.7738, lng: -78.7870 },
  CAR: { lat: 35.2258, lng: -80.8528 },  CHI: { lat: 41.8623, lng: -87.6167 },
  CIN: { lat: 39.0955, lng: -84.5161 },  CLE: { lat: 41.5061, lng: -81.6995 },
  DAL: { lat: 32.7473, lng: -97.0945 },  DEN: { lat: 39.7439, lng: -105.0201 },
  DET: { lat: 42.3400, lng: -83.0456 },  GB:  { lat: 44.5013, lng: -88.0622 },
  HOU: { lat: 29.6847, lng: -95.4107 },  IND: { lat: 39.7601, lng: -86.1639 },
  JAX: { lat: 30.3239, lng: -81.6373 },  KC:  { lat: 39.0489, lng: -94.4839 },
  LV:  { lat: 36.0909, lng: -115.1833 }, LAC: { lat: 33.9535, lng: -118.3392 },
  LA:  { lat: 33.9535, lng: -118.3392 }, MIA: { lat: 25.9580, lng: -80.2389 },
  MIN: { lat: 44.9737, lng: -93.2575 },  NE:  { lat: 42.0909, lng: -71.2643 },
  NO:  { lat: 29.9511, lng: -90.0812 },  NYG: { lat: 40.8135, lng: -74.0745 },
  NYJ: { lat: 40.8135, lng: -74.0745 },  PHI: { lat: 39.9008, lng: -75.1675 },
  PIT: { lat: 40.4468, lng: -80.0158 },  SF:  { lat: 37.4030, lng: -121.9700 },
  SEA: { lat: 47.5952, lng: -122.3316 }, TB:  { lat: 27.9759, lng: -82.5033 },
  TEN: { lat: 36.1665, lng: -86.7713 },  WAS: { lat: 38.9076, lng: -76.8645 },
};

// ── Fetch helpers ───────────────────────────────────────────────────────────
async function getJson<T = any>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getText(url: string, gz = false): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    if (!gz) return await res.text();
    const buf = Buffer.from(await res.arrayBuffer());
    return gunzipSync(buf).toString("utf8");
  } catch {
    return null;
  }
}

async function batchFetch<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

// Minimal RFC-4180 CSV parser that only materializes the requested columns —
// play-by-play has ~370 columns and grows to ~100MB by season's end.
function parseCsv(text: string, wanted: string[]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  let i = 0;
  const n = text.length;

  const readRow = (): string[] | null => {
    if (i >= n) return null;
    const fields: string[] = [];
    let field = "";
    let inQuotes = false;
    while (i < n) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      // Quotes only open at the start of a field; mid-field quotes are literal
      if (ch === '"' && field === "") { inQuotes = true; i++; continue; }
      if (ch === ",") { fields.push(field); field = ""; i++; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        i++;
        break;
      }
      field += ch; i++;
    }
    fields.push(field);
    return fields;
  };

  const header = readRow();
  if (!header) return rows;
  const idx = wanted.map((w) => header.indexOf(w));

  while (i < n) {
    const r = readRow();
    if (!r || (r.length === 1 && r[0] === "")) continue;
    const obj: Record<string, string> = {};
    for (let k = 0; k < wanted.length; k++) obj[wanted[k]] = idx[k] >= 0 ? (r[idx[k]] ?? "") : "";
    rows.push(obj);
  }
  return rows;
}

const num = (s: string | undefined) => {
  const v = parseFloat(s ?? "");
  return Number.isFinite(v) ? v : 0;
};

// ── ESPN: scoreboard ────────────────────────────────────────────────────────
interface RawGame {
  id: string;
  date: string;
  status: string;
  home: NFLTeamRef;
  away: NFLTeamRef;
  venue: string;
  city: string;
  state: string;
  indoor: boolean;
  neutral: boolean;
  spread: number | null;
  total: number | null;
}

async function fetchScoreboard(week?: number): Promise<{ season: number; week: number; games: RawGame[] }> {
  const q = week ? `?week=${week}&seasontype=2` : "";
  const sb = await getJson(`${ESPN_SITE}/scoreboard${q}`);
  if (!sb) throw new Error("ESPN scoreboard unavailable");
  const games: RawGame[] = (sb.events ?? []).map((e: any) => {
    const c = e.competitions?.[0] ?? {};
    const team = (side: "home" | "away"): NFLTeamRef => {
      const t = (c.competitors ?? []).find((x: any) => x.homeAway === side) ?? {};
      return {
        abbr: toAbbr(t.team?.abbreviation ?? ""),
        espnId: String(t.team?.id ?? ""),
        name: t.team?.displayName ?? t.team?.abbreviation ?? "",
        record: t.records?.[0]?.summary,
      };
    };
    const odds = c.odds?.[0];
    return {
      id: String(e.id),
      date: e.date,
      status: e.status?.type?.name ?? "",
      home: team("home"),
      away: team("away"),
      venue: c.venue?.fullName ?? "",
      city: c.venue?.address?.city ?? "",
      state: c.venue?.address?.state ?? c.venue?.address?.country ?? "",
      indoor: !!c.venue?.indoor,
      neutral: !!c.neutralSite,
      spread: typeof odds?.spread === "number" ? odds.spread : null,
      total: typeof odds?.overUnder === "number" ? odds.overUnder : null,
    };
  });
  return { season: sb.season?.year, week: sb.week?.number, games };
}

// ── ESPN: depth charts ──────────────────────────────────────────────────────
interface TeamDepth {
  abbr: string;
  name: string;
  starters: Map<string, string>;   // espnId → slot label (LT, RCB, WR1, …)
  skillDepth: Map<string, string>; // espnId → "WR1" | "WR2" | "WR3" | "RB1" | "TE1" | "QB1" …
  wrKey: Map<string, string>;      // espnId → "wr1" | "wr2" | "wr3" (starters only)
  entries: DepthEntry[];           // every listed player, with ESPN's inline injury tag
}

async function fetchDepthChart(espnTeamId: string): Promise<TeamDepth | null> {
  const d = await getJson(`${ESPN_WEB}/teams/${espnTeamId}/depthcharts`);
  if (!d?.team) return null;
  const out: TeamDepth = {
    abbr: toAbbr(d.team.abbreviation),
    name: d.team.displayName,
    starters: new Map(),
    skillDepth: new Map(),
    wrKey: new Map(),
    entries: [],
  };
  for (const formation of d.depthchart ?? []) {
    const isSpecial = /special/i.test(formation.name ?? "");
    if (isSpecial) continue;
    for (const [key, p] of Object.entries<any>(formation.positions ?? {})) {
      const athletes: any[] = p.athletes ?? [];
      const label = (p.position?.abbreviation ?? key).toUpperCase();
      athletes.forEach((a, rank) => {
        const id = String(a.id ?? "");
        if (!id) return;
        out.entries.push({
          key, label, rank,
          name: a.displayName ?? "",
          injuryStatus: a.injuries?.[0]?.status ?? null,
        });
        if (rank === 0) {
          out.starters.set(id, key.startsWith("wr") ? key.toUpperCase() : label);
          if (key.startsWith("wr")) out.wrKey.set(id, key);
        }
        if (["qb", "rb", "te"].includes(key) && !out.skillDepth.has(id)) out.skillDepth.set(id, `${label}${rank + 1}`);
        if (key.startsWith("wr") && !out.skillDepth.has(id)) out.skillDepth.set(id, rank === 0 ? key.toUpperCase() : `${key.toUpperCase()} backup`);
      });
    }
  }
  return out;
}

// ── ESPN: injuries ──────────────────────────────────────────────────────────
function espnIdFromLinks(links: any[] | undefined): string {
  for (const l of links ?? []) {
    const m = /\/id\/(\d+)/.exec(l.href ?? "");
    if (m) return m[1];
  }
  return "";
}

async function fetchInjuries(depth: Map<string, TeamDepth>): Promise<NFLInjury[]> {
  const d = await getJson(`${ESPN_SITE}/injuries`);
  const out: NFLInjury[] = [];
  for (const team of d?.injuries ?? []) {
    for (const inj of team.injuries ?? []) {
      // ESPN keeps cleared players listed as "Active" with stat-line notes — skip them
      if ((inj.status ?? "") === "Active") continue;
      const a = inj.athlete ?? {};
      const abbr = toAbbr(a.team?.abbreviation ?? "");
      const espnId = espnIdFromLinks(a.links);
      const pos = a.position?.abbreviation ?? "";
      const slot = depth.get(abbr)?.starters.get(espnId) ?? null;
      out.push({
        espnId,
        name: a.displayName ?? "",
        team: abbr,
        position: pos,
        unit: unitForPosition(pos),
        status: inj.status ?? inj.type?.description ?? "",
        injury: inj.details?.type ?? null,
        returnDate: inj.details?.returnDate ?? null,
        isStarter: !!slot,
        depthSlot: slot,
        shortComment: inj.shortComment ?? null,
        longComment: inj.longComment ?? null,
        reporter: parseReporter(inj.shortComment ?? null),
        updated: inj.date ?? "",
        isRegularStarter: false, // set once snap-count regulars are known
        replacedBy: null,
        dropoff: null,
      });
    }
  }
  return out;
}

// ── ESPN: team news ─────────────────────────────────────────────────────────
const INJURY_NEWS_RE = /injur|questionable|doubtful|ruled out|\bout\b|practice|\bIR\b|injured reserve|return|limited|inactive|concussion|hamstring|ankle|knee|status/i;

async function fetchTeamNews(team: NFLTeamRef): Promise<NFLNewsItem[]> {
  const d = await getJson(`${ESPN_SITE}/news?team=${team.espnId}&limit=8`);
  return (d?.articles ?? [])
    .filter((a: any) => a.type !== "Media")
    .map((a: any) => {
      const text = `${a.headline ?? ""} ${a.description ?? ""}`;
      return {
        team: team.abbr,
        headline: a.headline ?? "",
        description: a.description ?? "",
        byline: a.byline ?? null,
        published: a.published ?? "",
        url: a.links?.web?.href ?? null,
        isInjuryRelated: INJURY_NEWS_RE.test(text),
      };
    });
}

// ── Weather ─────────────────────────────────────────────────────────────────
async function geocode(city: string): Promise<{ lat: number; lng: number } | null> {
  const d = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
  const r = d?.results?.[0];
  return r ? { lat: r.latitude, lng: r.longitude } : null;
}

async function fetchWeather(g: RawGame): Promise<NFLWeather> {
  if (g.indoor) return { indoor: true, ...weatherImpact({ indoor: true }) };
  const coords = (!g.neutral && STADIUMS[g.home.abbr]) || (g.city ? await geocode(g.city) : null);
  const unknown: NFLWeather = { indoor: false, impact: "none", passMult: 1, rushMult: 1, notes: ["Forecast unavailable"] };
  if (!coords) return unknown;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(coords.lat));
  url.searchParams.set("longitude", String(coords.lng));
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,windspeed_10m,windgusts_10m,weathercode");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("windspeed_unit", "mph");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("forecast_days", "8");
  url.searchParams.set("past_days", "7"); // Thursday games are already in the past by Sunday
  const d = (await getJson(url.toString())) ?? (await getJson(url.toString())); // one retry

  if (!d?.hourly?.time) return unknown;

  // Sample kickoff through end of the 3rd quarter and use the worst wind
  const times: string[] = d.hourly.time;
  const kick = g.date.slice(0, 13);
  const idx = times.findIndex((t) => t.startsWith(kick));
  if (idx < 0) return unknown;
  const span = [idx, idx + 1, idx + 2].filter((k) => k < times.length);
  const max = (arr: number[]) => Math.max(...span.map((k) => arr[k] ?? 0));

  const code = d.hourly.weathercode[idx];
  const { condition, icon } = describeCode(code);
  const base = {
    indoor: false,
    tempF: Math.round(d.hourly.temperature_2m[idx]),
    windMph: Math.round(max(d.hourly.windspeed_10m)),
    gustMph: Math.round(max(d.hourly.windgusts_10m ?? [])),
    precipChance: Math.round(max(d.hourly.precipitation_probability)),
    condition,
    icon,
  };
  return { ...base, ...weatherImpact(base) };
}

// ── Play-by-play aggregation ────────────────────────────────────────────────
interface Opp { targets: number; carries: number; rzTargets: number; rzCarries: number; i10Carries: number; airYards: number; middle: number; }
const emptyOpp = (): Opp => ({ targets: 0, carries: 0, rzTargets: 0, rzCarries: 0, i10Carries: 0, airYards: 0, middle: 0 });

interface PbpAgg {
  playerGame: Map<string, Map<string, Opp>>; // playerId → gameId → opps
  teamGame: Map<string, Opp>;                // `${gameId}|${team}` → opps
  teamTds: Map<string, { pass: number; rush: number; games: Set<string> }>;
}

function aggregatePbp(text: string | null): PbpAgg {
  const agg: PbpAgg = { playerGame: new Map(), teamGame: new Map(), teamTds: new Map() };
  if (!text) return agg;
  const rows = parseCsv(text, [
    "game_id", "season_type", "posteam", "play_type", "pass_location", "air_yards",
    "receiver_player_id", "rusher_player_id", "yardline_100", "two_point_attempt",
    "pass_touchdown", "rush_touchdown", "qb_kneel",
  ]);
  for (const r of rows) {
    if (r.season_type !== "REG" || !r.posteam || r.two_point_attempt === "1") continue;
    const team = r.posteam;
    const tdAgg = agg.teamTds.get(team) ?? { pass: 0, rush: 0, games: new Set<string>() };
    tdAgg.games.add(r.game_id);
    agg.teamTds.set(team, tdAgg);

    const isPass = r.play_type === "pass" && r.receiver_player_id;
    const isRun = r.play_type === "run" && r.rusher_player_id && r.qb_kneel !== "1";
    if (!isPass && !isRun) continue;
    if (r.pass_touchdown === "1") tdAgg.pass++;
    if (r.rush_touchdown === "1") tdAgg.rush++;

    const yl = num(r.yardline_100);
    const rz = yl > 0 && yl <= 20;
    const tKey = `${r.game_id}|${team}`;
    const t = agg.teamGame.get(tKey) ?? emptyOpp();
    agg.teamGame.set(tKey, t);

    const pid = isPass ? r.receiver_player_id : r.rusher_player_id;
    const byGame = agg.playerGame.get(pid) ?? new Map<string, Opp>();
    agg.playerGame.set(pid, byGame);
    const p = byGame.get(r.game_id) ?? emptyOpp();
    byGame.set(r.game_id, p);

    for (const o of [t, p]) {
      if (isPass) {
        o.targets++;
        if (rz) o.rzTargets++;
      } else {
        o.carries++;
        if (rz) o.rzCarries++;
        if (yl > 0 && yl <= 10) o.i10Carries++;
      }
    }
    if (isPass) {
      p.airYards += num(r.air_yards);
      if (r.pass_location === "middle") p.middle++;
    }
  }
  return agg;
}

// ── Main builder ────────────────────────────────────────────────────────────
export async function buildNFLSnapshot(opts: { week?: number } = {}): Promise<NFLDailySnapshot> {
  const sb = await fetchScoreboard(opts.week);
  const { season, week } = sb;

  const [statsText, pbpText, rosterText, snapText, priorSnapText, depthList] = await Promise.all([
    getText(`${NFLVERSE}/stats_player/stats_player_week_${season}.csv`),
    getText(`${NFLVERSE}/pbp/play_by_play_${season}.csv.gz`, true),
    getText(`${NFLVERSE}/rosters/roster_${season}.csv`),
    getText(`${NFLVERSE}/snap_counts/snap_counts_${season}.csv`),
    getText(`${NFLVERSE}/snap_counts/snap_counts_${season - 1}.csv`),
    batchFetch(ESPN_TEAM_IDS, 8, fetchDepthChart),
  ]);
  if (!statsText) throw new Error("nflverse weekly stats unavailable");

  const depth = new Map<string, TeamDepth>();
  for (const d of depthList) if (d) depth.set(d.abbr, d);

  const teamsThisWeek = sb.games.flatMap((g) => [g.home, g.away]);
  const [injuries, newsLists, weatherList] = await Promise.all([
    fetchInjuries(depth),
    batchFetch(teamsThisWeek, 8, fetchTeamNews),
    batchFetch(sb.games, 8, fetchWeather),
  ]);

  // ── Stats rows (completed games only; nflverse only publishes finals)
  const statRows: StatRow[] = parseCsv(statsText, [
    "player_id", "player_display_name", "position", "team", "opponent_team", "game_id", "week",
    "season_type", "targets", "receptions", "receiving_yards", "receiving_tds", "carries",
    "rushing_yards", "rushing_tds", "attempts", "passing_yards", "passing_tds", "headshot_url",
  ])
    .filter((r) => r.season_type === "REG" && num(r.week) <= week)
    .map((r) => ({
      playerId: r.player_id,
      name: r.player_display_name,
      position: r.position,
      team: r.team,
      opp: r.opponent_team,
      gameId: r.game_id,
      week: num(r.week),
      targets: num(r.targets),
      receptions: num(r.receptions),
      recYds: num(r.receiving_yards),
      recTds: num(r.receiving_tds),
      carries: num(r.carries),
      rushYds: num(r.rushing_yards),
      rushTds: num(r.rushing_tds),
      attempts: num(r.attempts),
      passYds: num(r.passing_yards),
      passTds: num(r.passing_tds),
      headshot: r.headshot_url || null,
    }));
  const weeksOfData = new Set(statRows.map((r) => r.week)).size;

  const pbp = aggregatePbp(pbpText);

  // ── Roster: gsis → espn id / status (latest week row wins)
  const roster = new Map<string, { espnId: string; team: string; status: string; week: number; name: string; yearsExp: number | null }>();
  if (rosterText) {
    for (const r of parseCsv(rosterText, ["gsis_id", "espn_id", "team", "status", "week", "full_name", "years_exp"])) {
      if (!r.gsis_id) continue;
      const prev = roster.get(r.gsis_id);
      if (!prev || num(r.week) >= prev.week) {
        roster.set(r.gsis_id, {
          espnId: r.espn_id, team: r.team, status: r.status, week: num(r.week),
          name: r.full_name, yearsExp: r.years_exp === "" ? null : num(r.years_exp),
        });
      }
    }
  }

  // ── Trenches: regular starters by snap share, who's missing, who replaces them
  const snapRows: SnapRow[] = [];
  for (const [text, yr] of [[snapText, season], [priorSnapText, season - 1]] as const) {
    if (!text) continue;
    for (const r of parseCsv(text, ["pfr_player_id", "player", "team", "position", "game_type", "offense_pct", "defense_pct"])) {
      if (r.game_type !== "REG") continue;
      const unit = unitForPosition(r.position);
      snapRows.push({
        pfrId: r.pfr_player_id, name: r.player, team: r.team, position: r.position, season: yr,
        pct: unit === "OL" ? num(r.offense_pct) : num(r.defense_pct),
      });
    }
  }
  const rosterRows: RosterRow[] = [...roster.values()].map((r) => ({
    name: r.name, team: r.team, status: r.status, yearsExp: r.yearsExp,
  }));
  const { reports: trenchReports, regulars, absences } = buildTrenchReports({
    season,
    snaps: snapRows,
    roster: rosterRows,
    depth: new Map([...depth.values()].map((d) => [d.abbr, d.entries])),
    feed: injuries,
  });
  const absenceByKey = new Map(absences.map((a) => [`${a.team}|${normName(a.name)}`, a]));
  for (const inj of injuries) {
    const k = `${inj.team}|${normName(inj.name)}`;
    inj.isRegularStarter = regulars.has(k);
    if (inj.isRegularStarter) inj.isStarter = true;
    const a = absenceByKey.get(k);
    if (a) {
      inj.replacedBy = a.replacement ? describeReplacement(a.replacement) : null;
      inj.dropoff = a.dropoff;
      inj.depthSlot = inj.depthSlot ?? a.position;
    }
    absenceByKey.delete(k);
  }
  // Regular starters missing but absent from the weekly report (typically IR) — add them
  for (const a of absenceByKey.values()) {
    injuries.push({
      espnId: "",
      name: a.name,
      team: a.team,
      position: a.position,
      unit: a.unit,
      status: a.status,
      injury: a.injury,
      returnDate: null,
      isStarter: true,
      depthSlot: a.position,
      shortComment: `Regular starter (${Math.round(a.snapPct * 100)}% of snaps) not on this week's injury report — listed as ${a.status} via ${a.source}.`,
      longComment: null,
      reporter: null,
      updated: "",
      isRegularStarter: true,
      replacedBy: a.replacement ? describeReplacement(a.replacement) : null,
      dropoff: a.dropoff,
    });
  }
  const emptyReport: TeamTrenchReport = { OL: [], DL: [], LB: [], DB: [] };
  const trench = (t: string) => trenchReports.get(t) ?? emptyReport;
  const names = (list: StarterAbsence[]) => list.map((a) => `${a.position} ${a.name}`).join(", ");

  // ── Per-player season aggregates
  interface Agg { rows: StatRow[]; pos: SkillPos; }
  const byPlayer = new Map<string, Agg>();
  for (const r of statRows) {
    const pos = normalizePos(r.position);
    if (!pos) continue;
    const a = byPlayer.get(r.playerId) ?? { rows: [], pos };
    a.rows.push(r);
    byPlayer.set(r.playerId, a);
  }

  const usageOf = (playerId: string, rows: StatRow[]): NFLPlayerUsage => {
    const g = rows.length || 1;
    const sum = (k: keyof StatRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
    // Shares only over games the player actually played
    const pg = pbp.playerGame.get(playerId) ?? new Map<string, Opp>();
    const mine = emptyOpp(), team = emptyOpp();
    for (const r of rows) {
      const p = pg.get(r.gameId);
      const t = pbp.teamGame.get(`${r.gameId}|${r.team}`);
      if (p) for (const k of Object.keys(mine) as (keyof Opp)[]) mine[k] += p[k];
      if (t) for (const k of Object.keys(team) as (keyof Opp)[]) team[k] += t[k];
    }
    const share = (a: number, b: number) => (b > 0 ? a / b : 0);
    // i10 carries count double in red-zone share — goal-line work is where TDs happen
    const rzW = mine.rzCarries + mine.i10Carries;
    const rzTeamW = team.rzCarries + team.i10Carries;
    return {
      games: rows.length,
      targetsPg: sum("targets") / g,
      receptionsPg: sum("receptions") / g,
      recYdsPg: sum("recYds") / g,
      carriesPg: sum("carries") / g,
      rushYdsPg: sum("rushYds") / g,
      passYdsPg: sum("passYds") / g,
      recTds: sum("recTds"),
      rushTds: sum("rushTds"),
      passTds: sum("passTds"),
      targetShare: share(mine.targets, team.targets),
      carryShare: share(mine.carries, team.carries),
      rzTargets: mine.rzTargets,
      rzCarries: mine.rzCarries,
      i10Carries: mine.i10Carries,
      rzTargetShare: share(mine.rzTargets, team.rzTargets),
      rzCarryShare: share(rzW, rzTeamW),
      teamRzTargets: team.rzTargets,
      teamRzCarries: rzTeamW,
      adot: mine.targets > 0 ? mine.airYards / mine.targets : null,
      middleShare: mine.targets > 0 ? mine.middle / mine.targets : null,
    };
  };

  // ── WR roles (all WRs league-wide so defense splits are complete)
  const usageCache = new Map<string, NFLPlayerUsage>();
  const roleCache = new Map<string, { role: WRRole; signals: string }>();
  for (const [pid, a] of byPlayer) {
    const u = usageOf(pid, a.rows);
    usageCache.set(pid, u);
    if (a.pos !== "WR") continue;
    const latestTeam = a.rows[a.rows.length - 1].team;
    const espnId = roster.get(pid)?.espnId ?? "";
    roleCache.set(pid, classifyWR({
      espnDepthKey: depth.get(latestTeam)?.wrKey.get(espnId) ?? null,
      adot: u.adot,
      middleShare: u.middleShare,
      targets: Math.round(u.targetsPg * u.games),
    }));
  }

  // ── Defense vs position
  const teamNames: Record<string, string> = {};
  for (const d of depth.values()) teamNames[d.abbr] = d.name;
  const opponentThisWeek: Record<string, string> = {};
  for (const g of sb.games) { opponentThisWeek[g.home.abbr] = g.away.abbr; opponentThisWeek[g.away.abbr] = g.home.abbr; }
  const { defense, leagueAvg } = buildDefenseVsPosition(
    statRows, (pid) => roleCache.get(pid)?.role ?? null, teamNames, opponentThisWeek,
  );
  const defByTeam = new Map<string, DefenseVsPosition>(defense.map((d) => [d.team, d]));

  // ── Injury lookups
  const injByEspn = new Map<string, NFLInjury>();
  for (const inj of injuries) if (inj.espnId) injByEspn.set(inj.espnId, inj);
  // Starters likely to sit (Questionable players usually play — they only affect the weights)
  const likelyOut = (list: StarterAbsence[]) => list.filter((a) => a.status !== "Questionable");

  // ── Games
  const games: NFLGame[] = sb.games.map((g, gi) => {
    const homeImplied = g.total != null && g.spread != null ? g.total / 2 - g.spread / 2 : null;
    const awayImplied = g.total != null && g.spread != null ? g.total / 2 + g.spread / 2 : null;
    const weather = weatherList[gi];
    const notes: string[] = [];
    for (const [side, opp] of [[g.home.abbr, g.away.abbr], [g.away.abbr, g.home.abbr]] as const) {
      const t = trench(side);
      const ol = likelyOut(t.OL);
      if (ol.length) notes.push(`${side} offensive line without ${ol.map(describeAbsence).join("; ")}. Expect a tougher day for ${side} runners and more pressure on the ${side} QB from the ${opp} pass rush.`);
      const front = likelyOut([...t.DL, ...t.LB]);
      if (front.length) notes.push(`${side} run defense without ${front.map(describeAbsence).join("; ")}. Upgrade ${opp} running backs.`);
      const db = likelyOut(t.DB);
      if (db.length) notes.push(`${side} secondary without ${db.map(describeAbsence).join("; ")}. Upgrade ${opp} receivers and tight ends.`);
    }
    if (weather.impact === "moderate" || weather.impact === "major") notes.push(...weather.notes);
    return {
      id: g.id,
      startTimeUTC: g.date,
      status: g.status,
      home: g.home,
      away: g.away,
      venue: g.venue,
      city: [g.city, g.state].filter(Boolean).join(", "),
      indoor: g.indoor,
      spread: g.spread,
      total: g.total,
      homeImplied,
      awayImplied,
      weather,
      trenches: { home: trench(g.home.abbr), away: trench(g.away.abbr) },
      notes,
    };
  });
  const gameByTeam = new Map<string, { game: NFLGame; isHome: boolean }>();
  for (const g of games) {
    gameByTeam.set(g.home.abbr, { game: g, isHome: true });
    gameByTeam.set(g.away.abbr, { game: g, isHome: false });
  }

  // ── Player matchups
  const players: NFLPlayerMatchup[] = [];
  for (const [pid, a] of byPlayer) {
    const r = roster.get(pid);
    if (r && ["CUT", "RET"].includes(r.status)) continue;
    const team = r?.team && r.status !== "RES" ? r.team : a.rows[a.rows.length - 1].team;
    const gm = gameByTeam.get(team);
    if (!gm) continue; // bye week
    const u = usageCache.get(pid)!;
    const relevant = a.pos === "QB" ? u.passYdsPg >= 60 || u.carriesPg >= 2 : u.targetsPg + u.carriesPg >= 1.5;
    if (!relevant) continue;

    const { game, isHome } = gm;
    const opp = isHome ? game.away.abbr : game.home.abbr;
    const def = defByTeam.get(opp);
    const espnId = r?.espnId || null;
    const inj = espnId ? injByEspn.get(espnId) : undefined;
    const injuryStatus = inj?.status ?? (r?.status === "RES" ? "Injured Reserve" : null);
    const role = a.pos === "WR" ? roleCache.get(pid) ?? null : null;
    const avail = availabilityMult(injuryStatus);

    // Primary/secondary defensive bucket
    let primary: DvpCategory, secondary: DvpCategory | null = null;
    if (a.pos === "WR") { primary = role?.role === "SLOT" ? "WR_SLOT_REC" : "WR_WIDE_REC"; secondary = "WR_REC"; }
    else if (a.pos === "TE") primary = "TE_REC";
    else if (a.pos === "RB") {
      primary = u.rushYdsPg >= u.recYdsPg ? "RB_RUSH" : "RB_REC";
      secondary = primary === "RB_RUSH" ? "RB_REC" : "RB_RUSH";
    } else { primary = "QB_RUSH"; secondary = "QB_PASS"; }

    const cell = (c: DvpCategory) => def?.cells[c];
    const recCat: DvpCategory | null = a.pos === "QB" ? null : a.pos === "RB" ? "RB_REC" : primary;
    const rushCat: DvpCategory | null = a.pos === "RB" ? "RB_RUSH" : a.pos === "QB" ? "QB_RUSH" : null;
    const recEdge = recCat ? shrunkYardsEdge(cell(recCat)) : 0;
    const rushEdge = rushCat ? shrunkYardsEdge(cell(rushCat)) : 0;

    // Opponent + own-team injury context
    // Effective starters lost: weighted by chance they sit and how big the backup drop-off is
    const ownT = trench(team), oppT = trench(opp);
    const ownOL = unitWeight(ownT, ["OL"]);
    const oppFront = unitWeight(oppT, ["DL", "LB"]);
    const oppDB = unitWeight(oppT, ["DB"]);
    const w = game.weather;

    const projRecYds = u.recYdsPg * (1 + recEdge) * w.passMult * (1 + Math.min(0.12, 0.03 * oppDB)) * avail;
    const projRushYds = u.rushYdsPg * (1 + rushEdge) * w.rushMult * (1 - Math.min(0.15, 0.04 * ownOL)) * (1 + Math.min(0.12, 0.03 * oppFront)) * avail;

    // Yardage-weighted edge for dual-threat roles
    const totalYds = u.recYdsPg + u.rushYdsPg;
    const edge = a.pos === "QB"
      ? rushEdge
      : totalYds > 0 ? (u.recYdsPg * recEdge + u.rushYdsPg * rushEdge) / totalYds : shrunkYardsEdge(cell(primary));
    const injuryBump =
      (a.pos === "RB" || a.pos === "QB" ? 3 * oppFront - 4 * ownOL : 0) +
      (a.pos === "WR" || a.pos === "TE" ? 3 * oppDB - 2 * ownOL : 0);

    const tdTeam = pbp.teamTds.get(team);
    const tdTotal = (tdTeam?.pass ?? 0) + (tdTeam?.rush ?? 0);
    const td = tdModel({
      position: a.pos,
      teamImplied: isHome ? game.homeImplied : game.awayImplied,
      teamPassTdShare: tdTotal > 0 ? tdTeam!.pass / tdTotal : null,
      teamGames: tdTeam?.games.size ?? 0,
      carryShare: u.carryShare,
      rzCarryShare: u.rzCarryShare,
      targetShare: u.targetShare,
      rzTargetShare: u.rzTargetShare,
      teamRzCarries: u.teamRzCarries,
      teamRzTargets: u.teamRzTargets,
      defRushFactor: rushCat ? shrunkTdFactor(cell(rushCat)) : 1,
      defRecFactor: recCat ? shrunkTdFactor(cell(recCat)) : 1,
      weather: w,
      olStartersOut: ownOL,
      oppFrontStartersOut: oppFront,
      oppSecondaryStartersOut: oppDB,
      olNames: names(ownT.OL),
      oppFrontNames: names([...oppT.DL, ...oppT.LB]),
      oppSecondaryNames: names(oppT.DB),
      availability: avail,
    });

    const flags: NFLFlag[] = [];
    // One absence → name it ("LG Dickerson out (IR)"); several → count them
    const count = (list: StarterAbsence[]) => {
      if (list.length === 1) {
        const a = list[0];
        const last = a.name.split(" ").slice(1).join(" ") || a.name;
        const st = a.status === "Questionable" ? "questionable" : a.status === "Doubtful" ? "doubtful"
          : /reserve/i.test(a.status) ? "out (IR)" : "out";
        return `${a.position} ${last} ${st}`;
      }
      const out = likelyOut(list).length, q = list.length - out;
      return [out ? `${out} starters out` : "", q ? `${q} questionable` : ""].filter(Boolean).join(", ");
    };
    const detail = (list: StarterAbsence[]) => list.map(describeAbsence).join("\n");
    const runner = a.pos === "RB" || a.pos === "QB";
    if (ownT.OL.length) flags.push({
      text: `Own OL: ${count(ownT.OL)}`,
      detail: `${team} blocking is weakened — ${detail(ownT.OL)}`,
      tone: "bad",
    });
    const front = [...oppT.DL, ...oppT.LB];
    if (runner && front.length) flags.push({
      text: `${opp} run D: ${count(front)}`,
      detail: `Easier running lanes — ${detail(front)}`,
      tone: "good",
    });
    if (!runner && oppT.DB.length) flags.push({
      text: `${opp} secondary: ${count(oppT.DB)}`,
      detail: `Weaker coverage — ${detail(oppT.DB)}`,
      tone: "good",
    });
    if (!w.indoor && (w.windMph ?? 0) >= 15) flags.push({
      text: `Wind ${w.windMph} mph`,
      detail: `${w.condition ?? ""}, gusts ${w.gustMph ?? "?"} mph. Wind 15+ mph cuts passing efficiency and deep-ball accuracy${runner ? "; slightly favors the run game" : ""}.`,
      tone: runner ? "neutral" : "bad",
    });
    const cond = (w.condition ?? "").toLowerCase();
    if (!w.indoor && (w.precipChance ?? 0) >= 60 && /rain|shower|drizzle|thunder|snow/.test(cond)) flags.push({
      text: /snow/.test(cond) ? "Snow likely" : "Rain likely",
      detail: `${w.precipChance}% chance of ${w.condition?.toLowerCase()} — slick ball, more fumbles, fewer deep passes.`,
      tone: runner ? "neutral" : "bad",
    });
    if (w.indoor) flags.push({ text: "Indoors", detail: "Dome or closed roof — weather is not a factor.", tone: "neutral" });

    const primaryCell = cell(primary);
    players.push({
      id: pid,
      espnId,
      name: a.rows[a.rows.length - 1].name,
      team,
      opponent: opp,
      gameId: game.id,
      isHome,
      position: a.pos,
      wrRole: role?.role ?? null,
      wrRoleSignals: role?.signals ?? null,
      headshot: a.rows[a.rows.length - 1].headshot,
      depthLabel: espnId ? depth.get(team)?.skillDepth.get(espnId) ?? null : null,
      injuryStatus,
      injuryNote: inj?.shortComment ?? null,
      usage: u,
      primaryCategory: primary,
      secondaryCategory: secondary,
      matchupEdge: edge,
      matchupScore: matchupScoreFromEdge(edge, injuryBump),
      defRankPrimary: primaryCell?.yardsRank ?? 16,
      defAllowedPg: primaryCell?.yardsPg ?? 0,
      leagueAvgPg: leagueAvg[primary].yardsPg,
      projYards: primary.endsWith("_RUSH") ? projRushYds : projRecYds,
      projRecYds,
      projRushYds,
      // Set by finalizeTeamTDs once every teammate's raw λ is known
      tdProb: 0,
      tdScore: 0,
      tdFairOdds: "—",
      td,
      flags,
    });
  }
  finalizeTeamTDs(players);
  players.sort((a, b) => b.tdProb - a.tdProb);

  // Relevant injuries only: teams playing this week, skill positions + lines + starters
  const playing = new Set(teamsThisWeek.map((t) => t.abbr));
  const relevantInjuries = injuries.filter((i) =>
    playing.has(i.team) && (["QB", "RB", "WR", "TE", "OL"].includes(i.unit) || i.isStarter || i.isRegularStarter));

  return {
    season,
    week,
    syncedAt: new Date().toISOString(),
    weeksOfData,
    games,
    players,
    defense,
    leagueAvg,
    injuries: relevantInjuries,
    news: newsLists.flat().sort((a, b) => b.published.localeCompare(a.published)),
  };
}
