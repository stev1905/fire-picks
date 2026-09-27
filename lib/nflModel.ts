// Pure NFL model math — no fetching. Used by lib/nflApi.ts during sync.
import type {
  DvpCategory, DvpCell, DvpLine, DefenseVsPosition, NFLWeather,
  WRRole, TDBreakdown, NFLInjury, SkillPos, NFLPlayerMatchup,
} from "@/types/nfl";

export const DVP_CATEGORIES: DvpCategory[] = [
  "WR_SLOT_REC", "WR_WIDE_REC", "WR_REC", "TE_REC", "RB_REC", "RB_RUSH", "QB_RUSH", "QB_PASS",
];

export const DVP_LABELS: Record<DvpCategory, string> = {
  WR_SLOT_REC: "Slot WR",
  WR_WIDE_REC: "Wide WR",
  WR_REC:      "All WR",
  TE_REC:      "TE Rec",
  RB_REC:      "RB Rec",
  RB_RUSH:     "RB Rush",
  QB_RUSH:     "QB Rush",
  QB_PASS:     "QB Pass",
};

// ── Tunables ────────────────────────────────────────────────────────────────
// Early-season stats are noisy: shrink defense splits toward league average.
// weight = games / (games + K). With 2 games, yards get 50% weight, TDs 20%.
const YARDS_SHRINK_K = 2;
const TDS_SHRINK_K   = 8;
// Offensive TDs per implied point (league: ~2.4 offensive TDs on ~22.5 pts)
const TDS_PER_POINT  = 0.107;
const LEAGUE_PASS_TD_SHARE = 0.60;
const LEAGUE_AVG_POINTS    = 22.5;
// Red-zone shares on tiny samples are noisy; shrink toward overall share.
const RZ_SHRINK_K = 10;
// Share of team offensive TDs scored by players in the modeled pool
const POOL_COVERAGE = 0.92;

// One player's box-score line from a single game (nflverse stats_player_week)
export interface StatRow {
  playerId: string;
  name: string;
  position: string;
  team: string;
  opp: string;
  gameId: string;
  week: number;
  targets: number;
  receptions: number;
  recYds: number;
  recTds: number;
  carries: number;
  rushYds: number;
  rushTds: number;
  attempts: number;
  passYds: number;
  passTds: number;
  headshot: string | null;
}

export function normalizePos(pos: string): SkillPos | null {
  if (pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE") return pos;
  if (pos === "FB" || pos === "HB") return "RB";
  return null;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ── WR role (slot vs wide) ──────────────────────────────────────────────────
// No free source publishes alignment, so this is an estimate built from:
//  - ESPN depth chart: WR3 in the 3WR set is usually the slot
//  - aDOT: slot receivers are targeted shorter
//  - middle-of-field target share
export function classifyWR(opts: {
  espnDepthKey: string | null;   // "wr1" | "wr2" | "wr3"
  adot: number | null;
  middleShare: number | null;
  targets: number;
}): { role: WRRole; signals: string } {
  let score = 0;
  const why: string[] = [];
  if (opts.espnDepthKey === "wr3") { score += 1; why.push("WR3 on depth chart"); }
  if (opts.targets >= 5 && opts.adot != null) {
    const adot = `aDOT ${opts.adot.toFixed(1)}`;
    if (opts.adot < 9.5)       { score += 1;   why.push(`short ${adot}`); }
    else if (opts.adot < 11)   { score += 0.5; why.push(`mid ${adot}`); }
    else if (opts.adot > 13)   { score -= 1;   why.push(`deep ${adot}`); }
    else why.push(adot);
  }
  // Middle-of-field share is a weak slot signal, but a near-zero share is a good outside tell
  if (opts.targets >= 5 && opts.middleShare != null && opts.middleShare <= 0.1) {
    score -= 0.5; why.push(`${Math.round(opts.middleShare * 100)}% middle targets`);
  }
  const role: WRRole = score >= 1 ? "SLOT" : "WIDE";
  return { role, signals: why.length ? why.join(", ") : "under 5 targets — default wide" };
}

// ── Defense vs position ─────────────────────────────────────────────────────
export function categoriesForRow(pos: SkillPos, wrRole: WRRole | null): DvpCategory[] {
  switch (pos) {
    case "WR": return ["WR_REC", wrRole === "SLOT" ? "WR_SLOT_REC" : "WR_WIDE_REC"];
    case "TE": return ["TE_REC"];
    case "RB": return ["RB_REC", "RB_RUSH"];
    case "QB": return ["QB_RUSH", "QB_PASS"];
  }
}

function emptyLine(): DvpLine {
  return { games: 0, yardsPg: 0, tdsPg: 0, volumePg: 0, receptionsPg: 0 };
}

export function buildDefenseVsPosition(
  rows: StatRow[],
  roleOf: (playerId: string) => WRRole | null,
  teamNames: Record<string, string>,
  opponentThisWeek: Record<string, string>,
): { defense: DefenseVsPosition[]; leagueAvg: Record<DvpCategory, DvpLine> } {
  // Games each defense has played (distinct game ids where it was the opponent)
  const defGames: Record<string, Set<string>> = {};
  const totals: Record<string, Record<DvpCategory, { yds: number; tds: number; vol: number; rec: number }>> = {};

  const blank = () =>
    Object.fromEntries(DVP_CATEGORIES.map((c) => [c, { yds: 0, tds: 0, vol: 0, rec: 0 }])) as
      Record<DvpCategory, { yds: number; tds: number; vol: number; rec: number }>;

  for (const r of rows) {
    (defGames[r.opp] ??= new Set()).add(r.gameId);
    const pos = normalizePos(r.position);
    if (!pos) continue;
    const t = (totals[r.opp] ??= blank());
    for (const cat of categoriesForRow(pos, pos === "WR" ? roleOf(r.playerId) : null)) {
      const cell = t[cat];
      if (cat.endsWith("_REC")) {
        cell.yds += r.recYds; cell.tds += r.recTds; cell.vol += r.targets; cell.rec += r.receptions;
      } else if (cat.endsWith("_RUSH")) {
        cell.yds += r.rushYds; cell.tds += r.rushTds; cell.vol += r.carries;
      } else {
        cell.yds += r.passYds; cell.tds += r.passTds; cell.vol += r.attempts;
      }
    }
  }

  const teams = Object.keys(defGames).sort();
  const lines: Record<string, Record<DvpCategory, DvpLine>> = {};
  const leagueAgg = blank();
  let leagueGames = 0;

  for (const team of teams) {
    const g = defGames[team].size;
    leagueGames += g;
    const t = totals[team] ?? blank();
    lines[team] = {} as Record<DvpCategory, DvpLine>;
    for (const cat of DVP_CATEGORIES) {
      const c = t[cat];
      leagueAgg[cat].yds += c.yds; leagueAgg[cat].tds += c.tds;
      leagueAgg[cat].vol += c.vol; leagueAgg[cat].rec += c.rec;
      lines[team][cat] = g > 0
        ? { games: g, yardsPg: c.yds / g, tdsPg: c.tds / g, volumePg: c.vol / g, receptionsPg: c.rec / g }
        : emptyLine();
    }
  }

  const leagueAvg = {} as Record<DvpCategory, DvpLine>;
  for (const cat of DVP_CATEGORIES) {
    const c = leagueAgg[cat];
    leagueAvg[cat] = leagueGames > 0
      ? { games: leagueGames, yardsPg: c.yds / leagueGames, tdsPg: c.tds / leagueGames, volumePg: c.vol / leagueGames, receptionsPg: c.rec / leagueGames }
      : emptyLine();
  }

  // Ranks: 1 = allows the least
  const rankOf = (cat: DvpCategory, key: "yardsPg" | "tdsPg") => {
    const sorted = [...teams].sort((a, b) => lines[a][cat][key] - lines[b][cat][key]);
    const out: Record<string, number> = {};
    sorted.forEach((t, i) => { out[t] = i + 1; });
    return out;
  };
  const ranks = Object.fromEntries(
    DVP_CATEGORIES.map((c) => [c, { y: rankOf(c, "yardsPg"), t: rankOf(c, "tdsPg") }])
  ) as Record<DvpCategory, { y: Record<string, number>; t: Record<string, number> }>;

  const defense: DefenseVsPosition[] = teams.map((team) => {
    const cells = {} as Record<DvpCategory, DvpCell>;
    for (const cat of DVP_CATEGORIES) {
      const l = lines[team][cat];
      const avg = leagueAvg[cat];
      cells[cat] = {
        ...l,
        yardsRank: ranks[cat].y[team],
        tdsRank: ranks[cat].t[team],
        yardsVsAvg: avg.yardsPg > 0 ? l.yardsPg / avg.yardsPg - 1 : 0,
        tdsVsAvg: avg.tdsPg > 0 ? l.tdsPg / avg.tdsPg - 1 : 0,
      };
    }
    return { team, name: teamNames[team] ?? team, opponentThisWeek: opponentThisWeek[team] ?? null, cells };
  });

  return { defense, leagueAvg };
}

export function shrunkYardsEdge(cell: DvpCell | undefined): number {
  if (!cell || cell.games === 0) return 0;
  return (cell.games / (cell.games + YARDS_SHRINK_K)) * cell.yardsVsAvg;
}

// TDs are rare events — blend the steadier yardage signal in and shrink hard.
export function shrunkTdFactor(cell: DvpCell | undefined): number {
  if (!cell || cell.games === 0) return 1;
  const tdEdge = (cell.games / (cell.games + TDS_SHRINK_K)) * cell.tdsVsAvg;
  return clamp(1 + 0.5 * shrunkYardsEdge(cell) + 0.5 * tdEdge, 0.8, 1.25);
}

// ── Weather ─────────────────────────────────────────────────────────────────
// Thresholds from public NFL weather studies: passing efficiency and totals
// drop noticeably at 15+ mph sustained wind and sharply at 20+.
export function weatherImpact(w: {
  indoor: boolean; tempF?: number; windMph?: number; gustMph?: number;
  precipChance?: number; condition?: string;
}): Pick<NFLWeather, "impact" | "passMult" | "rushMult" | "notes"> {
  if (w.indoor) return { impact: "none", passMult: 1, rushMult: 1, notes: ["Dome / roof — no weather factor"] };

  let passMult = 1, rushMult = 1, severity = 0;
  const notes: string[] = [];
  const wind = w.windMph ?? 0;
  const gust = w.gustMph ?? 0;

  if (wind >= 20)      { passMult *= 0.85; rushMult *= 1.04; severity += 3; notes.push(`${wind} mph wind — deep passing and kicking heavily impacted, lean run game / unders`); }
  else if (wind >= 15) { passMult *= 0.92; rushMult *= 1.02; severity += 2; notes.push(`${wind} mph wind — passing efficiency drops, deep balls less reliable`); }
  else if (wind >= 10 && gust >= 25) { passMult *= 0.96; severity += 1; notes.push(`Gusts to ${gust} mph — occasional disruption to deep passing and FGs`); }

  const cond = (w.condition ?? "").toLowerCase();
  const wet = (w.precipChance ?? 0) >= 60 && /rain|shower|drizzle|thunder|snow/.test(cond);
  if (wet && /snow/.test(cond))  { passMult *= 0.9;  rushMult *= 1.03; severity += 2; notes.push(`Snow likely (${w.precipChance}%) — ball security & footing issues, favors rushing`); }
  else if (wet)                  { passMult *= 0.95; rushMult *= 1.02; severity += 1; notes.push(`Rain likely (${w.precipChance}%) — slick ball, slight downgrade to passing`); }

  if (w.tempF != null && w.tempF <= 20) { passMult *= 0.96; severity += 1; notes.push(`${w.tempF}°F — frigid, hands and kicking affected`); }
  else if (w.tempF != null && w.tempF >= 90) { severity += 0.5; notes.push(`${w.tempF}°F — heat can wear down defenses late`); }

  const impact = severity >= 3 ? "major" : severity >= 2 ? "moderate" : severity >= 1 ? "minor" : "none";
  if (!notes.length) notes.push("Neutral conditions");
  return { impact, passMult, rushMult, notes };
}

// ── Injuries ────────────────────────────────────────────────────────────────
export function unitForPosition(pos: string): NFLInjury["unit"] {
  const p = pos.toUpperCase();
  if (p === "QB") return "QB";
  if (p === "RB" || p === "FB" || p === "HB") return "RB";
  if (p === "WR") return "WR";
  if (p === "TE") return "TE";
  if (["OT", "T", "LT", "RT", "G", "OG", "LG", "RG", "C", "OL"].includes(p)) return "OL";
  if (["DE", "DT", "NT", "DL", "EDGE", "LDE", "RDE", "LDT", "RDT"].includes(p)) return "DL";
  if (["LB", "OLB", "ILB", "MLB", "WLB", "SLB", "LILB", "RILB"].includes(p)) return "LB";
  if (["CB", "S", "SS", "FS", "DB", "NB", "LCB", "RCB", "SAF"].includes(p)) return "DB";
  if (["K", "P", "LS", "PK", "H", "KR", "PR"].includes(p)) return "ST";
  return "OTHER";
}

export function isMissing(status: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === "out" || s.includes("reserve") || s.includes("suspen") || s === "pup" || s.includes("physically");
}

export function availabilityMult(status: string | null): number {
  if (!status) return 1;
  if (isMissing(status)) return 0;
  const s = status.toLowerCase();
  if (s === "doubtful") return 0.3;
  if (s === "questionable") return 0.85;
  return 1;
}

// ── TD model ────────────────────────────────────────────────────────────────
// λ_rush = teamTDs · (1 − passShare) · playerRushTdShare · defRushFactor · adj
// λ_rec  = teamTDs ·      passShare  · playerRecTdShare  · defRecFactor  · adj
// Then finalizeTeamTDs() rescales each team's rush/rec pools to the market-implied
// totals, so defense factors redistribute TDs rather than inflate them, and a
// ruled-out player's share flows to teammates.
// P(anytime TD) = 1 − e^(−(λ_rush + λ_rec))
export interface TDInputs {
  position: SkillPos;
  teamImplied: number | null;
  teamPassTdShare: number | null; // this season's share of offensive TDs via pass
  teamGames: number;
  carryShare: number;
  rzCarryShare: number;
  targetShare: number;
  rzTargetShare: number;
  teamRzCarries: number;           // weighted (inside-10 counts double)
  teamRzTargets: number;
  defRushFactor: number;
  defRecFactor: number;
  weather: Pick<NFLWeather, "passMult" | "rushMult">;
  olStartersOut: number;           // own offensive line
  oppFrontStartersOut: number;     // opponent DL + LB
  oppSecondaryStartersOut: number; // opponent DB
  availability: number;
}

export function tdModel(i: TDInputs): TDBreakdown {
  const adjustments: string[] = [];
  const implied = i.teamImplied ?? LEAGUE_AVG_POINTS;
  if (i.teamImplied == null) adjustments.push("No betting line — using league-average points");
  const teamTDs = implied * TDS_PER_POINT;

  // Team pass/rush TD mix, regressed toward league average
  const w = i.teamGames / (i.teamGames + 4);
  let passShare = i.teamPassTdShare == null
    ? LEAGUE_PASS_TD_SHARE
    : w * i.teamPassTdShare + (1 - w) * LEAGUE_PASS_TD_SHARE;
  // Weather shifts the mix toward the ground
  passShare = clamp(passShare * i.weather.passMult / (passShare * i.weather.passMult + (1 - passShare) * i.weather.rushMult), 0.3, 0.8);

  // Red-zone usage is the strongest TD predictor; shrink it toward overall share by sample size
  const wC = i.teamRzCarries / (i.teamRzCarries + RZ_SHRINK_K);
  const wT = i.teamRzTargets / (i.teamRzTargets + RZ_SHRINK_K);
  const rzCarry  = wC * i.rzCarryShare + (1 - wC) * i.carryShare;
  const rzTarget = wT * i.rzTargetShare + (1 - wT) * i.targetShare;
  const rushTdShare = 0.6 * rzCarry + 0.4 * i.carryShare;
  const recTdShare  = 0.55 * rzTarget + 0.45 * i.targetShare;

  let rushAdj = 1, recAdj = 1;
  if (i.olStartersOut > 0) {
    const hit = Math.min(0.15, 0.04 * i.olStartersOut);
    rushAdj *= 1 - hit; recAdj *= 1 - hit / 2;
    adjustments.push(`${i.olStartersOut} OL starter(s) out: −${Math.round(hit * 100)}% rush`);
  }
  if (i.oppFrontStartersOut > 0) {
    const bump = Math.min(0.12, 0.03 * i.oppFrontStartersOut);
    rushAdj *= 1 + bump;
    adjustments.push(`Opp front seven missing ${i.oppFrontStartersOut}: +${Math.round(bump * 100)}% rush`);
  }
  if (i.oppSecondaryStartersOut > 0 && i.position !== "QB") {
    const bump = Math.min(0.12, 0.03 * i.oppSecondaryStartersOut);
    recAdj *= 1 + bump;
    adjustments.push(`Opp secondary missing ${i.oppSecondaryStartersOut}: +${Math.round(bump * 100)}% rec`);
  }
  if (i.defRushFactor !== 1 && rushTdShare > 0.02) adjustments.push(`Opp rush-TD rate ×${i.defRushFactor.toFixed(2)}`);
  if (i.defRecFactor !== 1 && recTdShare > 0.02 && i.position !== "QB") adjustments.push(`Opp rec-TD rate vs ${i.position} ×${i.defRecFactor.toFixed(2)}`);
  if (i.availability < 1) adjustments.push(i.availability === 0 ? "Ruled out" : `Injury designation ×${i.availability}`);

  const rushLambda = teamTDs * (1 - passShare) * rushTdShare * i.defRushFactor * rushAdj * i.availability;
  // QBs throw TDs, they don't catch them
  const recLambda = i.position === "QB"
    ? 0
    : teamTDs * passShare * recTdShare * i.defRecFactor * recAdj * i.availability;

  return {
    teamImplied: implied,
    teamTDs,
    passTdShare: passShare,
    rushLambda,
    recLambda,
    defRushFactor: i.defRushFactor,
    defRecFactor: i.defRecFactor,
    adjustments,
  };
}

export function finalizeTeamTDs(players: NFLPlayerMatchup[]): void {
  const byTeam = new Map<string, NFLPlayerMatchup[]>();
  for (const p of players) (byTeam.get(p.team) ?? byTeam.set(p.team, []).get(p.team)!).push(p);

  for (const group of byTeam.values()) {
    const { teamTDs, passTdShare } = group[0].td;
    const rushSum = group.reduce((s, p) => s + p.td.rushLambda, 0);
    const recSum  = group.reduce((s, p) => s + p.td.recLambda, 0);
    const scale = (target: number, sum: number) => (sum > 0 ? clamp(target / sum, 0.5, 1.6) : 1);
    const rushScale = scale(teamTDs * (1 - passTdShare) * POOL_COVERAGE, rushSum);
    const recScale  = scale(teamTDs * passTdShare * POOL_COVERAGE, recSum);
    for (const p of group) {
      p.td.rushLambda *= rushScale;
      p.td.recLambda  *= recScale;
      const prob = 1 - Math.exp(-(p.td.rushLambda + p.td.recLambda));
      p.tdProb = prob;
      p.tdScore = Math.round(prob * 100);
      p.tdFairOdds = fairAmericanOdds(prob);
    }
  }
}

export function fairAmericanOdds(p: number): string {
  if (p <= 0.001) return "—";
  if (p >= 0.999) return "-99900";
  return p >= 0.5
    ? `${Math.round((-100 * p) / (1 - p))}`
    : `+${Math.round((100 * (1 - p)) / p)}`;
}

// tanh keeps big early-season outliers from all pinning at 100:
// +20% edge → ~66, +50% → ~84, +100% → ~96
export function matchupScoreFromEdge(edge: number, injuryBump: number): number {
  return Math.round(clamp(50 + 50 * Math.tanh(edge / 0.6) + injuryBump, 0, 100));
}

// ESPN injury comments usually end with attribution: "…, Tom Pelissero of NFL Network reports."
export function parseReporter(comment: string | null): string | null {
  if (!comment) return null;
  const m = comment.match(/,\s*([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3})\s+of\s+(.+?)\s+(?:reports|relays|notes|writes|confirms|says|tweets|reported)\b/);
  return m ? `${m[1]} (${m[2]})` : null;
}
