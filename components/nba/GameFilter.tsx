"use client";

import { useState } from "react";
import type { NBAGame } from "@/types/nba";
import { FilterLabel, Toggle } from "@/components/nfl/ui";

export function tipTime(utc: string): string {
  return new Date(utc).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

// Selection shared by every NBA table; an empty set means "all games"
export function useGameFilter(games: NBAGame[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hideStarted, setHideStarted] = useState(true);
  const byId = new Map(games.map((g) => [g.id, g]));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const matches = (gameId: string) =>
    (selected.size === 0 || selected.has(gameId)) &&
    !(hideStarted && byId.get(gameId)?.status !== "STATUS_SCHEDULED");
  return { selected, toggle, clear: () => setSelected(new Set()), hideStarted, setHideStarted, matches };
}

export type GameFilterState = ReturnType<typeof useGameFilter>;

export function GameFilter({ games, filter }: { games: NBAGame[]; filter: GameFilterState }) {
  const anyStarted = games.some((g) => g.status !== "STATUS_SCHEDULED");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <FilterLabel>Games</FilterLabel>
      {games.map((g) => (
        <label
          key={g.id}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border cursor-pointer select-none transition-colors ${
            filter.selected.has(g.id)
              ? "border-orange-500 bg-orange-500/10 text-foreground"
              : "border-border bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          <input type="checkbox" checked={filter.selected.has(g.id)} onChange={() => filter.toggle(g.id)} className="accent-orange-500" />
          <span className="font-semibold">{g.away.abbr} @ {g.home.abbr}</span>
          <span className="tabular-nums opacity-70">{tipTime(g.startTime)}</span>
        </label>
      ))}
      {filter.selected.size > 0 && (
        <button type="button" onClick={filter.clear} className="text-xs text-muted-foreground hover:text-foreground underline">
          Clear ({filter.selected.size})
        </button>
      )}
      {anyStarted && <Toggle checked={filter.hideStarted} onChange={filter.setHideStarted} label="Hide started games" />}
    </div>
  );
}
