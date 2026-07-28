"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { BestSluggerRow } from "@/lib/analytics";

type SortKey = "hrScore" | "gameTime" | "barrelPct" | "hardHitPct" | "xwOBA" | "xSLG" | "flyBallRate" | "pitcherHrP9VsHand";
type SortDir = "asc" | "desc";

function scoreBadge(score: number) {
  if (score >= 60) return "bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/30";
  if (score >= 45) return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30";
  return "bg-muted text-muted-foreground border border-border";
}

function statColor(value: number | null, low: number, high: number, reverse = false) {
  if (value === null) return "text-muted-foreground";
  const good = reverse ? value <= low : value >= high;
  const bad  = reverse ? value >= high : value <= low;
  if (good) return "text-green-600 dark:text-green-400 font-semibold";
  if (bad)  return "text-red-500 dark:text-red-400";
  return "text-foreground";
}

function fmtStat(value: number | null, decimals = 1, suffix = "%"): string {
  if (value === null) return "—";
  return `${value.toFixed(decimals)}${suffix}`;
}

function SortHeader({
  label, col, current, dir, onSort, title, className = "",
}: {
  label: string; col: SortKey; current: SortKey; dir: SortDir;
  onSort: (col: SortKey) => void; title?: string; className?: string;
}) {
  const active = current === col;
  return (
    <th
      title={title}
      className={`px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors ${className}`}
      onClick={() => onSort(col)}
    >
      {label}
      <span className="ml-1 opacity-50">{active ? (dir === "desc" ? "↓" : "↑") : "↕"}</span>
    </th>
  );
}

interface Props { data: BestSluggerRow[] }

export function BestSluggersTable({ data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("hrScore");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(col: SortKey) {
    if (col === sortKey) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(col);
      setSortDir(col === "gameTime" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      if (sortKey === "gameTime") {
        return sortDir === "asc"
          ? a.gameTimeIso.localeCompare(b.gameTimeIso)
          : b.gameTimeIso.localeCompare(a.gameTimeIso);
      }
      const av = (a[sortKey] as number | null) ?? -999;
      const bv = (b[sortKey] as number | null) ?? -999;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [data, sortKey, sortDir]);

  if (data.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8 text-center text-sm text-muted-foreground">
        No batter data available. Run a sync to populate today&apos;s lineups.
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
                <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-7">#</th>
                <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[130px]">Name</th>
                <SortHeader label="HR Score" col="hrScore" current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[74px]" />
                <SortHeader label="Time" col="gameTime" current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[90px]" />
                <SortHeader label="Barrel%" col="barrelPct" current={sortKey} dir={sortDir} onSort={handleSort} title="Barrel rate — top Statcast HR predictor" className="min-w-[72px]" />
                <SortHeader label="Hard Hit%" col="hardHitPct" current={sortKey} dir={sortDir} onSort={handleSort} title="Hard hit ball % (exit velo ≥ 95 mph)" className="min-w-[80px]" />
                <SortHeader label="xwOBA" col="xwOBA" current={sortKey} dir={sortDir} onSort={handleSort} title="Expected weighted on-base average — best composite power metric" className="min-w-[70px]" />
                <SortHeader label="xSLG" col="xSLG" current={sortKey} dir={sortDir} onSort={handleSort} title="Expected SLG — expected damage" className="min-w-[64px]" />
                <SortHeader label="FB%" col="flyBallRate" current={sortKey} dir={sortDir} onSort={handleSort} title="Fly ball + line drive rate" className="min-w-[60px]" />
                <SortHeader label="P HR/9" col="pitcherHrP9VsHand" current={sortKey} dir={sortDir} onSort={handleSort} title="Pitcher HR allowed per 9 innings vs this batter's hand" className="min-w-[70px]" />
                <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[150px]">Pitcher</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((row, i) => (
                <tr key={`${row.id}-${row.gamePk}`} className="hover:bg-muted/40 transition-colors">
                  <td className="px-2 py-2 text-[11px] text-muted-foreground tabular-nums">{i + 1}</td>

                  {/* Name */}
                  <td className="px-2 py-2">
                    <Link
                      href={`/game/${row.gamePk}`}
                      className="font-semibold text-[12px] hover:text-primary transition-colors hover:underline underline-offset-2"
                    >
                      {row.name}
                    </Link>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {row.team} <span className="opacity-60">#{row.slot}</span>
                    </div>
                  </td>

                  {/* HR Score */}
                  <td className="px-2 py-2">
                    <span className={`text-sm font-black tabular-nums px-2 py-0.5 rounded-lg ${scoreBadge(row.hrScore)}`}>
                      {row.hrScore}
                    </span>
                  </td>

                  {/* Time */}
                  <td className="px-2 py-2 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                    {row.gameTime}
                  </td>

                  {/* Barrel% */}
                  <td className={`px-2 py-2 text-[12px] font-mono tabular-nums ${statColor(row.barrelPct, 8, 15)}`}>
                    {fmtStat(row.barrelPct)}
                  </td>

                  {/* Hard Hit% */}
                  <td className={`px-2 py-2 text-[12px] font-mono tabular-nums ${statColor(row.hardHitPct, 42, 52)}`}>
                    {fmtStat(row.hardHitPct)}
                  </td>

                  {/* xwOBA */}
                  <td className={`px-2 py-2 text-[12px] font-mono tabular-nums ${statColor(row.xwOBA, 0.310, 0.370)}`}>
                    {row.xwOBA !== null ? row.xwOBA.toFixed(3) : "—"}
                  </td>

                  {/* xSLG */}
                  <td className={`px-2 py-2 text-[12px] font-mono tabular-nums ${statColor(row.xSLG, 0.420, 0.540)}`}>
                    {row.xSLG !== null ? row.xSLG.toFixed(3) : "—"}
                  </td>

                  {/* FB% */}
                  <td className={`px-2 py-2 text-[12px] font-mono tabular-nums ${statColor(row.flyBallRate, 0.45, 0.58)}`}>
                    {row.flyBallRate !== null ? `${(row.flyBallRate * 100).toFixed(0)}%` : "—"}
                  </td>

                  {/* Pitcher HR/9 vs hand */}
                  <td className={`px-2 py-2 text-[12px] font-mono tabular-nums ${statColor(row.pitcherHrP9VsHand, 0.6, 1.4)}`}>
                    {row.pitcherHrP9VsHand !== null
                      ? row.pitcherHrP9VsHand.toFixed(2)
                      : row.pitcherHrP9Overall !== null
                      ? <span className="opacity-60">{row.pitcherHrP9Overall.toFixed(2)}</span>
                      : "—"}
                  </td>

                  {/* Pitcher */}
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] text-foreground/80 truncate max-w-[90px]">{row.pitcherName}</span>
                      <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                        row.pitcherHand === "L"
                          ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                          : "bg-orange-500/15 text-orange-600 dark:text-orange-400"
                      }`}>
                        {row.pitcherHand}HP
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      ERA {row.pitcherERA.toFixed(2)} · {row.pitcherSeasonHR} HR allowed
                    </div>
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
