"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MLBBatter, MLBPitcher } from "@/types/mlb";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

interface Props {
  batter: MLBBatter;
  opposingPitcher?: MLBPitcher;
}

function stat(value: number, decimals = 3) {
  return value.toFixed(decimals).replace(/^0/, "");
}

function matchupRating(batter: MLBBatter, pitcher?: MLBPitcher) {
  if (!pitcher) return null;
  const avg = pitcher.hand === "L" ? batter.avgVsLeft : batter.avgVsRight;
  const avgStr = avg.toFixed(3).replace(/^0/, "");
  const hand = pitcher.hand === "L" ? "LHP" : "RHP";
  if (avg >= 0.280) return { label: `${avgStr} vs ${hand}`, color: "bg-green-500/90 text-white" };
  if (avg <= 0.210) return { label: `${avgStr} vs ${hand}`, color: "bg-red-500/80 text-white" };
  return { label: `${avgStr} vs ${hand}`, color: "bg-muted text-muted-foreground" };
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
      <StatBox label="L3" value={label === "HR" ? String(v3) : stat(v3)} />
      <StatBox label="L6" value={label === "HR" ? String(v6) : stat(v6)} />
      <StatBox label="L10" value={label === "HR" ? String(v10) : stat(v10)} />
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
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

export function BatterCard({ batter, opposingPitcher }: Props) {
  const matchup = matchupRating(batter, opposingPitcher);
  const chartData = [...batter.last10Games].reverse().map((g, i) => ({
    name: `G${i + 1}`,
    AVG: g.avg,
    SLG: g.slg,
  }));

  const hitsIn10 = batter.last10Games.filter((g) => g.hits > 0).length;
  const hasLast10 = batter.last10Games.length > 0;
  const hitLabel =
    hitsIn10 <= 2 ? { color: "text-red-500 dark:text-red-400", icon: "🧊" }
    : hitsIn10 <= 4 ? { color: "text-orange-500 dark:text-orange-400", icon: "❄️" }
    : hitsIn10 >= 8 ? { color: "text-green-500 dark:text-green-400", icon: "🔥" }
    : { color: "text-muted-foreground", icon: null };

  return (
    <Card>
      <CardHeader className="pb-1.5 pt-2 px-2">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-muted-foreground font-mono">#{batter.battingOrder}</span>
              <span className="font-semibold text-xs truncate">{batter.name}</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">{batter.hand}</Badge>
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">{batter.position}</Badge>
            </div>
            <div className="flex flex-wrap gap-x-2 mt-0.5">
              {batter.hittingStreak > 0 && (
                <div className="text-[10px] text-amber-500 dark:text-amber-400">
                  🔥 {batter.hittingStreak}-game streak
                </div>
              )}
              {hasLast10 && (
                <div className={`text-[10px] ${hitLabel.color}`}>
                  {hitLabel.icon && <span className="mr-0.5">{hitLabel.icon}</span>}
                  {hitsIn10}/{batter.last10Games.length} w/hit
                </div>
              )}
            </div>
          </div>
          {matchup && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${matchup.color}`}>
              {matchup.label}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-1.5 px-2 pb-2">
        {/* Season + splits */}
        <div className="grid grid-cols-5 gap-1">
          <StatBox label="AVG" value={stat(batter.seasonAVG)} highlight />
          <StatBox label="SLG" value={stat(batter.seasonSLG)} highlight />
          <StatBox label="HR"  value={String(batter.seasonHR)} highlight />
          <StatBox label="vsL" value={stat(batter.avgVsLeft)} />
          <StatBox label="vsR" value={stat(batter.avgVsRight)} />
        </div>

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
                <Tooltip content={<CustomTooltip />} />
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
