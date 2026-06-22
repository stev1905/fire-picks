"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { AiPickRow } from "@/lib/analytics";

type SortKey = "hitScore" | "gameTime" | "hitRate";
type SortDir = "asc" | "desc";

function scoreBadge(score: number) {
  if (score >= 70)
    return "bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/30";
  if (score >= 65)
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30";
  return "bg-muted text-muted-foreground border border-border";
}

function SortHeader({
  label,
  col,
  current,
  dir,
  onSort,
  className = "",
}: {
  label: string;
  col: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (col: SortKey) => void;
  className?: string;
}) {
  const active = current === col;
  return (
    <th
      className={`px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors ${className}`}
      onClick={() => onSort(col)}
    >
      {label}
      <span className="ml-1 opacity-50">
        {active ? (dir === "desc" ? "↓" : "↑") : "↕"}
      </span>
    </th>
  );
}

interface Props {
  data: AiPickRow[];
}

export function AiPicksTable({ data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("hitScore");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(col: SortKey) {
    if (col === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(col);
      setSortDir(col === "gameTime" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === "gameTime") {
        return sortDir === "asc"
          ? a.gameTimeIso.localeCompare(b.gameTimeIso)
          : b.gameTimeIso.localeCompare(a.gameTimeIso);
      }
      av = a[sortKey] as number;
      bv = b[sortKey] as number;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [data, sortKey, sortDir]);

  if (data.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8 text-center text-sm text-muted-foreground">
        No picks scoring ≥60 today — check back after lineups are posted.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <div className="overflow-y-auto max-h-[520px]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-card border-b border-border">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-7">#</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[140px]">Name</th>
                <SortHeader label="Score" col="hitScore" current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[68px]" />
                <SortHeader label="Game Time" col="gameTime" current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[100px]" />
                <SortHeader label="Hit Rate" col="hitRate" current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[76px]" />
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[160px]">Matchup</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[280px]">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((row, i) => (
                <tr key={`${row.id}-${row.gamePk}`} className="hover:bg-muted/40 transition-colors group">
                  <td className="px-3 py-2 text-[11px] text-muted-foreground tabular-nums">{i + 1}</td>

                  {/* Name + team */}
                  <td className="px-3 py-2">
                    <Link
                      href={`/game/${row.gamePk}`}
                      className="font-semibold text-[12px] hover:text-primary transition-colors hover:underline underline-offset-2"
                    >
                      {row.name}
                    </Link>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">{row.team}</span>
                      <span className="text-[9px] text-muted-foreground">#{row.slot}</span>
                      {row.bounceback && (
                        <span className="text-[9px] px-1 py-0.5 rounded-full bg-purple-600/85 text-white font-semibold leading-none">
                          ↑ BB
                        </span>
                      )}
                      {!row.bounceback && row.streak >= 5 && (
                        <span className="text-[9px] px-1 py-0.5 rounded-full bg-orange-500/80 text-white font-semibold leading-none">
                          🔥{row.streak}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Hit score */}
                  <td className="px-3 py-2">
                    <span className={`text-sm font-black tabular-nums px-2 py-0.5 rounded-lg ${scoreBadge(row.hitScore)}`}>
                      {row.hitScore}
                    </span>
                  </td>

                  {/* Game time */}
                  <td className="px-3 py-2 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                    {row.gameTime}
                  </td>

                  {/* Hit rate */}
                  <td className="px-3 py-2">
                    <span className={`font-mono font-semibold text-[12px] ${
                      row.hitRate >= 0.80 ? "text-green-600 dark:text-green-400" :
                      row.hitRate >= 0.65 ? "text-amber-600 dark:text-amber-400" :
                      "text-muted-foreground"
                    }`}>
                      {Math.round(row.hitRate * 100)}%
                    </span>
                  </td>

                  {/* Matchup */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] text-foreground/80">{row.pitcherName}</span>
                      <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                        row.pitcherHand === "L"
                          ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                          : "bg-orange-500/15 text-orange-600 dark:text-orange-400"
                      }`}>
                        {row.pitcherHand}HP
                      </span>
                      {row.pitcherH9 !== null && (
                        <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                          row.pitcherH9 >= 11
                            ? "bg-green-500/15 text-green-700 dark:text-green-400"
                            : row.pitcherH9 <= 7
                            ? "bg-red-500/15 text-red-700 dark:text-red-400"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {row.pitcherH9.toFixed(1)} H/9
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      ERA {row.pitcherERA.toFixed(2)}
                    </div>
                  </td>

                  {/* Blurb */}
                  <td className="px-3 py-2 text-[11px] text-muted-foreground leading-snug">
                    {row.blurb}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
