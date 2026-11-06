"use client";

import { useMemo, useState } from "react";
import type { NBADailySnapshot, NBAFirstBasketRow } from "@/types/nba";
import { CollapsibleSection } from "@/components/analytics/CollapsibleSection";
import {
  FilterLabel, Toggle, SortHeader, TableShell, EmptyState, useTableSort,
} from "@/components/nfl/ui";

type SortKey =
  | "team" | "player" | "time" | "tip" | "gameShot" | "teamShot" | "shotPct" | "basket" | "l5" | "score";

const tipRate = (r: NBAFirstBasketRow) => (r.teamTipsGames ? r.teamTipsWon / r.teamTipsGames : -1);
const shotPct = (r: NBAFirstBasketRow) => (r.gamesPlayed ? r.firstTeamShots / r.gamesPlayed : 0);
const pct = (v: number) => `${Math.round(v * 100)}%`;

function tipTime(utc: string): string {
  return new Date(utc).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

function fbClass(score: number): string {
  if (score >= 70) return "bg-orange-500 text-white";
  if (score >= 52) return "bg-orange-500/70 text-white";
  if (score >= 36) return "bg-orange-500/25 text-orange-700 dark:text-orange-300";
  return "bg-muted text-muted-foreground";
}

function Count({ n, of }: { n: number; of?: number }) {
  return (
    <span className="tabular-nums">
      <span className={n > 0 ? "font-semibold" : "text-muted-foreground"}>{n}</span>
      {of !== undefined && <span className="text-muted-foreground text-[10px]"> / {of}</span>}
    </span>
  );
}

export function FirstBasketTable({ snapshot }: { snapshot: NBADailySnapshot }) {
  const { games, players } = snapshot;
  // Empty = every game
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleGame = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const [hideStarted, setHideStarted] = useState(true);
  const sort = useTableSort<SortKey>("score");

  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const anyStarted = games.some((g) => g.status !== "STATUS_SCHEDULED");

  const rows = useMemo(() => {
    const val = (r: NBAFirstBasketRow): number | string => {
      switch (sort.key) {
        case "team":     return r.team;
        case "player":   return r.name;
        case "time":     return r.startTime;
        case "tip":      return tipRate(r) * 1000 + r.teamTipsGames;   // ties broken by volume
        case "gameShot": return r.firstGameShots;
        case "teamShot": return r.firstTeamShots;
        case "shotPct":  return shotPct(r);
        case "basket":   return r.firstGameBaskets * 100 + r.firstTeamBaskets;
        case "l5":       return r.firstBasketsL5;
        case "score":    return r.prob;
      }
    };
    const cmp = (a: NBAFirstBasketRow, b: NBAFirstBasketRow) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return (sort.dir === "desc" ? -c : c) || b.prob - a.prob;
    };
    return players
      .filter((r) =>
        (selected.size === 0 || selected.has(r.gameId)) &&
        !(hideStarted && gameById.get(r.gameId)?.status !== "STATUS_SCHEDULED"))
      .sort(cmp);
  }, [players, selected, hideStarted, sort.key, sort.dir, gameById]);

  const H = (label: string, col: SortKey, title?: string, className?: string) => (
    <SortHeader label={label} col={col} current={sort.key} dir={sort.dir} onSort={sort.onSort} title={title} className={className} />
  );

  return (
    <div className="space-y-4">
      <CollapsibleSection title="How the first basket score works" defaultOpen={false}
        subtitle="P(team scores first) from the tip matchup × P(player makes his team's first field goal)">
        <div className="bg-card border border-border rounded-2xl p-4 text-xs text-muted-foreground space-y-2 leading-relaxed">
          <p><b className="text-foreground">First basket = first made field goal.</b> Free throws don&apos;t count, which matches how books settle first-basket and first-field-goal markets.</p>
          <p><b className="text-foreground">1. Tip.</b> Each team&apos;s projected jumper (<span className="font-bold">J</span>) is the starter with the most opening tips this season. His win rate is shrunk toward 50% with 4 phantom tips, then the two jumpers are compared head to head (log5).</p>
          <p><b className="text-foreground">2. Team scores first.</b> This season, the team that wins the tip has made the first field goal in <b className="text-foreground">{pct(snapshot.tipWinnerScoresFirst)}</b> of games (blended with a 57% prior). So P(team first) = P(win tip) × {pct(snapshot.tipWinnerScoresFirst)} + P(lose tip) × {pct(1 - snapshot.tipWinnerScoresFirst)}.</p>
          <p><b className="text-foreground">3. Player share.</b> This is his chance of making his team&apos;s first field goal, built from his starts with this team: <b className="text-foreground">40%</b> team-first-shot rate, <b className="text-foreground">35%</b> team-first-basket rate and <b className="text-foreground">25%</b> last-5-starts form. Each rate is shrunk toward his share of the starting five&apos;s shot attempts, so a 2-for-3 fluke doesn&apos;t dominate. The five shares are scaled to sum to 100% minus the small slice the bench takes.</p>
          <p><b className="text-foreground">4. Score.</b> P(first basket) = P(team first) × player share. The score is that probability ×4 (25% = 100). Fair odds are no-vig, so compare them to your book.</p>
          <p><b className="text-foreground">Starters.</b> These are <i>projected</i> from each team&apos;s last game, with anyone ruled Out replaced by the next most frequent starter. They switch to <i>confirmed</i> once the box score lists them at tip-off. GTD players are flagged.</p>
        </div>
      </CollapsibleSection>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <FilterLabel>Games</FilterLabel>
        {games.map((g) => (
          <label
            key={g.id}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border cursor-pointer select-none transition-colors ${
              selected.has(g.id)
                ? "border-orange-500 bg-orange-500/10 text-foreground"
                : "border-border bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleGame(g.id)} className="accent-orange-500" />
            <span className="font-semibold">{g.away.abbr} @ {g.home.abbr}</span>
            <span className="tabular-nums opacity-70">{tipTime(g.startTime)}</span>
          </label>
        ))}
        {selected.size > 0 && (
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground underline">
            Clear ({selected.size})
          </button>
        )}
        {anyStarted && <Toggle checked={hideStarted} onChange={setHideStarted} label="Hide started games" />}
      </div>

      {rows.length === 0 ? (
        <EmptyState>{players.length === 0 ? "No NBA games today." : "No starters match these filters."}</EmptyState>
      ) : (
        <TableShell>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-card border-b border-border">
              <tr>
                {H("Team", "team")}
                {H("Player", "player", undefined, "min-w-[170px]")}
                {H("Time (ET)", "time")}
                {H("Team Tips Won", "tip", "Opening tips his team has won this season")}
                {H("1st Game Shot", "gameShot", "Games he took the first field-goal attempt of the game")}
                {H("1st Team Shot", "teamShot", "Games he took his team's first field-goal attempt")}
                {H("1st Shot %", "shotPct", "Share of his games where he took his team's first shot")}
                {H("1st Basket", "basket", "Games he made the first field goal of the game (and his team's first)")}
                {H("1st Basket L5", "l5", "First field goal of the game in his last 5 games")}
                {H("FB Score", "score", "First basket score (probability × 4) with fair odds")}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const g = gameById.get(r.gameId);
                return (
                  <tr key={`${r.gameId}-${r.id}`} className="hover:bg-muted/40 transition-colors">
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <div className="text-[12px] font-bold">{r.team}</div>
                      <div className="text-[10px] text-muted-foreground">{r.isHome ? "vs" : "@"} {r.opponent}</div>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[12px]">{r.name}</span>
                        {r.isJumper && (
                          <span title={`Projected to take the opening tip${r.tipsTaken ? ` · won ${r.tipsWon} of ${r.tipsTaken} as jumper` : ""}`} className="text-[9px] font-bold px-1 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-400">J</span>
                        )}
                        {r.injuryStatus && (
                          <span title={r.injuryStatus} className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-400/90 text-black">GTD</span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {r.pos || "—"} · {r.lineup === "confirmed"
                          ? <span className="text-green-600 dark:text-green-400">confirmed starter</span>
                          : "projected starter"}
                      </div>
                    </td>
                    <td className="px-2.5 py-1.5 text-[12px] whitespace-nowrap tabular-nums">
                      {tipTime(r.startTime)}
                      {g && g.status !== "STATUS_SCHEDULED" && (
                        <div className="text-[10px] text-muted-foreground">{g.status === "STATUS_FINAL" ? "Final" : "Live"}</div>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-[12px] whitespace-nowrap tabular-nums">
                      {r.teamTipsGames ? (
                        <>
                          <span className="font-semibold">{pct(r.teamTipsWon / r.teamTipsGames)}</span>
                          <span className="text-muted-foreground text-[11px]"> ({r.teamTipsWon} of {r.teamTipsGames})</span>
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2.5 py-1.5 text-[12px]"><Count n={r.firstGameShots} of={r.gamesPlayed} /></td>
                    <td className="px-2.5 py-1.5 text-[12px]"><Count n={r.firstTeamShots} of={r.gamesPlayed} /></td>
                    <td className="px-2.5 py-1.5 text-[12px] whitespace-nowrap tabular-nums">
                      {r.gamesPlayed ? (
                        <>
                          <span className="font-semibold">{pct(shotPct(r))}</span>
                          <span className="text-muted-foreground text-[11px]"> ({r.firstTeamShots} of {r.gamesPlayed})</span>
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2.5 py-1.5 text-[12px] whitespace-nowrap">
                      <Count n={r.firstGameBaskets} of={r.gamesPlayed} />
                      <div className="text-[10px] text-muted-foreground">team 1st: {r.firstTeamBaskets}</div>
                    </td>
                    <td className="px-2.5 py-1.5 text-[12px]"><Count n={r.firstBasketsL5} of={r.l5Games} /></td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <span className={`text-[12px] font-bold px-2 py-0.5 rounded tabular-nums ${fbClass(r.score)}`}>{r.score}</span>
                      <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                        {(r.prob * 100).toFixed(1)}% · {r.fairOdds}
                      </div>
                      <div className="text-[10px] text-muted-foreground tabular-nums" title="P(team makes first FG) · P(he makes team's first FG)">
                        team {pct(r.pTeamFirst)} · share {pct(r.teamShare)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  );
}
