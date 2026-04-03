"use client";

import { useState } from "react";
import { BatterCard } from "@/components/BatterCard";
import { Badge } from "@/components/ui/badge";
import type { MLBBatter, MLBPitcher } from "@/types/mlb";

type SortKey =
  | "batting-order"
  | "streak"
  | "avg-l3"
  | "avg-l6"
  | "avg-l10"
  | "slg-l3"
  | "slg-l6"
  | "slg-l10"
  | "vs-pitcher";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "batting-order", label: "Batting Order" },
  { value: "streak",        label: "Hit Streak" },
  { value: "avg-l3",        label: "AVG Last 3" },
  { value: "avg-l6",        label: "AVG Last 6" },
  { value: "avg-l10",       label: "AVG Last 10" },
  { value: "slg-l3",        label: "SLG Last 3" },
  { value: "slg-l6",        label: "SLG Last 6" },
  { value: "slg-l10",       label: "SLG Last 10" },
  { value: "vs-pitcher",    label: "AVG vs Pitcher" },
];

function sortBatters(batters: MLBBatter[], key: SortKey, pitcher?: MLBPitcher): MLBBatter[] {
  const s = [...batters];
  switch (key) {
    case "batting-order": return s.sort((a, b) => a.battingOrder - b.battingOrder);
    case "streak":        return s.sort((a, b) => b.hittingStreak - a.hittingStreak);
    case "avg-l3":        return s.sort((a, b) => b.last3AVG - a.last3AVG);
    case "avg-l6":        return s.sort((a, b) => b.last6AVG - a.last6AVG);
    case "avg-l10":       return s.sort((a, b) => b.last10AVG - a.last10AVG);
    case "slg-l3":        return s.sort((a, b) => b.last3SLG - a.last3SLG);
    case "slg-l6":        return s.sort((a, b) => b.last6SLG - a.last6SLG);
    case "slg-l10":       return s.sort((a, b) => b.last10SLG - a.last10SLG);
    case "vs-pitcher": {
      if (!pitcher) return s.sort((a, b) => a.battingOrder - b.battingOrder);
      return s.sort((a, b) => {
        const aAvg = pitcher.hand === "L" ? a.avgVsLeft : a.avgVsRight;
        const bAvg = pitcher.hand === "L" ? b.avgVsLeft : b.avgVsRight;
        return bAvg - aAvg;
      });
    }
  }
}

interface Props {
  lineup: MLBBatter[];
  opposingPitcher?: MLBPitcher;
}

export function LineupSorter({ lineup, opposingPitcher }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("batting-order");

  if (lineup.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Lineup not yet posted.
      </div>
    );
  }

  const sorted = sortBatters(lineup, sortKey, opposingPitcher);

  return (
    <div className="space-y-3">
      {opposingPitcher && (
        <div className="text-sm text-muted-foreground">
          Facing:{" "}
          <span className="text-foreground font-medium">{opposingPitcher.name}</span>
          <Badge variant="outline" className="ml-1.5 text-[10px]">
            {opposingPitcher.hand}HP
          </Badge>
          <span className="ml-1.5">ERA {opposingPitcher.seasonERA.toFixed(2)}</span>
        </div>
      )}

      {/* Sort control */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide shrink-0">Sort</span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="text-xs bg-muted border border-border rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {sorted.map((batter) => (
          <BatterCard key={batter.id} batter={batter} opposingPitcher={opposingPitcher} />
        ))}
      </div>
    </div>
  );
}
