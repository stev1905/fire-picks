// Who normally starts in the trenches, who's missing, and who replaces them.
//
// The ESPN depth chart alone isn't enough: once a starter goes on IR, ESPN
// reshuffles the chart (the backup becomes "the starter") and the player drops
// off the weekly injury report. So we define regular starters by snap share
// (this season + last) and check availability against three sources.
import type {
  LineUnit, NFLInjury, Replacement, StarterAbsence, TeamTrenchReport,
} from "@/types/nfl";
import { isMissing, unitForPosition } from "./nflModel";

export interface SnapRow {
  pfrId: string;
  name: string;
  team: string;
  position: string;
  season: number;
  pct: number;               // offense_pct for OL, defense_pct for defenders
}

export interface RosterRow {
  name: string;
  team: string;
  status: string;            // nflverse: ACT, RES (IR/PUP/NFI/suspended), INA, CUT…
  yearsExp: number | null;
}

export interface DepthEntry {
  key: string;               // ESPN position key: lt, lg, c, lde, nb…
  label: string;             // LT, LG, C, LDE, NB…
  rank: number;              // 0 = first on the chart
  name: string;
  injuryStatus: string | null; // ESPN's inline tag (includes IR, which the weekly report omits)
}

export const LINE_UNITS: LineUnit[] = ["OL", "DL", "LB", "DB"];
const STARTERS_PER_UNIT: Record<LineUnit, number> = { OL: 5, DL: 4, LB: 3, DB: 5 };
// Share of snaps (blended) to count as a regular
const REGULAR_THRESHOLD = 0.55;
// Last season's games count half as much as this season's
const PRIOR_SEASON_WEIGHT = 0.5;

export function normName(n: string): string {
  return n
    .toLowerCase()
    .replace(/[.'’,]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const teamKey = (team: string, name: string) => `${team}|${normName(name)}`;

function isLineUnit(u: string): u is LineUnit {
  return (LINE_UNITS as string[]).includes(u);
}

// Reserve-list players (IR, PUP, NFI, suspended) show as RES in nflverse rosters
function rosterStatusLabel(status: string): string | null {
  return status === "RES" ? "Reserve list (IR/PUP)" : null;
}

function dropoffFor(r: Replacement | null): StarterAbsence["dropoff"] {
  if (!r) return "moderate";
  if (r.priorStarts >= 12) return "minor";
  if (r.priorStarts >= 4) return "moderate";
  return "major";
}

const DROPOFF_WEIGHT: Record<StarterAbsence["dropoff"], number> = { major: 1, moderate: 0.7, minor: 0.4 };

// How likely the player sits, by designation
function sitProbability(status: string): number {
  if (isMissing(status) || status.startsWith("Reserve")) return 1;
  if (status === "Doubtful") return 0.8;
  if (status === "Questionable") return 0.3;
  return 0;
}

export function describeReplacement(r: Replacement): string {
  const bits = [
    r.slot,
    r.yearsExp === 0 ? "rookie" : r.yearsExp != null ? `${r.yearsExp} yr exp` : null,
    `${r.priorStarts} start${r.priorStarts === 1 ? "" : "s"} since last season`,
  ].filter(Boolean);
  return `${r.name} (${bits.join(" · ")})`;
}

export function buildTrenchReports(input: {
  season: number;
  snaps: SnapRow[];
  roster: RosterRow[];
  depth: Map<string, DepthEntry[]>;
  feed: NFLInjury[];
}): { reports: Map<string, TeamTrenchReport>; regulars: Set<string>; absences: StarterAbsence[] } {
  const { season, snaps, roster, depth, feed } = input;

  const rosterByKey = new Map<string, RosterRow>();
  const teamsByName = new Map<string, Set<string>>();
  for (const r of roster) {
    rosterByKey.set(teamKey(r.team, r.name), r);
    const n = normName(r.name);
    (teamsByName.get(n) ?? teamsByName.set(n, new Set()).get(n)!).add(r.team);
  }

  const feedByKey = new Map<string, NFLInjury>();
  for (const f of feed) feedByKey.set(teamKey(f.team, f.name), f);

  // Snap history per player (pfr id is stable across team changes)
  interface Hist { name: string; unit: LineUnit; cur: number[]; prior: number[]; starts: number; teams: Set<string>; }
  const hist = new Map<string, Hist>();
  for (const s of snaps) {
    const unit = unitForPosition(s.position);
    if (!isLineUnit(unit)) continue;
    const h = hist.get(s.pfrId) ?? { name: s.name, unit, cur: [], prior: [], starts: 0, teams: new Set<string>() };
    if (s.season === season) { h.cur.push(s.pct); h.teams.add(s.team); } else h.prior.push(s.pct);
    if (s.pct >= 0.5) h.starts++;
    hist.set(s.pfrId, h);
  }

  // Current team comes from the roster (handles offseason moves); fall back to this season's snaps
  const byTeamUnit = new Map<string, { name: string; score: number; starts: number }[]>();
  const startsByKey = new Map<string, number>();
  for (const h of hist.values()) {
    const rosterTeams = [...(teamsByName.get(normName(h.name)) ?? [])];
    const team = rosterTeams.find((t) => h.teams.has(t)) ?? rosterTeams[0] ?? [...h.teams][0];
    if (!team) continue;
    const r = rosterByKey.get(teamKey(team, h.name));
    if (r && ["CUT", "RET"].includes(r.status)) continue;
    startsByKey.set(teamKey(team, h.name), h.starts);

    const sum = h.cur.reduce((a, b) => a + b, 0) + PRIOR_SEASON_WEIGHT * h.prior.reduce((a, b) => a + b, 0);
    const n = h.cur.length + PRIOR_SEASON_WEIGHT * h.prior.length;
    if (n === 0) continue;
    const k = `${team}|${h.unit}`;
    const list = byTeamUnit.get(k) ?? [];
    list.push({ name: h.name, score: sum / n, starts: h.starts });
    byTeamUnit.set(k, list);
  }

  const regulars = new Set<string>();
  const reports = new Map<string, TeamTrenchReport>();
  const absences: StarterAbsence[] = [];
  const teams = new Set([...depth.keys()]);

  for (const team of teams) {
    const report: TeamTrenchReport = { OL: [], DL: [], LB: [], DB: [] };
    const chart = depth.get(team) ?? [];

    for (const unit of LINE_UNITS) {
      const qualified = (byTeamUnit.get(`${team}|${unit}`) ?? [])
        .filter((p) => p.score >= REGULAR_THRESHOLD)
        .sort((a, b) => b.score - a.score);
      const regs = qualified.slice(0, STARTERS_PER_UNIT[unit]);
      // Anyone above the snap threshold is established, not a fill-in — even past the top-N cut
      const regKeys = new Set(qualified.map((p) => normName(p.name)));
      regs.forEach((p) => regulars.add(teamKey(team, p.name)));

      // Current first-string players at this unit who aren't regulars = the fill-ins
      const unitChart = chart.filter((e) => unitForPosition(e.label) === unit);
      const fillIns = unitChart
        .filter((e) => e.rank === 0 && !regKeys.has(normName(e.name)))
        .filter((e, i, arr) => arr.findIndex((x) => normName(x.name) === normName(e.name)) === i);
      const used = new Set<string>();

      for (const p of regs) {
        const key = teamKey(team, p.name);
        const f = feedByKey.get(key);
        const chartEntry = unitChart.find((e) => normName(e.name) === normName(p.name) && e.injuryStatus);
        const rosterRow = rosterByKey.get(key);

        let status: string | null = null;
        let source: StarterAbsence["source"] = "injury report";
        if (f && sitProbability(f.status) > 0) status = f.status;
        else if (chartEntry?.injuryStatus && sitProbability(chartEntry.injuryStatus) > 0) { status = chartEntry.injuryStatus; source = "depth chart"; }
        else if (rosterRow && rosterStatusLabel(rosterRow.status)) { status = rosterStatusLabel(rosterRow.status); source = "roster (reserve list)"; }
        if (!status) continue;

        // Prefer the fill-in at this player's own chart spot, else the next unused fill-in
        const ownKey = unitChart.find((e) => normName(e.name) === normName(p.name))?.key;
        const pick =
          fillIns.find((e) => e.key === ownKey && !used.has(e.name)) ??
          fillIns.find((e) => !used.has(e.name));
        // Questionable players usually play — only name a replacement if they're likely out
        let replacement: Replacement | null = null;
        if (pick && sitProbability(status) >= 0.8) {
          used.add(pick.name);
          replacement = {
            name: pick.name,
            slot: pick.label,
            yearsExp: rosterByKey.get(teamKey(team, pick.name))?.yearsExp ?? null,
            priorStarts: startsByKey.get(teamKey(team, pick.name)) ?? 0,
          };
        }
        const dropoff = dropoffFor(replacement);
        const absence: StarterAbsence = {
          name: p.name,
          team,
          unit,
          position: unitChart.find((e) => normName(e.name) === normName(p.name))?.label ?? unit,
          status,
          injury: f?.injury ?? null,
          snapPct: p.score,
          source,
          replacement,
          dropoff,
          weight: DROPOFF_WEIGHT[dropoff] * sitProbability(status),
          note: f?.shortComment ?? null,
        };
        report[unit].push(absence);
        absences.push(absence);
      }
    }
    reports.set(team, report);
  }

  return { reports, regulars, absences };
}

export function unitWeight(r: TeamTrenchReport | undefined, units: LineUnit[]): number {
  if (!r) return 0;
  return units.reduce((s, u) => s + r[u].reduce((a, x) => a + x.weight, 0), 0);
}

// "LG Landon Dickerson (IR) → Drew Kendall (C · 1 yr exp · 3 starts since last season)"
export function describeAbsence(a: StarterAbsence): string {
  const status = a.status.startsWith("Injured Reserve") || a.status.startsWith("Reserve") ? "IR" : a.status;
  const head = `${a.position} ${a.name} (${status})`;
  return a.replacement ? `${head} → ${describeReplacement(a.replacement)}` : head;
}
