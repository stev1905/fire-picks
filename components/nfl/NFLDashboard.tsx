"use client";

import { useState } from "react";
import type { NFLDailySnapshot } from "@/types/nfl";
import { PlayerEdgesTable } from "./PlayerEdgesTable";
import { TDBoard } from "./TDBoard";
import { DefenseTable } from "./DefenseTable";
import { GamesView } from "./GamesView";
import { InjuriesView } from "./InjuriesView";
import { timeAgo } from "./ui";

const TABS = [
  { key: "edges",    label: "Player Edges" },
  { key: "td",       label: "TD Board" },
  { key: "defense",  label: "Defense vs Position" },
  { key: "games",    label: "Games & Weather" },
  { key: "injuries", label: "Injuries & News" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function NFLDashboard({ snapshot }: { snapshot: NFLDailySnapshot }) {
  const [tab, setTab] = useState<TabKey>("edges");
  const s = snapshot;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">NFL Week {s.week}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {s.games.length} games · {s.weeksOfData} week{s.weeksOfData === 1 ? "" : "s"} of data · synced {timeAgo(s.syncedAt)}
          </p>
        </div>
        {s.weeksOfData < 4 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 max-w-md">
            Early season: defensive splits are shrunk toward league average until samples grow.
          </p>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.key ? "border-orange-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "edges"    && <PlayerEdgesTable players={s.players} games={s.games} />}
      {tab === "td"       && <TDBoard players={s.players} games={s.games} />}
      {tab === "defense"  && <DefenseTable defense={s.defense} leagueAvg={s.leagueAvg} />}
      {tab === "games"    && <GamesView games={s.games} players={s.players} news={s.news} />}
      {tab === "injuries" && <InjuriesView injuries={s.injuries} news={s.news} games={s.games} />}
    </div>
  );
}
