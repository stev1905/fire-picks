"use client";

import { useMemo, useState } from "react";
import type { NFLGame, NFLInjury, NFLNewsItem } from "@/types/nfl";
import { Chip, FilterLabel, Select, Toggle, SearchBox, EmptyState, StatusBadge, timeAgo } from "./ui";

type Unit = NFLInjury["unit"];
// Trenches first — OL/DL injuries swing run games and pass rush the most
const UNITS: Unit[] = ["OL", "DL", "LB", "DB", "QB", "RB", "WR", "TE"];
const UNIT_ORDER = Object.fromEntries(UNITS.map((u, i) => [u, i])) as Record<Unit, number>;
const STATUS_ORDER: Record<string, number> = { Out: 0, "Injured Reserve": 1, Doubtful: 2, Questionable: 3 };
const STATUSES = ["Out", "Doubtful", "Questionable", "Injured Reserve"];

function InjuryRow({ inj, opponent }: { inj: NFLInjury; opponent: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full text-left">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={inj.status} />
          <span className="font-semibold text-[12px]">{inj.name}</span>
          <span className="text-[10px] text-muted-foreground">{inj.team} · {inj.position}</span>
          {inj.isStarter && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400">
              STARTER{inj.depthSlot ? ` · ${inj.depthSlot}` : ""}
            </span>
          )}
          {inj.injury && <span className="text-[10px] text-muted-foreground">{inj.injury}</span>}
          {opponent && <span className="text-[10px] text-muted-foreground/70">vs {opponent}</span>}
          <span className="ml-auto text-[10px] text-muted-foreground/70">{inj.updated ? timeAgo(inj.updated) : ""}</span>
        </div>
        {inj.shortComment && <p className="text-[11px] text-muted-foreground mt-1">{inj.shortComment}</p>}
        {inj.reporter && <p className="text-[10px] text-muted-foreground/80 mt-0.5">Source: {inj.reporter}</p>}
      </button>
      {open && inj.longComment && (
        <p className="text-[11px] text-foreground/80 mt-1.5 pl-3 border-l-2 border-orange-500/50">{inj.longComment}</p>
      )}
    </li>
  );
}

interface Props {
  injuries: NFLInjury[];
  news: NFLNewsItem[];
  games: NFLGame[];
}

export function InjuriesView({ injuries, news, games }: Props) {
  const [units, setUnits] = useState<Set<Unit>>(new Set(UNITS));
  const [statuses, setStatuses] = useState<Set<string>>(new Set(STATUSES));
  const [team, setTeam] = useState("ALL");
  const [startersOnly, setStartersOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [injuryNewsOnly, setInjuryNewsOnly] = useState(true);

  const opponentOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of games) { m.set(g.home.abbr, g.away.abbr); m.set(g.away.abbr, g.home.abbr); }
    return m;
  }, [games]);

  const teams = useMemo(() => [...new Set(injuries.map((i) => i.team))].sort(), [injuries]);

  const toggle = <T,>(set: Set<T>, v: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setter(next);
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return injuries
      .filter((i) =>
        units.has(i.unit) &&
        (!STATUSES.includes(i.status) || statuses.has(i.status)) &&
        (team === "ALL" || i.team === team) &&
        (!startersOnly || i.isStarter) &&
        (!q || i.name.toLowerCase().includes(q) || i.team.toLowerCase().includes(q)))
      .sort((a, b) =>
        UNIT_ORDER[a.unit] - UNIT_ORDER[b.unit] ||
        Number(b.isStarter) - Number(a.isStarter) ||
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        a.team.localeCompare(b.team));
  }, [injuries, units, statuses, team, startersOnly, search]);

  // Starters on the lines, by team — the headline number for trench mismatches
  const lineSummary = useMemo(() => {
    const out: { team: string; ol: number; dl: number }[] = [];
    for (const t of teams) {
      const missing = (u: Unit) => injuries.filter((i) =>
        i.team === t && i.unit === u && i.isStarter && ["Out", "Doubtful", "Injured Reserve"].includes(i.status)).length;
      const ol = missing("OL"), dl = missing("DL");
      if (ol || dl) out.push({ team: t, ol, dl });
    }
    return out.sort((a, b) => b.ol + b.dl - (a.ol + a.dl));
  }, [injuries, teams]);

  const newsRows = news.filter((n) => (!injuryNewsOnly || n.isInjuryRelated) && (team === "ALL" || n.team === team));

  return (
    <div className="space-y-5">
      {lineSummary.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
            Line starters Out / Doubtful
          </div>
          <div className="flex flex-wrap gap-2">
            {lineSummary.map((s) => (
              <button key={s.team} onClick={() => setTeam(s.team)}
                className="text-[11px] px-2 py-1 rounded-lg bg-muted hover:bg-muted/70 transition-colors">
                <b>{s.team}</b>
                {s.ol > 0 && <span className="ml-1.5 text-red-500">OL −{s.ol}</span>}
                {s.dl > 0 && <span className="ml-1.5 text-orange-500">DL −{s.dl}</span>}
                {opponentOf.get(s.team) && <span className="ml-1.5 text-muted-foreground">vs {opponentOf.get(s.team)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterLabel>Unit</FilterLabel>
          {UNITS.map((u) => (
            <Chip key={u} active={units.has(u)} onClick={() => toggle(units, u, setUnits)}>{u}</Chip>
          ))}
          <button className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            onClick={() => setUnits(new Set(["OL", "DL"]))}>Trenches only</button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterLabel>Status</FilterLabel>
          {STATUSES.map((s) => (
            <Chip key={s} active={statuses.has(s)} onClick={() => toggle(statuses, s, setStatuses)}>
              {s === "Injured Reserve" ? "IR" : s}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <FilterLabel>Team</FilterLabel>
          <Select value={team} onChange={setTeam} options={[{ value: "ALL", label: "All teams" }, ...teams.map((t) => ({ value: t, label: t }))]} />
        </div>
        <Toggle checked={startersOnly} onChange={setStartersOnly} label="Starters only" />
        <SearchBox value={search} onChange={setSearch} placeholder="Search player / team" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          {rows.length === 0 ? (
            <EmptyState>No injuries match these filters.</EmptyState>
          ) : (
            <div className="bg-card border border-border rounded-2xl px-4 max-h-[75vh] overflow-y-auto">
              <ul className="divide-y divide-border">
                {rows.map((i) => <InjuryRow key={i.espnId + i.name} inj={i} opponent={opponentOf.get(i.team) ?? null} />)}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">
            Click an entry for the full beat-reporter note. &quot;Starter&quot; = first on the ESPN depth chart.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest">Beat news</h3>
            <Toggle checked={injuryNewsOnly} onChange={setInjuryNewsOnly} label="Injury-related only" />
          </div>
          <div className="bg-card border border-border rounded-2xl px-4 max-h-[75vh] overflow-y-auto">
            {newsRows.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">No news items.</div>
            ) : (
              <ul className="divide-y divide-border">
                {newsRows.map((n) => (
                  <li key={n.team + n.headline + n.published} className="py-2 text-[11px]">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <b>{n.team}</b>
                      <span>{timeAgo(n.published)}</span>
                      {n.byline && <span className="truncate">· {n.byline}</span>}
                    </div>
                    {n.url ? (
                      <a href={n.url} target="_blank" rel="noreferrer" className="font-medium hover:text-primary hover:underline underline-offset-2">{n.headline}</a>
                    ) : (
                      <span className="font-medium">{n.headline}</span>
                    )}
                    {n.description && <p className="text-muted-foreground mt-0.5 line-clamp-2">{n.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
