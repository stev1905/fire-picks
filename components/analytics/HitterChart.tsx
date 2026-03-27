"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import type { RankedBatter } from "@/lib/analytics";

interface Props {
  data: RankedBatter[];
  title: string;
  subtitle: string;
  icon: string;
  hot: boolean; // true = green gradient, false = blue/cool gradient
}

const HOT_COLORS = ["#f97316", "#fb923c", "#fdba74", "#fed7aa", "#ffedd5",
                    "#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b"];
const COLD_COLORS = ["#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe", "#dbeafe",
                     "#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9"];

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const b: RankedBatter = payload[0].payload.raw;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-xl text-xs space-y-1 min-w-44">
      <div className="font-semibold text-sm">{b.name}</div>
      <div className="text-muted-foreground">{b.teamAbbreviation} · {b.position}</div>
      <div className="border-t border-border pt-1.5 mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-muted-foreground">L3 AVG</span><span className="font-mono font-bold">{b.last3AVG.toFixed(3).replace(/^0/,"")}</span>
        <span className="text-muted-foreground">L6 AVG</span><span className="font-mono">{b.last6AVG.toFixed(3).replace(/^0/,"")}</span>
        <span className="text-muted-foreground">Streak</span><span className="font-mono">{b.hittingStreak}G</span>
        <span className="text-muted-foreground">vs {b.opposingPitcherHand ?? "?"}HP</span>
        <span className="font-mono">
          {(b.opposingPitcherHand === "L" ? b.avgVsLeft : b.avgVsRight).toFixed(3).replace(/^0/,"")}
        </span>
      </div>
    </div>
  );
};

export function HitterChart({ data, title, subtitle, icon, hot }: Props) {
  const colors = hot ? HOT_COLORS : COLD_COLORS;
  const chartData = data.map((b, i) => ({
    name: b.name.split(" ").pop() ?? b.name, // last name for axis
    score: parseFloat(b.score.toFixed(3)),
    team: b.teamAbbreviation,
    raw: b,
    color: colors[i] ?? colors[colors.length - 1],
  }));

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">{icon}</span>
            <h3 className="font-bold text-base">{title}</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
          Not enough data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
            <XAxis type="number" hide domain={[0, "auto"]} />
            <YAxis
              type="category"
              dataKey="name"
              width={80}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
            <Bar dataKey="score" radius={[0, 4, 4, 0]} maxBarSize={20}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
              <LabelList
                dataKey="team"
                position="right"
                style={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
