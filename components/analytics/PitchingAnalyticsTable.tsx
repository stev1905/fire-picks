"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import type { PitcherAnalyticsRow } from "@/lib/analytics";

type SortKey =
  | "name" | "team" | "hand" | "l3Hits" | "l6Hits" | "l9Hits"
  | "avgH" | "era" | "l3ERA" | "hardHit" | "barrel" | "xba"
  | "whiff" | "kPct" | "l3HR" | "seasonHR";

type Dir = "asc" | "desc";

const COLS: { key: SortKey; label: string; title?: string }[] = [
  { key: "name",     label: "Pitcher" },
  { key: "team",     label: "Team" },
  { key: "hand",     label: "Hand" },
  { key: "l3Hits",   label: "L3 H",  title: "Hits allowed in last 3 starts" },
  { key: "l6Hits",   label: "L6 H",  title: "Hits allowed in last 6 starts" },
  { key: "l9Hits",   label: "L9 H",  title: "Hits allowed in last 9 starts" },
  { key: "avgH",     label: "H/GS",  title: "Average hits allowed per start (last 3)" },
  { key: "era",      label: "ERA",   title: "Season ERA" },
  { key: "l3ERA",    label: "L3 ERA",title: "ERA over last 3 starts" },
  { key: "hardHit",  label: "HH%",   title: "Opponent hard hit rate allowed" },
  { key: "barrel",   label: "Brl%",  title: "Barrel rate allowed" },
  { key: "xba",      label: "xBA",   title: "Expected batting average against (season)" },
  { key: "whiff",    label: "Whiff%",title: "Whiff rate induced (weighted across pitch types)" },
  { key: "kPct",     label: "K%",    title: "Strikeout rate (weighted across pitch types)" },
  { key: "l3HR",     label: "L3 HR", title: "Home runs allowed in last 3 starts" },
  { key: "seasonHR", label: "Szn HR",title: "Season home runs allowed" },
];

function getValue(row: PitcherAnalyticsRow, key: SortKey): number | string {
  switch (key) {
    case "name":     return row.name;
    case "team":     return row.teamAbbreviation;
    case "hand":     return row.hand;
    case "l3Hits":   return row.last3HitsAllowed;
    case "l6Hits":   return row.last6HitsAllowed;
    case "l9Hits":   return row.last9HitsAllowed;
    case "avgH":     return row.avgHitsPerStart;
    case "era":      return row.seasonERA;
    case "l3ERA":    return row.last3ERA;
    case "hardHit":  return row.hardHitAllowedPct ?? -1;
    case "barrel":   return row.barrelAllowedPct ?? -1;
    case "xba":      return row.xBAAgainst ?? -1;
    case "whiff":    return row.whiffPct ?? -1;
    case "kPct":     return row.kPct ?? -1;
    case "l3HR":     return row.last3HRAllowed;
    case "seasonHR": return row.seasonHRAllowed;
    default:         return 0;
  }
}

function sortRows(rows: PitcherAnalyticsRow[], key: SortKey, dir: Dir) {
  return [...rows].sort((a, b) => {
    const va = getValue(a, key);
    const vb = getValue(b, key);
    let cmp = 0;
    if (typeof va === "string" && typeof vb === "string") cmp = va.localeCompare(vb);
    else cmp = (va as number) - (vb as number);
    return dir === "asc" ? cmp : -cmp;
  });
}

function fmt(val: number | undefined, decimals = 1) {
  if (val === undefined || val === null) return <span className="text-muted-foreground/40">—</span>;
  return val.toFixed(decimals);
}

function fmtPct(val: number | undefined) {
  if (val === undefined || val === null || val <= 0) return <span className="text-muted-foreground/40">—</span>;
  return `${val.toFixed(1)}%`;
}

function fmtInt(val: number | undefined) {
  if (val === undefined || val === null) return <span className="text-muted-foreground/40">—</span>;
  return String(val);
}

function hitColor(avg: number) {
  if (avg >= 8) return "text-red-500 dark:text-red-400";
  if (avg >= 5) return "text-amber-500 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

function hardHitColor(pct: number | undefined) {
  if (!pct) return "";
  if (pct >= 42) return "text-red-500 dark:text-red-400";
  if (pct >= 36) return "text-amber-500 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

export function PitchingAnalyticsTable({ rows: initialRows }: { rows: PitcherAnalyticsRow[] }) {
  const [rows, setRows]       = useState<PitcherAnalyticsRow[]>(initialRows);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("avgH");
  const [dir, setDir]         = useState<Dir>("desc");
  const [search, setSearch]   = useState("");
  const [handFilter, setHandFilter] = useState<"ALL" | "L" | "R">("ALL");
  const [todayOnly, setTodayOnly]   = useState(false);
  const [minL3, setMinL3]     = useState("");
  const [maxERA, setMaxERA]   = useState("");
  const [minHH, setMinHH]     = useState("");

  useEffect(() => {
    fetch("/api/analytics/pitchers")
      .then((r) => r.ok ? r.json() : null)
      .then((data: PitcherAnalyticsRow[] | null) => {
        if (data && data.length > rows.length) setRows(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (key: SortKey) => {
    if (sortKey === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setDir("desc"); }
  };

  const arrow = (key: SortKey) => sortKey === key ? (dir === "asc" ? " ↑" : " ↓") : "";

  const filtered = useMemo(() => {
    let out = rows;
    if (todayOnly) out = out.filter((r) => r.isPlayingToday);
    if (handFilter !== "ALL") out = out.filter((r) => r.hand === handFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (r) => r.name.toLowerCase().includes(q) || r.teamAbbreviation.toLowerCase().includes(q)
      );
    }
    if (minL3 !== "") out = out.filter((r) => r.last3HitsAllowed >= parseFloat(minL3));
    if (maxERA !== "") out = out.filter((r) => r.seasonERA <= parseFloat(maxERA));
    if (minHH !== "") out = out.filter((r) => (r.hardHitAllowedPct ?? 0) >= parseFloat(minHH));
    return sortRows(out, sortKey, dir);
  }, [rows, todayOnly, handFilter, search, minL3, maxERA, minHH, sortKey, dir]);

  if (rows.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl px-4 py-8 text-center text-sm text-muted-foreground">
        No pitcher data available.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search pitcher or team…"
          className="h-8 rounded-lg border border-border bg-card px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[180px]"
        />
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
          {(["ALL", "L", "R"] as const).map((h) => (
            <button
              key={h}
              onClick={() => setHandFilter(h)}
              className={`px-3 h-8 transition-colors ${handFilter === h ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
            >
              {h === "ALL" ? "All" : `${h}HP`}
            </button>
          ))}
        </div>
        <button
          onClick={() => setTodayOnly((v) => !v)}
          className={`h-8 px-3 rounded-lg border text-xs font-medium transition-colors ${todayOnly ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
        >
          Today only
        </button>
        <input
          value={minL3}
          onChange={(e) => setMinL3(e.target.value)}
          placeholder="Min L3 H"
          type="number"
          className="h-8 w-[90px] rounded-lg border border-border bg-card px-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          value={maxERA}
          onChange={(e) => setMaxERA(e.target.value)}
          placeholder="Max ERA"
          type="number"
          className="h-8 w-[90px] rounded-lg border border-border bg-card px-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          value={minHH}
          onChange={(e) => setMinHH(e.target.value)}
          placeholder="Min HH%"
          type="number"
          className="h-8 w-[90px] rounded-lg border border-border bg-card px-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} pitcher{filtered.length !== 1 ? "s" : ""}
        {loading && <span className="text-muted-foreground/50"> · loading all starters…</span>}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        {/* Header */}
        <div className="grid grid-cols-[180px_72px_48px_56px_56px_56px_60px_60px_64px_60px_56px_56px_62px_56px_52px_60px] min-w-[1100px] gap-0 px-3 py-2 bg-muted/50 border-b border-border">
          {COLS.map((col) => (
            <button
              key={col.key}
              onClick={() => toggle(col.key)}
              title={col.title}
              className={`text-[10px] font-semibold uppercase tracking-widest hover:text-foreground transition-colors text-left truncate ${sortKey === col.key ? "text-foreground" : "text-muted-foreground"}`}
            >
              {col.label}{arrow(col.key)}
            </button>
          ))}
        </div>

        {/* Rows */}
        <div className="divide-y divide-border">
          {filtered.map((p) => {
            const isToday = p.isPlayingToday;
            return (
              <div
                key={p.id}
                className={`grid grid-cols-[180px_72px_48px_56px_56px_56px_60px_60px_64px_60px_56px_56px_62px_56px_52px_60px] min-w-[1100px] gap-0 px-3 py-2.5 items-center transition-colors hover:bg-muted/30 ${isToday ? "bg-amber-500/5 border-l-2 border-l-amber-500" : ""}`}
              >
                {/* Pitcher name */}
                <div className="flex items-center gap-1.5 min-w-0 pr-2">
                  {isToday && p.gamePk ? (
                    <Link
                      href={`/game/${p.gamePk}`}
                      className="text-sm font-medium truncate hover:text-primary transition-colors"
                    >
                      {p.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium truncate">{p.name}</span>
                  )}
                  {isToday && (
                    <span className="shrink-0 text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase">
                      ▶
                    </span>
                  )}
                </div>
                {/* Team */}
                <div className="text-xs text-muted-foreground truncate">
                  {isToday && p.opponentAbbreviation ? (
                    <span>
                      {p.teamAbbreviation}
                      <span className="text-muted-foreground/50"> vs {p.opponentAbbreviation}</span>
                    </span>
                  ) : (
                    p.teamAbbreviation
                  )}
                </div>
                {/* Hand */}
                <div className="text-center">
                  <span className="text-[10px] border border-border rounded px-1 text-muted-foreground">
                    {p.hand}HP
                  </span>
                </div>
                {/* L3 Hits */}
                <div className={`text-center text-sm tabular-nums font-semibold ${hitColor(p.last3HitsAllowed / p.starts)}`}>
                  {fmtInt(p.last3HitsAllowed)}
                </div>
                {/* L6 Hits */}
                <div className="text-center text-sm tabular-nums text-muted-foreground">
                  {fmtInt(p.last6HitsAllowed)}
                </div>
                {/* L9 Hits */}
                <div className="text-center text-sm tabular-nums text-muted-foreground">
                  {fmtInt(p.last9HitsAllowed)}
                </div>
                {/* Avg H/GS */}
                <div className={`text-center text-sm tabular-nums font-semibold ${hitColor(p.avgHitsPerStart)}`}>
                  {p.avgHitsPerStart.toFixed(1)}
                </div>
                {/* Season ERA */}
                <div className="text-center text-sm tabular-nums">
                  {fmt(p.seasonERA, 2)}
                </div>
                {/* L3 ERA */}
                <div className="text-center text-sm tabular-nums text-muted-foreground">
                  {fmt(p.last3ERA, 2)}
                </div>
                {/* Hard Hit% */}
                <div className={`text-center text-sm tabular-nums ${hardHitColor(p.hardHitAllowedPct)}`}>
                  {fmtPct(p.hardHitAllowedPct)}
                </div>
                {/* Barrel% */}
                <div className="text-center text-sm tabular-nums text-muted-foreground">
                  {fmtPct(p.barrelAllowedPct)}
                </div>
                {/* xBA */}
                <div className="text-center text-sm tabular-nums text-muted-foreground">
                  {p.xBAAgainst != null && p.xBAAgainst > 0 ? p.xBAAgainst.toFixed(3) : <span className="text-muted-foreground/40">—</span>}
                </div>
                {/* Whiff% */}
                <div className="text-center text-sm tabular-nums text-green-600 dark:text-green-400">
                  {fmtPct(p.whiffPct)}
                </div>
                {/* K% */}
                <div className="text-center text-sm tabular-nums text-muted-foreground">
                  {fmtPct(p.kPct)}
                </div>
                {/* L3 HR */}
                <div className={`text-center text-sm tabular-nums ${(p.last3HRAllowed >= 3) ? "text-red-500" : (p.last3HRAllowed >= 1) ? "text-amber-500" : "text-muted-foreground"}`}>
                  {p.last3HRAllowed}
                </div>
                {/* Season HR */}
                <div className="text-center text-sm tabular-nums text-muted-foreground">
                  {p.seasonHRAllowed}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground ml-1">
        ▶ = starting today · HH% = opponent hard hit rate · Brl% = barrel rate allowed · xBA = expected BA against · Whiff% = whiff rate induced · click headers to sort
      </p>
    </div>
  );
}
