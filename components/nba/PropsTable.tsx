"use client";

import { useMemo, useState } from "react";
import type { NBAGame, NBAPropRow, PropStat } from "@/types/nba";
import { CollapsibleSection } from "@/components/analytics/CollapsibleSection";
import { Chip, FilterLabel, SortHeader, PlainHeader, TableShell, EmptyState, useTableSort } from "@/components/nfl/ui";
import { GameFilter, tipTime, type GameFilterState } from "./GameFilter";

type Mode = "hot" | "safe";
type SortKey = "team" | "player" | "time" | "odds" | "l5" | "l10" | "l20" | "streak" | "avg" | "model" | "edge" | "hot";

const STATS: PropStat[] = ["PTS", "REB", "AST", "STL", "BLK"];
const STAT_LABEL: Record<PropStat, string> = { PTS: "points", REB: "rebounds", AST: "assists", STL: "steals", BLK: "blocks" };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmtOdds = (o: number) => (o > 0 ? `+${o}` : `${o}`);
const rate = (h: number, n: number) => (n ? h / n : 0);

function rateClass(r: number): string {
  if (r >= 0.9) return "text-green-600 dark:text-green-400 font-bold";
  if (r >= 0.8) return "text-green-600/90 dark:text-green-400/90 font-semibold";
  if (r >= 0.6) return "text-foreground font-semibold";
  return "text-muted-foreground";
}

function edgeClass(e: number): string {
  if (e >= 0.15) return "text-green-600 dark:text-green-400 font-bold";
  if (e >= 0.05) return "text-green-600/80 dark:text-green-400/80 font-semibold";
  if (e <= -0.05) return "text-red-500 dark:text-red-400";
  return "text-muted-foreground";
}

function HitRate({ h, n }: { h: number; n: number }) {
  return (
    <span className="tabular-nums whitespace-nowrap">
      <span className={rateClass(rate(h, n))}>{pct(rate(h, n))}</span>
      <span className="text-muted-foreground text-[10px]"> {h}/{n}</span>
    </span>
  );
}

// Last 10 values, newest on the left; green = hit, red = miss
function LastTen({ row }: { row: NBAPropRow }) {
  const vals = row.last.slice(0, 10);
  const fromPrev = Math.max(0, row.last.length - row.prevSeasonGames); // index where last season starts
  return (
    <div className="flex gap-0.5">
      {vals.map((v, i) => (
        <span
          key={i}
          title={i >= fromPrev ? "Last season" : undefined}
          className={`text-[10px] tabular-nums w-5 text-center rounded py-0.5 ${
            v >= row.threshold
              ? "bg-green-500/20 text-green-700 dark:text-green-400"
              : "bg-red-500/15 text-red-600 dark:text-red-400"
          } ${i >= fromPrev ? "opacity-60" : ""}`}
        >
          {v}
        </span>
      ))}
    </div>
  );
}

export function PropsTable({
  mode, props, games, filter,
}: { mode: Mode; props: NBAPropRow[]; games: NBAGame[]; filter: GameFilterState }) {
  const [stat, setStat] = useState<"ALL" | PropStat>("ALL");
  const sort = useTableSort<SortKey>(mode === "hot" ? "hot" : "l20");

  const rows = useMemo(() => {
    const val = (r: NBAPropRow): number | string => {
      switch (sort.key) {
        case "team":   return r.team;
        case "player": return r.name;
        case "time":   return r.startTime;
        case "odds":   return r.odds;
        case "l5":     return rate(r.hitsL5, r.nL5) * 100 + r.nL5;
        case "l10":    return rate(r.hitsL10, r.nL10) * 100 + r.nL10;
        case "l20":    return rate(r.hitsL20, r.nL20) * 100 + r.nL20 / 100 + rate(r.hitsL10, r.nL10) / 1000;
        case "streak": return r.streak;
        case "avg":    return r.avgL10 / Math.max(r.threshold, 0.5);   // cushion over the line
        case "model":  return r.modelProb;
        case "edge":   return r.edge;
        case "hot":    return r.hotScore;
      }
    };
    const cmp = (a: NBAPropRow, b: NBAPropRow) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return (sort.dir === "desc" ? -c : c) || b.modelProb - a.modelProb;
    };
    return props
      .filter((r) => r.category === mode && (stat === "ALL" || r.stat === stat) && filter.matches(r.gameId))
      .sort(cmp);
  }, [props, mode, stat, filter, sort.key, sort.dir]);

  const H = (label: string, col: SortKey, title?: string) => (
    <SortHeader label={label} col={col} current={sort.key} dir={sort.dir} onSort={sort.onSort} title={title} />
  );

  return (
    <div className="space-y-4">
      <CollapsibleSection
        title={mode === "hot" ? "How Hot Props are picked" : "How Super Safe Picks are picked"}
        defaultOpen={false}
        subtitle={mode === "hot"
          ? "DraftKings milestone props from +200 to −200 that are on a streak or beat the book's price"
          : "DraftKings milestone props from −400 to −900 that hit in 80%+ of the last 10 and last 20 games"}
      >
        <div className="bg-card border border-border rounded-2xl p-4 text-xs text-muted-foreground space-y-2 leading-relaxed">
          <p><b className="text-foreground">Lines.</b> These are DraftKings milestone props (&quot;10+ rebounds&quot;), which are one-sided &quot;at least N&quot; bets, for points, rebounds, assists, steals and blocks. Book % is the price&apos;s implied probability, vig included.</p>
          <p><b className="text-foreground">History.</b> Each player&apos;s last 20 games. While this season is short, it reaches back into last season (faded in the last-10 strip). Preseason is never counted.</p>
          <p><b className="text-foreground">Model %.</b> A blend of hit rates: <b className="text-foreground">25%</b> last 5, <b className="text-foreground">40%</b> last 10 and <b className="text-foreground">35%</b> last 20. Each rate gets 2 phantom games at the book&apos;s price, so small samples can&apos;t look perfect. Edge = Model % − Book %.</p>
          {mode === "hot" ? (
            <p><b className="text-foreground">Qualifies</b> when he&apos;s hit 60%+ of his last 10 <i>and</i> either hit <b className="text-foreground">5+ straight</b> or the model is <b className="text-foreground">8+ points above</b> the book. Hot score = edge + 2 per game of streak (up to 10). One rung per player and stat, keeping the best score.</p>
          ) : (
            <p><b className="text-foreground">Qualifies</b> with at least 10 games and an <b className="text-foreground">80–100%</b> hit rate over <i>both</i> the last 10 and last 20. When several rungs qualify, only the highest line is kept (best payout). Check minutes: a role change or blowout is the main way these lose.</p>
          )}
        </div>
      </CollapsibleSection>

      <GameFilter games={games} filter={filter} />
      <div className="flex items-center gap-1.5">
        <FilterLabel>Stat</FilterLabel>
        {(["ALL", ...STATS] as const).map((s) => (
          <Chip key={s} active={stat === s} onClick={() => setStat(s)}>{s === "ALL" ? "All" : s}</Chip>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState>
          {props.some((p) => p.category === mode)
            ? "No props match these filters."
            : "No props qualify yet. DraftKings posts lines through the day, so check back after the next sync."}
        </EmptyState>
      ) : (
        <TableShell>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-card border-b border-border">
              <tr>
                {H("Team", "team")}
                {H("Player", "player")}
                {H("Time (ET)", "time")}
                <PlainHeader label="Prop" />
                {H("Odds", "odds", "DraftKings price (implied probability)")}
                {H("L5", "l5", "Hit rate, last 5 games")}
                {H("L10", "l10", "Hit rate, last 10 games")}
                {H("L20", "l20", "Hit rate, last 20 games")}
                {H("Streak", "streak", "Consecutive games hitting this line")}
                {H("Avg L10", "avg", "Average over the last 10 (sorts by cushion over the line)")}
                <PlainHeader label="Last 10 (newest first)" />
                {H("Model", "model", "Blended, shrunk hit rate")}
                {H("Edge", "edge", "Model % minus the book's implied %")}
                {mode === "hot" && H("Hot", "hot", "Edge + streak bonus")}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-muted/40 transition-colors">
                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                    <div className="text-[12px] font-bold">{r.team}</div>
                    <div className="text-[10px] text-muted-foreground">{r.isHome ? "vs" : "@"} {r.opponent}</div>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-[12px] whitespace-nowrap">{r.name}</span>
                      {r.injuryStatus && (
                        <span title={r.injuryStatus} className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-400/90 text-black">GTD</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{Math.round(r.minL10)} min/g L10</div>
                  </td>
                  <td className="px-2.5 py-1.5 text-[12px] whitespace-nowrap tabular-nums">{tipTime(r.startTime)}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                    <span className="text-[12px] font-bold">{r.threshold}+ {r.stat}</span>
                    <div className="text-[10px] text-muted-foreground">{STAT_LABEL[r.stat]}</div>
                  </td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap tabular-nums">
                    <span className="text-[12px] font-mono font-semibold">{fmtOdds(r.odds)}</span>
                    <div className="text-[10px] text-muted-foreground">book {pct(r.implied)}</div>
                  </td>
                  <td className="px-2.5 py-1.5 text-[12px]"><HitRate h={r.hitsL5} n={r.nL5} /></td>
                  <td className="px-2.5 py-1.5 text-[12px]"><HitRate h={r.hitsL10} n={r.nL10} /></td>
                  <td className="px-2.5 py-1.5 text-[12px]">
                    <HitRate h={r.hitsL20} n={r.nL20} />
                    {r.prevSeasonGames > 0 && (
                      <div className="text-[10px] text-muted-foreground">{r.prevSeasonGames} from last season</div>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-[12px] tabular-nums">
                    <span className={r.streak >= 5 ? "font-bold text-orange-600 dark:text-orange-400" : ""}>{r.streak}</span>
                  </td>
                  <td className="px-2.5 py-1.5 text-[12px] tabular-nums">{r.avgL10.toFixed(1)}</td>
                  <td className="px-2.5 py-1.5"><LastTen row={r} /></td>
                  <td className="px-2.5 py-1.5 text-[12px] tabular-nums font-semibold">{pct(r.modelProb)}</td>
                  <td className={`px-2.5 py-1.5 text-[12px] tabular-nums ${edgeClass(r.edge)}`}>
                    {r.edge >= 0 ? "+" : ""}{Math.round(r.edge * 100)}
                  </td>
                  {mode === "hot" && (
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <span className="text-[12px] font-bold px-2 py-0.5 rounded tabular-nums bg-orange-500/80 text-white">{r.hotScore}</span>
                      <div className="text-[10px] text-muted-foreground mt-1 max-w-[180px] whitespace-normal">{r.reasons.join(" · ")}</div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  );
}
