"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MLBBatter, MLBPitcher } from "@/types/mlb";
import {
  calcHitScoreBreakdown, calcHRScoreBreakdown,
  calcPitchMatchup,
  isBouncebackHit, isBouncebackHR,
  scoreBadgeClass, type ScoreBreakdown, type ScoreOptions,
} from "@/lib/scores";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer,
} from "recharts";

interface Props {
  batter: MLBBatter;
  opposingPitcher?: MLBPitcher;
  parkFactor?: number;
  scoreOpts?: ScoreOptions;
}

function stat(value: number) {
  return value.toFixed(3).replace(/^0/, "");
}

function matchupBadge(batter: MLBBatter, pitcher?: MLBPitcher) {
  if (!pitcher) return null;
  const avg = pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight;
  const avgStr = avg.toFixed(3).replace(/^0/, "");
  const hand = pitcher.hand === "L" ? "LHP" : "RHP";
  if (avg >= 0.280) return { label: `${avgStr} vs ${hand}`, color: "bg-green-500/90 text-white" };
  if (avg <= 0.210) return { label: `${avgStr} vs ${hand}`, color: "bg-red-500/80 text-white" };
  return { label: `${avgStr} vs ${hand}`, color: "bg-muted text-muted-foreground" };
}

function pitchMatchupBadge(batter: MLBBatter, pitcher?: MLBPitcher) {
  if (!pitcher) return null;
  const pm = calcPitchMatchup(batter, pitcher);
  if (!pm) return null;
  if (pm.delta >= 2) return { badge: `Pitch ↑ ${pm.value}`, badgeColor: "bg-green-500/80 text-white", detail: pm.detail };
  if (pm.delta <= -2) return { badge: `Pitch ↓ ${pm.value}`, badgeColor: "bg-red-500/80 text-white", detail: pm.detail };
  // Neutral — show detail only, no colored badge
  return pm.detail ? { badge: null, badgeColor: "", detail: pm.detail } : null;
}

function h2hBadge(batter: MLBBatter) {
  const h2h = batter.vsCurrentPitcher;
  if (!h2h || h2h.atBats === 0) return null;
  const avgStr = h2h.avg.toFixed(3).replace(/^0/, "");
  const label = `H2H: ${avgStr} (${h2h.hits}/${h2h.atBats})`;
  if (h2h.atBats < 5) return { label, color: "bg-muted/60 text-muted-foreground" };
  if (h2h.avg >= 0.300) return { label, color: "bg-blue-500/80 text-white" };
  if (h2h.avg <= 0.180) return { label, color: "bg-orange-500/80 text-white" };
  return { label, color: "bg-muted text-muted-foreground" };
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex flex-col items-center p-1 rounded ${highlight ? "bg-secondary" : "bg-muted"}`}>
      <span className="text-[8px] text-muted-foreground uppercase tracking-wide leading-tight">{label}</span>
      <span className="font-mono font-bold text-[11px] leading-tight mt-0.5">{value}</span>
    </div>
  );
}

function WindowStats({ label, v3, v6, v10 }: { label: string; v3: number; v6: number; v10: number }) {
  return (
    <div className="grid grid-cols-4 gap-1 items-center">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <StatBox label="L3"  value={label === "HR" ? String(v3) : stat(v3)} />
      <StatBox label="L6"  value={label === "HR" ? String(v6) : stat(v6)} />
      <StatBox label="L10" value={label === "HR" ? String(v10) : stat(v10)} />
    </div>
  );
}

function ScoreBreakdownTooltip({ label, breakdown }: { label: string; breakdown: ScoreBreakdown }) {
  return (
    <div className="min-w-[230px] space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-sm">{label} Score</span>
        <span className="font-black text-lg tabular-nums">{breakdown.total} / 100</span>
      </div>
      <div className="h-px bg-current opacity-20" />
      <div className="space-y-2">
        {breakdown.components.map((c) => {
          const pct = c.max > 0 ? c.earned / c.max : 0;
          return (
            <div key={c.label} className="space-y-0.5">
              <div className="flex justify-between items-baseline text-[11px] gap-2">
                <span className="opacity-60 shrink-0">{c.label}</span>
                <span className="font-mono font-semibold tabular-nums">
                  {c.value ?? "—"}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-border">
                <div
                  className="h-1.5 rounded-full bg-primary/70 transition-all"
                  style={{ width: `${Math.round(pct * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScorePill({
  label, breakdown, active, onToggle,
}: {
  label: string;
  breakdown: ScoreBreakdown;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex flex-col items-center px-2.5 py-1 rounded-lg cursor-pointer select-none transition-opacity ${scoreBadgeClass(breakdown.total)} ${active ? "ring-2 ring-current ring-offset-1" : ""}`}
    >
      <span className="text-[8px] uppercase tracking-widest font-semibold leading-none opacity-80">
        {label}
      </span>
      <span className="text-lg font-black leading-tight tabular-nums">{breakdown.total}</span>
    </button>
  );
}

const ChartTooltipContent = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-card border border-border rounded-lg p-2 text-xs shadow-lg">
        <div className="text-muted-foreground">{label}</div>
        {payload.map((p: any) => (
          <div key={p.dataKey} style={{ color: p.color }}>
            {p.name}: {p.value.toFixed(3).replace(/^0/, "")}
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export function BatterCard({ batter, opposingPitcher, parkFactor = 1.0, scoreOpts = {} }: Props) {
  const [expandedPill, setExpandedPill] = useState<"HIT" | "HR" | null>(null);

  const hitBreakdown = calcHitScoreBreakdown(batter, opposingPitcher, parkFactor, scoreOpts);
  const hrBreakdown  = calcHRScoreBreakdown(batter, opposingPitcher, parkFactor, scoreOpts);
  const bounceHit    = isBouncebackHit(batter, hitBreakdown.total);
  const bounceHR     = isBouncebackHR(batter, hrBreakdown.total);
  const matchup      = matchupBadge(batter, opposingPitcher);
  const h2h          = h2hBadge(batter);
  const pitchMatchup = pitchMatchupBadge(batter, opposingPitcher);
  const hasStatcast  = batter.xBA !== undefined || batter.barrelPct !== undefined || batter.hardHitPct !== undefined;

  const togglePill = (pill: "HIT" | "HR") =>
    setExpandedPill((prev) => (prev === pill ? null : pill));

  const chartData = [...batter.last10Games].reverse().map((g, i) => ({
    name: `G${i + 1}`,
    AVG: g.avg,
    SLG: g.slg,
  }));

  const hitsIn10  = batter.last10Games.filter((g) => g.hits > 0).length;
  const hasLast10 = batter.last10Games.length > 0;
  const hitLabel  =
    hitsIn10 <= 2 ? { color: "text-red-500 dark:text-red-400",    icon: "🧊" }
    : hitsIn10 <= 4 ? { color: "text-orange-500 dark:text-orange-400", icon: "❄️" }
    : hitsIn10 >= 8 ? { color: "text-green-500 dark:text-green-400",   icon: "🔥" }
    : { color: "text-muted-foreground", icon: null };

  return (
    <Card>
        <CardHeader className="pb-1.5 pt-2 px-2">
          {/* Player name + badges */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-muted-foreground font-mono">#{batter.battingOrder}</span>
            <span className="font-semibold text-xs truncate">{batter.name}</span>
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">{batter.hand}</Badge>
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">{batter.position}</Badge>
          </div>

          {/* Streak + hit rate + bounce-back flags */}
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
            {batter.hittingStreak > 0 && (
              <span className="text-[10px] text-amber-500 dark:text-amber-400">
                🔥 {batter.hittingStreak}-game streak
              </span>
            )}
            {hasLast10 && (
              <span className={`text-[10px] ${hitLabel.color}`}>
                {hitLabel.icon && <span className="mr-0.5">{hitLabel.icon}</span>}
                {hitsIn10}/{batter.last10Games.length} w/hit
              </span>
            )}
            {bounceHit && (
              <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                🔄 Due for hit
              </span>
            )}
            {bounceHR && (
              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                💫 Due for HR
              </span>
            )}
          </div>

          {/* Score pills + matchup badge */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <ScorePill label="HIT" breakdown={hitBreakdown} active={expandedPill === "HIT"} onToggle={() => togglePill("HIT")} />
            <ScorePill label="HR"  breakdown={hrBreakdown}  active={expandedPill === "HR"}  onToggle={() => togglePill("HR")} />
            <div className="flex flex-wrap gap-1 ml-auto">
              {matchup && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${matchup.color}`}>
                  {matchup.label}
                </span>
              )}
              {h2h && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${h2h.color}`}>
                  {h2h.label}
                </span>
              )}
              {pitchMatchup?.badge && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${pitchMatchup.badgeColor}`}>
                  {pitchMatchup.badge}
                </span>
              )}
            </div>
          </div>

          {/* Pitch matchup inline detail */}
          {pitchMatchup?.detail && (
            <div className="text-[9px] text-muted-foreground mt-1 font-mono leading-snug">
              {pitchMatchup.detail}
            </div>
          )}

          {/* Inline score breakdown — shown on tap/click */}
          {expandedPill && (
            <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3">
              <ScoreBreakdownTooltip
                label={expandedPill}
                breakdown={expandedPill === "HIT" ? hitBreakdown : hrBreakdown}
              />
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-1.5 px-2 pb-2">
          <div className="text-[8px] text-muted-foreground/50 uppercase tracking-widest">
            Score factors
          </div>

          {/* Season + splits */}
          <div className="grid grid-cols-5 gap-1">
            <StatBox label="AVG"   value={stat(batter.seasonAVG)} highlight />
            <StatBox label="SLG"   value={stat(batter.seasonSLG)} highlight />
            <StatBox label="HR"    value={String(batter.seasonHR)} highlight />
            <StatBox label="vsLHP" value={stat(batter.avgVsLeft)} />
            <StatBox label="vsRHP" value={stat(batter.avgVsRight)} />
          </div>

          {/* Statcast row */}
          {hasStatcast && (
            <div className="grid grid-cols-3 gap-1">
              <StatBox label="xBA"    value={batter.xBA     !== undefined ? stat(batter.xBA)                         : "—"} />
              <StatBox label="Brl%"   value={batter.barrelPct  !== undefined ? `${batter.barrelPct.toFixed(1)}%`  : "—"} />
              <StatBox label="HH%"    value={batter.hardHitPct !== undefined ? `${batter.hardHitPct.toFixed(1)}%` : "—"} />
            </div>
          )}

          {/* Rolling windows */}
          <div className="space-y-0.5">
            <WindowStats label="AVG" v3={batter.last3AVG} v6={batter.last6AVG} v10={batter.last10AVG} />
            <WindowStats label="SLG" v3={batter.last3SLG} v6={batter.last6SLG} v10={batter.last10SLG} />
            <WindowStats label="HR"  v3={batter.last3HR}  v6={batter.last6HR}  v10={batter.last10HR} />
          </div>

          {/* Trend chart — desktop only */}
          {chartData.length > 0 && (
            <div className="hidden sm:block pt-0.5">
              <div className="text-[9px] text-muted-foreground mb-0.5 uppercase tracking-wide">
                Last 10 Trend
              </div>
              <ResponsiveContainer width="100%" height={55}>
                <LineChart data={chartData}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 8, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide domain={[0, "auto"]} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="AVG" stroke="#60a5fa" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="SLG" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex gap-3 text-[9px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-px bg-blue-400 inline-block" /> AVG
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-px bg-violet-400 inline-block" /> SLG
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
  );
}
