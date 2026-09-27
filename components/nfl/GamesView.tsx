"use client";

import { useMemo, useState } from "react";
import type { LineUnit, NFLGame, NFLNewsItem, NFLPlayerMatchup, StarterAbsence, TeamTrenchReport } from "@/types/nfl";
import { isMissing } from "@/lib/nflModel";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Toggle, StatusBadge, PosBadge, tdClass, scoreClass, kickoff, gameStarted, timeAgo } from "./ui";

const IMPACT_CLASS: Record<NFLGame["weather"]["impact"], string> = {
  none: "bg-muted text-muted-foreground",
  minor: "bg-amber-400/80 text-black",
  moderate: "bg-orange-500/90 text-white",
  major: "bg-red-500/90 text-white",
};

function WeatherBlock({ game }: { game: NFLGame }) {
  const w = game.weather;
  if (w.indoor) {
    return <div className="text-xs text-muted-foreground">🏟️ Dome / closed roof — weather not a factor</div>;
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-base leading-none">{w.icon ?? "🌡️"}</span>
        {w.tempF != null ? (
          <span className="text-foreground">
            {w.tempF}°F · {w.condition} · wind {w.windMph} mph{w.gustMph ? ` (gusts ${w.gustMph})` : ""} · {w.precipChance}% precip
          </span>
        ) : (
          <span className="text-muted-foreground">Forecast unavailable</span>
        )}
        <span className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize ${IMPACT_CLASS[w.impact]}`}>
          {w.impact === "none" ? "No impact" : `${w.impact} impact`}
        </span>
      </div>
      {w.impact !== "none" && (
        <ul className="text-[11px] text-muted-foreground list-disc pl-5">
          {w.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

const DROPOFF_CLASS: Record<StarterAbsence["dropoff"], string> = {
  major: "bg-red-500/15 text-red-600 dark:text-red-400",
  moderate: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  minor: "bg-muted text-muted-foreground",
};

const UNIT_LABEL: Record<LineUnit, string> = {
  OL: "Offensive line", DL: "Defensive line", LB: "Linebackers", DB: "Secondary",
};

function AbsenceList({ unit, items }: { unit: LineUnit; items: StarterAbsence[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{UNIT_LABEL[unit]}</div>
      {items.length === 0 ? (
        <div className="text-[11px] text-green-600 dark:text-green-400">All regular starters available</div>
      ) : (
        <ul className="space-y-1.5 mt-0.5">
          {items.map((a) => (
            <li key={a.name} className="text-[11px]" title={a.note ?? `Status from ${a.source}`}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <StatusBadge status={a.status} />
                <span className="text-muted-foreground">{a.position}</span>
                <span className="font-medium">{a.name}</span>
                {a.injury && <span className="text-muted-foreground/70">({a.injury})</span>}
                <span className="text-[10px] text-muted-foreground/70">plays {Math.round(a.snapPct * 100)}% of snaps</span>
              </div>
              {a.replacement ? (
                <div className="pl-5 text-muted-foreground flex items-center gap-1.5 flex-wrap">
                  <span>→ {a.replacement.name} starts{a.replacement.slot ? ` at ${a.replacement.slot}` : ""}</span>
                  <span className="text-[10px]">
                    ({a.replacement.yearsExp === 0 ? "rookie" : a.replacement.yearsExp != null ? `${a.replacement.yearsExp} yr exp` : "exp n/a"},
                    {" "}{a.replacement.priorStarts} starts since last season)
                  </span>
                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase ${DROPOFF_CLASS[a.dropoff]}`}>{a.dropoff} drop-off</span>
                </div>
              ) : a.status === "Questionable" ? (
                <div className="pl-5 text-[10px] text-muted-foreground">Expected to play but limited — watch inactives ~90 min before kickoff</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrenchReport({ game }: { game: NFLGame }) {
  const side = (abbr: string, r: TeamTrenchReport) => (
    <div className="space-y-2">
      <div className="text-xs font-bold">{abbr}</div>
      {(["OL", "DL", "LB", "DB"] as const).map((u) => <AbsenceList key={u} unit={u} items={r[u]} />)}
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {side(game.away.abbr, game.trenches.away)}
        {side(game.home.abbr, game.trenches.home)}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Regular starters = top snap share at each unit this season and last, so players already moved to IR still count.
        Drop-off compares the replacement&apos;s experience: major = under 4 starts since last season, minor = 12+.
      </p>
    </div>
  );
}

function PlayerMini({ p, value, cls }: { p: NFLPlayerMatchup; value: string; cls: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums min-w-[32px] text-center ${cls}`}>{value}</span>
      <span className="truncate font-medium">{p.name}</span>
      <span className="text-muted-foreground">{p.team}</span>
      <PosBadge pos={p.position} role={p.wrRole} />
      <StatusBadge status={p.injuryStatus} />
    </div>
  );
}

function GameCard({ game, players, news }: { game: NFLGame; players: NFLPlayerMatchup[]; news: NFLNewsItem[] }) {
  const [tab, setTab] = useState<"overview" | "trenches" | "news">("overview");
  const active = players.filter((p) => !isMissing(p.injuryStatus));
  const topTD = [...active].sort((a, b) => b.tdProb - a.tdProb).slice(0, 5);
  const topEdges = [...active].filter((p) => p.usage.targetsPg + p.usage.carriesPg >= 4)
    .sort((a, b) => b.matchupScore - a.matchupScore).slice(0, 5);
  const trenchCount = (["home", "away"] as const).reduce((n, side) =>
    n + (["OL", "DL", "LB", "DB"] as const).reduce((m, u) => m + game.trenches[side][u].length, 0), 0);
  const spreadText = game.spread == null ? null
    : game.spread === 0 ? "PK"
    : game.spread < 0 ? `${game.home.abbr} ${game.spread}` : `${game.away.abbr} -${game.spread}`;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{kickoff(game.startTimeUTC)} ET</span>
          {gameStarted(game) && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted">
              {game.status === "STATUS_FINAL" ? "Final" : "In progress"}
            </span>
          )}
          <span className="truncate ml-2">{game.venue}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <div className="text-center flex-1">
            <div className="text-2xl font-bold">{game.away.abbr}</div>
            <div className="text-[11px] text-muted-foreground">{game.away.record} · proj {game.awayImplied?.toFixed(1) ?? "—"} pts</div>
          </div>
          <div className="text-center px-3">
            <div className="text-muted-foreground/50 font-bold text-lg">@</div>
            {spreadText && <div className="text-[10px] text-muted-foreground whitespace-nowrap">{spreadText} · total {game.total}</div>}
          </div>
          <div className="text-center flex-1">
            <div className="text-2xl font-bold">{game.home.abbr}</div>
            <div className="text-[11px] text-muted-foreground">{game.home.record} · proj {game.homeImplied?.toFixed(1) ?? "—"} pts</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <WeatherBlock game={game} />

        <div className="flex gap-1 border-b border-border">
          {([
            ["overview", "Overview"],
            ["trenches", `Starters missing${trenchCount ? ` (${trenchCount})` : ""}`],
            ["news", `News (${news.length})`],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-2 py-1 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                tab === k ? "border-orange-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="space-y-3">
            {game.notes.length > 0 && (
              <ul className="text-[11px] space-y-1">
                {game.notes.map((n) => (
                  <li key={n} className="flex gap-1.5"><span className="text-orange-500">▸</span><span>{n}</span></li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Most likely to score a TD</div>
                {topTD.map((p) => <PlayerMini key={p.id} p={p} value={`${p.tdScore}%`} cls={tdClass(p.tdScore)} />)}
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Best yardage matchups (score 0–100)</div>
                {topEdges.map((p) => <PlayerMini key={p.id} p={p} value={String(p.matchupScore)} cls={scoreClass(p.matchupScore)} />)}
              </div>
            </div>
          </div>
        )}

        {tab === "trenches" && <TrenchReport game={game} />}

        {tab === "news" && (
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {news.length === 0 && <li className="text-xs text-muted-foreground">No recent news.</li>}
            {news.map((n) => (
              <li key={n.headline + n.published} className="text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-muted-foreground">{n.team}</span>
                  {n.isInjuryRelated && <span className="text-[9px] font-bold px-1 rounded bg-red-500/15 text-red-600 dark:text-red-400">INJURY</span>}
                  <span className="text-muted-foreground/70">{timeAgo(n.published)}</span>
                </div>
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noreferrer" className="font-medium hover:text-primary hover:underline underline-offset-2">{n.headline}</a>
                ) : (
                  <span className="font-medium">{n.headline}</span>
                )}
                {n.byline && <span className="text-muted-foreground"> — {n.byline}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface Props {
  games: NFLGame[];
  players: NFLPlayerMatchup[];
  news: NFLNewsItem[];
}

export function GamesView({ games, players, news }: Props) {
  const [hideStarted, setHideStarted] = useState(true);
  const [weatherOnly, setWeatherOnly] = useState(false);

  const byGame = useMemo(() => {
    const m = new Map<string, NFLPlayerMatchup[]>();
    for (const p of players) (m.get(p.gameId) ?? m.set(p.gameId, []).get(p.gameId)!).push(p);
    return m;
  }, [players]);

  const shown = games.filter((g) =>
    !(hideStarted && gameStarted(g)) && !(weatherOnly && (g.weather.impact === "none" || g.weather.indoor)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <Toggle checked={hideStarted} onChange={setHideStarted} label="Hide started games" />
        <Toggle checked={weatherOnly} onChange={setWeatherOnly} label="Weather games only" />
      </div>
      {shown.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No games match.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {shown.map((g) => (
            <GameCard key={g.id} game={g} players={byGame.get(g.id) ?? []}
              news={news.filter((n) => n.team === g.home.abbr || n.team === g.away.abbr)} />
          ))}
        </div>
      )}
    </div>
  );
}
