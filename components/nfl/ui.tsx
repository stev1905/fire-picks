"use client";

import { useState } from "react";
import type { NFLGame, SkillPos } from "@/types/nfl";

export type SortDir = "asc" | "desc";

export function SortHeader<K extends string>({
  label, col, current, dir, onSort, className = "", title,
}: {
  label: string;
  col: K;
  current: K;
  dir: SortDir;
  onSort: (col: K) => void;
  className?: string;
  title?: string;
}) {
  const active = current === col;
  return (
    <th
      title={title}
      className={`px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      } ${className}`}
      onClick={() => onSort(col)}
    >
      {label}
      <span className="ml-1 opacity-50">{active ? (dir === "desc" ? "↓" : "↑") : "↕"}</span>
    </th>
  );
}

export function PlainHeader({ label, className = "" }: { label: string; className?: string }) {
  return (
    <th className={`px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap ${className}`}>
      {label}
    </th>
  );
}

// Clicking the active column flips direction; a new column starts descending
export function useTableSort<K extends string>(initial: K, initialDir: SortDir = "desc") {
  const [key, setKey] = useState<K>(initial);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const onSort = (col: K) => {
    if (col === key) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setKey(col); setDir("desc"); }
  };
  return { key, dir, onSort };
}

export function Chip({
  active, onClick, children, title,
}: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
        active ? "brand-gradient text-white shadow-sm" : "bg-muted text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function FilterLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] text-muted-foreground uppercase tracking-wide shrink-0">{children}</span>;
}

export function Select<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="text-xs bg-muted border border-border rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-orange-500" />
      {label}
    </label>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="text-xs bg-muted border border-border rounded-md px-2 py-1 w-40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    />
  );
}

export function TableShell({ children, maxHeight = "70vh" }: { children: React.ReactNode; maxHeight?: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="overflow-auto" style={{ maxHeight }}>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-8 text-center text-sm text-muted-foreground">{children}</div>
  );
}

// Rank 32 = most generous defense = best matchup for the offense
export function rankClass(rank: number): string {
  if (rank >= 28) return "bg-green-500/20 text-green-700 dark:text-green-400";
  if (rank >= 22) return "bg-green-500/10 text-green-700 dark:text-green-400";
  if (rank <= 5)  return "bg-red-500/20 text-red-600 dark:text-red-400";
  if (rank <= 11) return "bg-red-500/10 text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

export function edgeClass(edge: number): string {
  if (edge >= 0.15) return "text-green-600 dark:text-green-400";
  if (edge >= 0.05) return "text-green-600/80 dark:text-green-400/80";
  if (edge <= -0.15) return "text-red-500 dark:text-red-400";
  if (edge <= -0.05) return "text-red-500/80 dark:text-red-400/80";
  return "text-muted-foreground";
}

export function scoreClass(score: number): string {
  if (score >= 70) return "bg-green-500/90 text-white";
  if (score >= 58) return "bg-green-600/70 text-white";
  if (score <= 30) return "bg-red-500/80 text-white";
  if (score <= 42) return "bg-orange-500/70 text-white";
  return "bg-muted text-muted-foreground";
}

export function tdClass(score: number): string {
  if (score >= 55) return "bg-orange-500 text-white";
  if (score >= 40) return "bg-orange-500/70 text-white";
  if (score >= 25) return "bg-orange-500/25 text-orange-700 dark:text-orange-300";
  return "bg-muted text-muted-foreground";
}

export function signedPct(v: number): string {
  const p = Math.round(v * 100);
  return `${p > 0 ? "+" : ""}${p}%`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

const POS_COLORS: Record<SkillPos, string> = {
  QB: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  RB: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  WR: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  TE: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

export function PosBadge({ pos, role }: { pos: SkillPos; role?: string | null }) {
  return (
    <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${POS_COLORS[pos]}`}>
      {pos}{role ? ` · ${role === "SLOT" ? "Slot" : "Wide"}` : ""}
    </span>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const cls =
    s === "out" || s.includes("reserve") || s.includes("suspen")
      ? "bg-red-500/90 text-white"
      : s === "doubtful"
      ? "bg-orange-500/90 text-white"
      : s === "questionable"
      ? "bg-amber-400/90 text-black"
      : "bg-muted text-muted-foreground";
  const short = s.includes("reserve") ? "IR" : s === "questionable" ? "Q" : s === "doubtful" ? "D" : status;
  return <span title={status} className={`text-[9px] font-bold px-1 py-0.5 rounded ${cls}`}>{short}</span>;
}

export function gameStarted(g: NFLGame | undefined): boolean {
  return !!g && g.status !== "STATUS_SCHEDULED";
}

export function kickoff(utc: string): string {
  return new Date(utc).toLocaleString("en-US", {
    weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
}

export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
