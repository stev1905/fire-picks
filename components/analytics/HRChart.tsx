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
  hot: boolean;
}

const HOT_COLORS = ["#ef4444", "#f87171", "#fca5a5", "#fecaca", "#fee2e2",
                    "#fef2f2", "#fde8e8", "#fbd0d0", "#f9b8b8", "#f7a0a0"];
const COLD_COLORS = ["#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe",
                     "#f5f3ff", "#ede9fe", "#ddd6fe", "#c4b5fd", "#a78bfa"];

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const b: RankedBatter = payload[0].payload.raw;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-xl text-xs space-y-1 min-w-40">
      <div className="font-semibold text-sm">{b.name}</div>
      <div className="text-muted-foreground">{b.teamAbbreviation}</div>
      <div className="border-t border-border pt-1.5 mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-muted-foreground">L3 HR</span><span className="font-mono font-bold">{b.last3HR}</span>
        <span className="text-muted-foreground">L6 HR</span><span className="font-mono">{b.last6HR}</span>
        <span className="text-muted-foreground">Season</span><span className="font-mono">{b.seasonHR}</span>
      </div>
    </div>
  );
};

export function HRChart({ data, title, subtitle, icon, hot }: Props) {
  const colors = hot ? HOT_COLORS : COLD_COLORS;
  const chartData = data.map((b, i) => ({
    name: b.name.split(" ").pop() ?? b.name,
    score: parseFloat((b.last3HR * 0.6 + b.last6HR * 0.4).toFixed(2)),
    team: b.teamAbbreviation,
    raw: b,
    color: colors[i] ?? colors[colors.length - 1],
  }));

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <h3 className="font-bold text-base">{title}</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
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
