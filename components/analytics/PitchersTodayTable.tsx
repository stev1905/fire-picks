"use client";

import { useState } from "react";
import Link from "next/link";
import type { PitcherTodayRow } from "@/lib/analytics";

type SortKey = "name" | "era" | "avgH" | "l3Hits" | "matchup";
type Dir = "asc" | "desc";

const COLS: { key: SortKey; label: string; className: string }[] = [
  { key: "name",    label: "Pitcher",      className: "text-left" },
  { key: "matchup", label: "Matchup",      className: "text-center" },
  { key: "era",     label: "ERA",          className: "text-center" },
  { key: "avgH",    label: "Avg H/Start",  className: "text-center" },
  { key: "l3Hits",  label: "L3 Hits",      className: "text-center" },
];

function sortRows(rows: PitcherTodayRow[], key: SortKey, dir: Dir): PitcherTodayRow[] {
  return [...rows].sort((a, b) => {
    let v = 0;
    switch (key) {
      case "name":    v = a.name.localeCompare(b.name); break;
      case "matchup": v = a.opponentAbbreviation.localeCompare(b.opponentAbbreviation); break;
      case "era":     v = a.seasonERA - b.seasonERA; break;
      case "avgH":    v = a.avgHitsPerStart - b.avgHitsPerStart; break;
      case "l3Hits":  v = a.last3HitsAllowed - b.last3HitsAllowed; break;
    }
    return dir === "asc" ? v : -v;
  });
}

export function PitchersTodayTable({ rows }: { rows: PitcherTodayRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("avgH");
  const [dir, setDir] = useState<Dir>("asc");

  const toggle = (key: SortKey) => {
    if (sortKey === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setDir("asc"); }
  };

  const sorted = sortRows(rows, sortKey, dir);
  const arrow = (key: SortKey) =>
    sortKey === key ? (dir === "asc" ? " ↑" : " ↓") : "";

  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No starters announced yet.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[1fr_80px_60px_80px_70px] gap-2 px-4 py-2 bg-muted/50">
        {COLS.map((col) => (
          <button
            key={col.key}
            onClick={() => toggle(col.key)}
            className={`text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hover:text-foreground transition-colors ${col.className} ${sortKey === col.key ? "text-foreground" : ""}`}
          >
            {col.label}{arrow(col.key)}
          </button>
        ))}
      </div>

      <div className="divide-y divide-border">
        {sorted.map((p) => {
          const hitTier =
            p.avgHitsPerStart >= 8 ? "text-red-500 dark:text-red-400" :
            p.avgHitsPerStart >= 5 ? "text-amber-500 dark:text-amber-400" :
                                     "text-green-600 dark:text-green-400";
          return (
            <div
              key={`${p.gamePk}-${p.id}`}
              className="grid grid-cols-[1fr_80px_60px_80px_70px] gap-2 px-4 py-3 items-center hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Link
                  href={`/game/${p.gamePk}`}
                  className="font-medium text-sm hover:text-primary transition-colors truncate"
                >
                  {p.name}
                </Link>
                <span className="text-[10px] text-muted-foreground border border-border rounded px-1 shrink-0">
                  {p.hand}HP
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {p.teamAbbreviation}
                </span>
              </div>
              <div className="text-center text-xs text-muted-foreground">vs {p.opponentAbbreviation}</div>
              <div className="text-center text-sm tabular-nums">{p.seasonERA.toFixed(2)}</div>
              <div className={`text-center text-sm font-semibold tabular-nums ${hitTier}`}>
                {p.avgHitsPerStart.toFixed(1)}
              </div>
              <div className="text-center text-sm tabular-nums text-muted-foreground">
                {p.last3HitsAllowed}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
