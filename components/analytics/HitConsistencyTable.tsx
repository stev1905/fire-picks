"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { HitConsistencyRow } from "@/lib/analytics";

type SortKey = "consistencyScore" | "hitRate10" | "hitRate20" | "hitRate30" | "hitRate40" | "pitcherL3Hits";
type SortDir = "asc" | "desc";

function pct(n: number): string {
  return n.toFixed(3).replace(/^0/, "");
}

function PctCell({ value }: { value: number }) {
  const color =
    value >= 0.8 ? "text-green-600 dark:text-green-400" :
    value >= 0.6 ? "text-amber-600 dark:text-amber-400" :
    value >= 0.4 ? "text-muted-foreground" :
    "text-red-500 dark:text-red-400";
  return <span className={`font-mono font-semibold ${color}`}>{pct(value)}</span>;
}

interface SortHeaderProps {
  label: string;
  col: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (col: SortKey) => void;
  className?: string;
}

function SortHeader({ label, col, current, dir, onSort, className = "" }: SortHeaderProps) {
  const active = current === col;
  return (
    <th
      className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none whitespace-nowrap hover:text-foreground transition-colors ${className}`}
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
  data: HitConsistencyRow[];
}

export function HitConsistencyTable({ data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("hitRate10");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(col: SortKey) {
    if (col === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(col);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [data, sortKey, sortDir]);

  if (data.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8 text-center text-sm text-muted-foreground">
        No batter data available yet
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <div className="overflow-y-auto max-h-[440px]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-card border-b border-border">
              <tr>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-8 shrink-0">#</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[130px]">Name</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[140px]">Matchup</th>
                <SortHeader label="L3 Hits" col="pitcherL3Hits" current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[72px]" />
                <SortHeader label="L10%" col="hitRate10" current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[68px]" />
                <SortHeader label="L20%" col="hitRate20" current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[68px]" />
                <SortHeader label="L30%" col="hitRate30" current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[68px]" />
                <SortHeader label="L40%" col="hitRate40" current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[68px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((row, i) => (
                <tr key={`${row.id}-${row.gamePk}`} className="hover:bg-muted/40 transition-colors">
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/game/${row.gamePk}`}
                      className="font-semibold text-[12px] hover:text-primary transition-colors hover:underline underline-offset-2"
                    >
                      {row.name}
                    </Link>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{row.teamAbbreviation}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-foreground/80 truncate max-w-[100px]">
                        {row.opposingPitcherName}
                      </span>
                      {row.opposingPitcherHand && (
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                          row.opposingPitcherHand === "L"
                            ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                            : "bg-orange-500/15 text-orange-600 dark:text-orange-400"
                        }`}>
                          {row.opposingPitcherHand}HP
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] font-mono text-muted-foreground tabular-nums">
                    {row.pitcherL3Hits}
                  </td>
                  <td className="px-3 py-2.5"><PctCell value={row.hitRate10} /></td>
                  <td className="px-3 py-2.5"><PctCell value={row.hitRate20} /></td>
                  <td className="px-3 py-2.5"><PctCell value={row.hitRate30} /></td>
                  <td className="px-3 py-2.5"><PctCell value={row.hitRate40} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
