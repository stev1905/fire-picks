"use client";

import { useState } from "react";
import type { NBADailySnapshot } from "@/types/nba";
import { FirstBasketTable } from "./FirstBasketTable";
import { PropsTable } from "./PropsTable";
import { useGameFilter } from "./GameFilter";
import { timeAgo } from "@/components/nfl/ui";

const TABS = [
  { key: "firstBasket", label: "First Basket" },
  { key: "hot",         label: "Hot Props" },
  { key: "safe",        label: "Super Safe Picks" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function NBADashboard({ snapshot }: { snapshot: NBADailySnapshot }) {
  const [tab, setTab] = useState<TabKey>("firstBasket");
  const s = snapshot;
  const filter = useGameFilter(s.games);   // shared, so picked games carry across tabs
  const day = new Date(`${s.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">NBA · {day}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {s.games.length} game{s.games.length === 1 ? "" : "s"} · {s.gamesOfData} games of play-by-play · synced {timeAgo(s.syncedAt)}
          </p>
        </div>
        {s.gamesOfData < 60 && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 max-w-md">
            Early season: player rates are shrunk toward shot volume until samples grow.
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
            {t.key !== "firstBasket" && (
              <span className="ml-1.5 text-[10px] font-bold text-muted-foreground tabular-nums">
                {s.props.filter((p) => p.category === t.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "firstBasket" && <FirstBasketTable snapshot={s} filter={filter} />}
      {tab === "hot"         && <PropsTable mode="hot" props={s.props} games={s.games} filter={filter} />}
      {tab === "safe"        && <PropsTable mode="safe" props={s.props} games={s.games} filter={filter} />}
    </div>
  );
}
