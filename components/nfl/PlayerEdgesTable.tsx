"use client";

import { useMemo, useState } from "react";
import type { NFLGame, NFLPlayerMatchup, SkillPos } from "@/types/nfl";
import { DVP_LABELS, isMissing } from "@/lib/nflModel";
import {
  Chip, FilterLabel, Select, Toggle, SearchBox, SortHeader, PlainHeader, TableShell, EmptyState,
  PosBadge, StatusBadge, rankClass, edgeClass, scoreClass, tdClass, signedPct, ordinal,
  gameStarted, useTableSort,
} from "./ui";

type SortKey = "matchupScore" | "matchupEdge" | "defRank" | "projYards" | "volume" | "tdScore";

function volume(p: NFLPlayerMatchup): number {
  const u = p.usage;
  if (p.position === "QB") return u.carriesPg;
  if (p.position === "RB") return u.carriesPg + u.targetsPg;
  return u.targetsPg;
}

function usageText(p: NFLPlayerMatchup): string {
  const u = p.usage;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (p.position === "QB") return `${u.passYdsPg.toFixed(0)} pass · ${u.carriesPg.toFixed(1)} car`;
  if (p.position === "RB") return `${u.carriesPg.toFixed(1)} car (${pct(u.carryShare)}) · ${u.targetsPg.toFixed(1)} tgt`;
  return `${u.targetsPg.toFixed(1)} tgt (${pct(u.targetShare)})${u.adot != null ? ` · aDOT ${u.adot.toFixed(1)}` : ""}`;
}

interface Props {
  players: NFLPlayerMatchup[];
  games: NFLGame[];
}

export function PlayerEdgesTable({ players, games }: Props) {
  const [pos, setPos] = useState<"ALL" | SkillPos>("ALL");
  const [role, setRole] = useState<"ALL" | "SLOT" | "WIDE">("ALL");
  const [gameId, setGameId] = useState("ALL");
  const [search, setSearch] = useState("");
  const [minVol, setMinVol] = useState("5");
  const [hideOut, setHideOut] = useState(true);
  const [hideStarted, setHideStarted] = useState(true);
  const sort = useTableSort<SortKey>("matchupScore");

  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = players.filter((p) => {
      if (pos !== "ALL" && p.position !== pos) return false;
      if (role !== "ALL" && p.wrRole !== role) return false;
      if (gameId !== "ALL" && p.gameId !== gameId) return false;
      if (hideOut && isMissing(p.injuryStatus)) return false;
      if (hideStarted && gameStarted(gameById.get(p.gameId))) return false;
      if (volume(p) < Number(minVol)) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.team.toLowerCase().includes(q)) return false;
      return true;
    });
    const val = (p: NFLPlayerMatchup): number => {
      switch (sort.key) {
        case "matchupScore": return p.matchupScore;
        case "matchupEdge":  return p.matchupEdge;
        case "defRank":      return p.defRankPrimary;
        case "projYards":    return p.projYards;
        case "volume":       return volume(p);
        case "tdScore":      return p.tdScore;
      }
    };
    return filtered.sort((a, b) => (sort.dir === "desc" ? val(b) - val(a) : val(a) - val(b)));
  }, [players, pos, role, gameId, search, minVol, hideOut, hideStarted, sort.key, sort.dir, gameById]);

  const gameOptions = [
    { value: "ALL", label: "All games" },
    ...games.map((g) => ({ value: g.id, label: `${g.away.abbr} @ ${g.home.abbr}` })),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <FilterLabel>Pos</FilterLabel>
          {(["ALL", "QB", "RB", "WR", "TE"] as const).map((p) => (
            <Chip key={p} active={pos === p} onClick={() => { setPos(p); if (p !== "WR" && p !== "ALL") setRole("ALL"); }}>
              {p === "ALL" ? "All" : p}
            </Chip>
          ))}
        </div>
        {(pos === "WR" || pos === "ALL") && (
          <div className="flex items-center gap-1.5">
            <FilterLabel>WR role</FilterLabel>
            {(["ALL", "SLOT", "WIDE"] as const).map((r) => (
              <Chip key={r} active={role === r} onClick={() => setRole(r)}
                title="Estimated from depth chart + target depth — no public alignment data">
                {r === "ALL" ? "Any" : r === "SLOT" ? "Slot" : "Wide"}
              </Chip>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <FilterLabel>Game</FilterLabel>
          <Select value={gameId} onChange={setGameId} options={gameOptions} />
        </div>
        <div className="flex items-center gap-1.5">
          <FilterLabel>Min opps/g</FilterLabel>
          <Select value={minVol} onChange={setMinVol} options={[
            { value: "0", label: "Any" }, { value: "3", label: "3+" }, { value: "5", label: "5+" }, { value: "8", label: "8+" },
          ]} />
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder="Search player / team" />
        <Toggle checked={hideOut} onChange={setHideOut} label="Hide Out / IR" />
        <Toggle checked={hideStarted} onChange={setHideStarted} label="Hide started games" />
      </div>

      {rows.length === 0 ? (
        <EmptyState>No players match these filters.</EmptyState>
      ) : (
        <TableShell>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-card border-b border-border">
              <tr>
                <PlainHeader label="#" className="w-8" />
                <PlainHeader label="Player" className="min-w-[170px]" />
                <PlainHeader label="Opp" />
                <PlainHeader label="Matchup" />
                <SortHeader label="Def Rank" col="defRank" current={sort.key} dir={sort.dir} onSort={sort.onSort} title="Opponent rank allowing yards to this role (32 = most generous)" />
                <SortHeader label="Edge" col="matchupEdge" current={sort.key} dir={sort.dir} onSort={sort.onSort} title="Yards allowed vs league avg, shrunk for sample size" />
                <SortHeader label="Score" col="matchupScore" current={sort.key} dir={sort.dir} onSort={sort.onSort} title="0–100 matchup score, 50 = neutral. Includes opposing injuries and your own OL health" />
                <SortHeader label="Usage" col="volume" current={sort.key} dir={sort.dir} onSort={sort.onSort} className="min-w-[150px]" />
                <SortHeader label="Proj Yds" col="projYards" current={sort.key} dir={sort.dir} onSort={sort.onSort} />
                <SortHeader label="TD" col="tdScore" current={sort.key} dir={sort.dir} onSort={sort.onSort} title="Anytime TD probability (%)" />
                <PlainHeader label="Flags" className="min-w-[140px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p, i) => {
                const g = gameById.get(p.gameId);
                return (
                  <tr key={p.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-2.5 py-1.5 text-[11px] text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[12px] truncate max-w-[150px]" title={p.injuryNote ?? undefined}>{p.name}</span>
                        <StatusBadge status={p.injuryStatus} />
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">{p.team}</span>
                        <span title={p.wrRoleSignals ?? undefined}><PosBadge pos={p.position} role={p.wrRole} /></span>
                        {p.depthLabel && <span className="text-[9px] text-muted-foreground/70">{p.depthLabel}</span>}
                      </div>
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <div className="text-[12px] font-medium">{p.isHome ? "vs" : "@"} {p.opponent}</div>
                      {g && (
                        <div className="text-[10px] text-muted-foreground">
                          {(p.isHome ? g.homeImplied : g.awayImplied)?.toFixed(1) ?? "—"} impl
                        </div>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{DVP_LABELS[p.primaryCategory]}</td>
                    <td className="px-2.5 py-1.5">
                      <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded tabular-nums ${rankClass(p.defRankPrimary)}`}>
                        {ordinal(p.defRankPrimary)}
                      </span>
                    </td>
                    <td className={`px-2.5 py-1.5 text-[12px] font-mono font-semibold tabular-nums ${edgeClass(p.matchupEdge)}`}>
                      {signedPct(p.matchupEdge)}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded tabular-nums ${scoreClass(p.matchupScore)}`}>
                        {p.matchupScore}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{usageText(p)}</td>
                    <td className="px-2.5 py-1.5 text-[12px] font-mono tabular-nums" title={`Rec ${p.projRecYds.toFixed(0)} · Rush ${p.projRushYds.toFixed(0)}`}>
                      {p.projYards.toFixed(0)}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded tabular-nums ${tdClass(p.tdScore)}`} title={`Fair odds ${p.tdFairOdds}`}>
                        {p.tdScore}%
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {p.flags.map((f) => (
                          <span key={f} className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground whitespace-nowrap">{f}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      )}
      <p className="text-[11px] text-muted-foreground">
        Edge = yards the opponent allows to this role vs league average, shrunk toward average for small samples.
        Slot/Wide is an estimate (depth chart WR3 + target depth). Hover a name for injury notes, the role badge for why it was classified.
      </p>
    </div>
  );
}
