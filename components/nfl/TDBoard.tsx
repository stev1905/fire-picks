"use client";

import { useMemo, useState } from "react";
import type { NFLGame, NFLPlayerMatchup, SkillPos } from "@/types/nfl";
import { isMissing } from "@/lib/nflModel";
import { CollapsibleSection } from "@/components/analytics/CollapsibleSection";
import {
  Chip, FilterLabel, Select, Toggle, SearchBox, SortHeader, PlainHeader, TableShell, EmptyState,
  PosBadge, StatusBadge, tdClass, gameStarted, useTableSort,
} from "./ui";

type SortKey = "tdScore" | "rush" | "rec" | "implied" | "rz";

interface Props {
  players: NFLPlayerMatchup[];
  games: NFLGame[];
}

export function TDBoard({ players, games }: Props) {
  const [pos, setPos] = useState<"ALL" | SkillPos>("ALL");
  const [gameId, setGameId] = useState("ALL");
  const [search, setSearch] = useState("");
  const [hideOut, setHideOut] = useState(true);
  const [hideStarted, setHideStarted] = useState(true);
  const sort = useTableSort<SortKey>("tdScore");

  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const val = (p: NFLPlayerMatchup): number => {
      switch (sort.key) {
        case "tdScore": return p.tdProb;
        case "rush":    return p.td.rushLambda;
        case "rec":     return p.td.recLambda;
        case "implied": return p.td.teamImplied;
        case "rz":      return p.usage.rzCarries + p.usage.rzTargets;
      }
    };
    return players
      .filter((p) =>
        (pos === "ALL" || p.position === pos) &&
        (gameId === "ALL" || p.gameId === gameId) &&
        !(hideOut && isMissing(p.injuryStatus)) &&
        !(hideStarted && gameStarted(gameById.get(p.gameId))) &&
        (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)) &&
        p.tdScore >= 3)
      .sort((a, b) => (sort.dir === "desc" ? val(b) - val(a) : val(a) - val(b)));
  }, [players, pos, gameId, search, hideOut, hideStarted, sort.key, sort.dir, gameById]);

  return (
    <div className="space-y-4">
      <CollapsibleSection title="How the TD score works" defaultOpen={false}
        subtitle="Market-implied team TDs × the player's (red-zone weighted) share × matchup, injury and weather adjustments">
        <div className="bg-card border border-border rounded-2xl p-4 text-xs text-muted-foreground space-y-2 leading-relaxed">
          <p><b className="text-foreground">1. Team TDs.</b> Implied points from the DraftKings spread/total (home = total/2 − spread/2) × 0.107 offensive TDs per point, then split pass/rush using the team&apos;s own TD mix regressed toward the league&apos;s 60/40. Wind, rain and snow shift the mix toward the run.</p>
          <p><b className="text-foreground">2. Player share.</b> Rushing: 60% red-zone carry share (inside-10 counts double) + 40% overall carry share. Receiving: 55% red-zone target share + 45% target share. Red-zone shares are shrunk toward overall share until the team has ~10 red-zone looks. Shares only count games the player played.</p>
          <p><b className="text-foreground">3. Matchup.</b> The opponent&apos;s TDs and yards allowed to that position vs league average, shrunk hard for sample size and capped at ±20–25%.</p>
          <p><b className="text-foreground">4. Injuries.</b> Each own OL starter out: −4% rush (max −15%). Each opposing DL/LB starter out: +3% rush; each DB starter out: +3% receiving (max +12%). Questionable ×0.85, Doubtful ×0.3, Out = 0.</p>
          <p><b className="text-foreground">5. Normalize.</b> Each team&apos;s rush and receiving pools are rescaled to the market total, so a ruled-out player’s share flows to teammates instead of vanishing.</p>
          <p><b className="text-foreground">6. Probability.</b> P(anytime TD) = 1 − e<sup>−λ</sup> (Poisson). Fair odds are no-vig — compare them to your book&apos;s price to find value.</p>
        </div>
      </CollapsibleSection>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <FilterLabel>Pos</FilterLabel>
          {(["ALL", "QB", "RB", "WR", "TE"] as const).map((p) => (
            <Chip key={p} active={pos === p} onClick={() => setPos(p)}>{p === "ALL" ? "All" : p}</Chip>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <FilterLabel>Game</FilterLabel>
          <Select value={gameId} onChange={setGameId} options={[
            { value: "ALL", label: "All games" },
            ...games.map((g) => ({ value: g.id, label: `${g.away.abbr} @ ${g.home.abbr}` })),
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
                <SortHeader label="TD Score" col="tdScore" current={sort.key} dir={sort.dir} onSort={sort.onSort} />
                <PlainHeader label="Fair Odds" />
                <SortHeader label="Team Impl" col="implied" current={sort.key} dir={sort.dir} onSort={sort.onSort} title="Market-implied team points" />
                <SortHeader label="Rush λ" col="rush" current={sort.key} dir={sort.dir} onSort={sort.onSort} title="Expected rushing TDs" />
                <SortHeader label="Rec λ" col="rec" current={sort.key} dir={sort.dir} onSort={sort.onSort} title="Expected receiving TDs" />
                <SortHeader label="RZ Opps" col="rz" current={sort.key} dir={sort.dir} onSort={sort.onSort} title="Season red-zone carries / targets (share of team)" />
                <PlainHeader label="Season TDs" />
                <PlainHeader label="Adjustments" className="min-w-[220px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p, i) => {
                const u = p.usage;
                return (
                  <tr key={p.id} className="hover:bg-muted/40 transition-colors align-top">
                    <td className="px-2.5 py-1.5 text-[11px] text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[12px]" title={p.injuryNote ?? undefined}>{p.name}</span>
                        <StatusBadge status={p.injuryStatus} />
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">{p.team}</span>
                        <PosBadge pos={p.position} role={p.wrRole} />
                      </div>
                    </td>
                    <td className="px-2.5 py-1.5 text-[12px] whitespace-nowrap">{p.isHome ? "vs" : "@"} {p.opponent}</td>
                    <td className="px-2.5 py-1.5">
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded tabular-nums ${tdClass(p.tdScore)}`}>{p.tdScore}</span>
                    </td>
                    <td className="px-2.5 py-1.5 text-[12px] font-mono tabular-nums">{p.tdFairOdds}</td>
                    <td className="px-2.5 py-1.5 text-[12px] font-mono tabular-nums text-muted-foreground">
                      {p.td.teamImplied.toFixed(1)}
                      <div className="text-[10px]">{p.td.teamTDs.toFixed(1)} TDs · {Math.round(p.td.passTdShare * 100)}% pass</div>
                    </td>
                    <td className="px-2.5 py-1.5 text-[12px] font-mono tabular-nums">{p.td.rushLambda.toFixed(2)}</td>
                    <td className="px-2.5 py-1.5 text-[12px] font-mono tabular-nums">{p.td.recLambda.toFixed(2)}</td>
                    <td className="px-2.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                      {u.rzCarries > 0 && <div>{u.rzCarries} car ({Math.round(u.rzCarryShare * 100)}%){u.i10Carries > 0 && ` · ${u.i10Carries} i10`}</div>}
                      {u.rzTargets > 0 && <div>{u.rzTargets} tgt ({Math.round(u.rzTargetShare * 100)}%)</div>}
                      {u.rzCarries === 0 && u.rzTargets === 0 && "—"}
                    </td>
                    <td className="px-2.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                      {u.rushTds + u.recTds} in {u.games}g
                    </td>
                    <td className="px-2.5 py-1.5 text-[10px] text-muted-foreground">
                      {p.td.adjustments.length ? p.td.adjustments.join(" · ") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  );
}
