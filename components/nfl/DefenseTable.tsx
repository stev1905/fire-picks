"use client";

import { useMemo, useState } from "react";
import type { DefenseVsPosition, DvpCategory, DvpLine } from "@/types/nfl";
import { DVP_CATEGORIES, DVP_LABELS } from "@/lib/nflModel";
import {
  Chip, FilterLabel, SearchBox, SortHeader, PlainHeader, TableShell, Toggle, rankClass, signedPct, useTableSort,
} from "./ui";

type Metric = "yards" | "tds" | "volume";

const VOLUME_LABEL: Record<DvpCategory, string> = {
  WR_SLOT_REC: "tgt", WR_WIDE_REC: "tgt", WR_REC: "tgt", TE_REC: "tgt", RB_REC: "tgt",
  RB_RUSH: "car", QB_RUSH: "car", QB_PASS: "att",
};

function metricValue(d: DefenseVsPosition, c: DvpCategory, metric: Metric): number {
  const cell = d.cells[c];
  return metric === "yards" ? cell.yardsPg : metric === "tds" ? cell.tdsPg : cell.volumePg;
}

interface Props {
  defense: DefenseVsPosition[];
  leagueAvg: Record<DvpCategory, DvpLine>;
}

export function DefenseTable({ defense, leagueAvg }: Props) {
  const [metric, setMetric] = useState<Metric>("yards");
  const [search, setSearch] = useState("");
  const [showVsAvg, setShowVsAvg] = useState(false);
  // Default: most generous to slot WRs first
  const sort = useTableSort<DvpCategory | "team">("WR_SLOT_REC");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = defense.filter((d) =>
      !q || d.team.toLowerCase().includes(q) || d.name.toLowerCase().includes(q) || (d.opponentThisWeek ?? "").toLowerCase().includes(q));
    return list.sort((a, b) => {
      if (sort.key === "team") return sort.dir === "desc" ? b.team.localeCompare(a.team) : a.team.localeCompare(b.team);
      const diff = metricValue(b, sort.key, metric) - metricValue(a, sort.key, metric);
      return sort.dir === "desc" ? diff : -diff;
    });
  }, [defense, search, sort.key, sort.dir, metric]);

  const fmt = (v: number) => (metric === "tds" ? v.toFixed(2) : v.toFixed(1));
  // Volume ranks aren't stored; rank on the fly so colors stay meaningful
  const volumeRanks = useMemo(() => {
    const out = {} as Record<DvpCategory, Record<string, number>>;
    for (const c of DVP_CATEGORIES) {
      const sorted = [...defense].sort((a, b) => a.cells[c].volumePg - b.cells[c].volumePg);
      out[c] = Object.fromEntries(sorted.map((d, i) => [d.team, i + 1]));
    }
    return out;
  }, [defense]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <FilterLabel>Show</FilterLabel>
          <Chip active={metric === "yards"} onClick={() => setMetric("yards")}>Yards / G</Chip>
          <Chip active={metric === "tds"} onClick={() => setMetric("tds")}>TDs / G</Chip>
          <Chip active={metric === "volume"} onClick={() => setMetric("volume")}>Targets · Carries / G</Chip>
        </div>
        {metric !== "volume" && <Toggle checked={showVsAvg} onChange={setShowVsAvg} label="Show % vs league avg" />}
        <SearchBox value={search} onChange={setSearch} placeholder="Search team / opponent" />
      </div>

      <TableShell maxHeight="75vh">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-card border-b border-border">
            <tr>
              <SortHeader label="Defense" col="team" current={sort.key} dir={sort.dir} onSort={sort.onSort} className="min-w-[150px]" />
              <PlainHeader label="Faces" />
              {DVP_CATEGORIES.map((c) => (
                <SortHeader key={c} label={DVP_LABELS[c]} col={c} current={sort.key} dir={sort.dir} onSort={sort.onSort} className="text-right" />
              ))}
            </tr>
            <tr className="border-t border-border/60">
              <td className="px-2.5 py-1 text-[10px] text-muted-foreground" colSpan={2}>League avg</td>
              {DVP_CATEGORIES.map((c) => {
                const a = leagueAvg[c];
                const v = metric === "yards" ? a.yardsPg : metric === "tds" ? a.tdsPg : a.volumePg;
                return <td key={c} className="px-2.5 py-1 text-[10px] text-muted-foreground font-mono text-right tabular-nums">{fmt(v)}</td>;
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((d) => (
              <tr key={d.team} className="hover:bg-muted/40 transition-colors">
                <td className="px-2.5 py-1.5">
                  <div className="font-semibold text-[12px]">{d.team}</div>
                  <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{d.name}</div>
                </td>
                <td className="px-2.5 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                  {d.opponentThisWeek ? `${d.opponentThisWeek} offense` : "Bye"}
                </td>
                {DVP_CATEGORIES.map((c) => {
                  const cell = d.cells[c];
                  const rank = metric === "yards" ? cell.yardsRank : metric === "tds" ? cell.tdsRank : volumeRanks[c][d.team];
                  const vsAvg = metric === "yards" ? cell.yardsVsAvg : cell.tdsVsAvg;
                  return (
                    <td key={c} className="px-1.5 py-1.5 text-right">
                      <span
                        className={`inline-block min-w-[52px] text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded tabular-nums ${rankClass(rank)}`}
                        title={`${DVP_LABELS[c]}: ${cell.yardsPg.toFixed(1)} yds · ${cell.tdsPg.toFixed(2)} TD · ${cell.volumePg.toFixed(1)} ${VOLUME_LABEL[c]}${c.endsWith("_REC") ? ` · ${cell.receptionsPg.toFixed(1)} rec` : ""} per game (${cell.games}g) — rank ${rank}/32`}
                      >
                        {showVsAvg && metric !== "volume" ? signedPct(vsAvg) : fmt(metricValue(d, c, metric))}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
      <p className="text-[11px] text-muted-foreground">
        Green = generous (good matchup for the offense), red = stingy. Ranks 1–32 where 32 allows the most.
        Slot/Wide splits use estimated WR roles. Early-season samples are small — the player matchup score shrinks these toward league average.
      </p>
    </div>
  );
}
