"use client";

import { useState } from "react";
import { SkaterCard } from "@/components/SkaterCard";
import type { NHLSkater } from "@/types/nhl";

type SortKey =
  | "toi"
  | "goals-l3" | "goals-l6" | "goals-l10"
  | "sog-l3"   | "sog-l6"   | "sog-l10"
  | "points-l3"| "points-l6"| "points-l10"
  | "streak";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "toi",       label: "Avg TOI" },
  { value: "streak",    label: "Goal Streak" },
  { value: "goals-l3",  label: "Goals Last 3" },
  { value: "goals-l6",  label: "Goals Last 6" },
  { value: "goals-l10", label: "Goals Last 10" },
  { value: "sog-l3",    label: "SOG Last 3" },
  { value: "sog-l6",    label: "SOG Last 6" },
  { value: "sog-l10",   label: "SOG Last 10" },
  { value: "points-l3", label: "Points Last 3" },
  { value: "points-l6", label: "Points Last 6" },
  { value: "points-l10",label: "Points Last 10" },
];

function parseToi(toi: string): number {
  const parts = toi.split(":");
  return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
}

function sortSkaters(skaters: NHLSkater[], key: SortKey): NHLSkater[] {
  const s = [...skaters];
  switch (key) {
    case "toi":        return s.sort((a, b) => parseToi(b.avgToi) - parseToi(a.avgToi));
    case "streak":     return s.sort((a, b) => b.goalStreak - a.goalStreak);
    case "goals-l3":   return s.sort((a, b) => b.last3Goals - a.last3Goals);
    case "goals-l6":   return s.sort((a, b) => b.last6Goals - a.last6Goals);
    case "goals-l10":  return s.sort((a, b) => b.last10Goals - a.last10Goals);
    case "sog-l3":     return s.sort((a, b) => b.last3SOG - a.last3SOG);
    case "sog-l6":     return s.sort((a, b) => b.last6SOG - a.last6SOG);
    case "sog-l10":    return s.sort((a, b) => b.last10SOG - a.last10SOG);
    case "points-l3":  return s.sort((a, b) => b.last3Points - a.last3Points);
    case "points-l6":  return s.sort((a, b) => b.last6Points - a.last6Points);
    case "points-l10": return s.sort((a, b) => b.last10Points - a.last10Points);
    default: return s;
  }
}

interface Props {
  forwards: NHLSkater[];
  defensemen: NHLSkater[];
  label: string;
}

export function RosterSorter({ forwards, defensemen, label }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("toi");

  const allSkaters = [...forwards, ...defensemen];
  const sorted = sortSkaters(allSkaters, sortKey);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide shrink-0">Sort</span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="text-xs bg-muted border border-border rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {sorted.map((skater) => (
          <SkaterCard key={skater.id} skater={skater} />
        ))}
      </div>
    </div>
  );
}
