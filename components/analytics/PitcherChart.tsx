"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  Legend,
} from "recharts";
import type { RankedPitcher } from "@/lib/analytics";

interface Props {
  data: RankedPitcher[];
}

const COLORS = ["#f97316", "#fb923c", "#fdba74", "#fed7aa", "#ffedd5",
                "#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b"];

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p: RankedPitcher = payload[0].payload.raw;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-xl text-xs space-y-1 min-w-44">
      <div className="font-semibold text-sm">{p.name}</div>
      <div className="text-muted-foreground">{p.teamAbbreviation} · {p.hand}HP</div>
      <div className="border-t border-border pt-1.5 mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-muted-foreground">Season ERA</span><span className="font-mono font-bold">{p.seasonERA.toFixed(2)}</span>
        <span className="text-muted-foreground">L3 ERA</span><span className="font-mono">{p.last3ERA.toFixed(2)}</span>
        <span className="text-muted-foreground">L3 K</span><span className="font-mono">{p.last3Strikeouts}</span>
        <span className="text-muted-foreground">K/G</span><span className="font-mono">{p.kPerGame.toFixed(1)}</span>
      </div>
    </div>
  );
};

export function PitcherChart({ data }: Props) {
  const chartData = data.map((p, i) => ({
    name: p.name.split(" ").pop() ?? p.name,
    era: parseFloat(p.last3ERA.toFixed(2)),
    strikeouts: p.last3Strikeouts,
    kPerGame: parseFloat(p.kPerGame.toFixed(1)),
    team: p.teamAbbreviation,
    raw: p,
    color: COLORS[i] ?? COLORS[COLORS.length - 1],
  }));

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-xl">🔥</span>
          <h3 className="font-bold text-base">Hottest Pitchers</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Ranked by last 3 starts — ERA, strikeouts per game & total K count
        </p>
      </div>

      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
          Not enough data yet
        </div>
      ) : (
        <div className="space-y-6">
          {/* ERA chart */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Last 3 Starts ERA (lower = better)</p>
            <ResponsiveContainer width="100%" height={250}>
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
                <Bar dataKey="era" radius={[0, 4, 4, 0]} maxBarSize={18}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={COLORS[i] ?? COLORS[COLORS.length - 1]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* K/Game chart */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Strikeouts per Start (last 3)</p>
            <ResponsiveContainer width="100%" height={250}>
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
                <Bar dataKey="kPerGame" radius={[0, 4, 4, 0]} maxBarSize={18} fill="#60a5fa">
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill="#60a5fa" opacity={1 - i * 0.07} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Total K count */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Total Strikeouts (last 3 starts)</p>
            <ResponsiveContainer width="100%" height={250}>
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
                <Bar dataKey="strikeouts" radius={[0, 4, 4, 0]} maxBarSize={18} fill="#a78bfa">
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill="#a78bfa" opacity={1 - i * 0.07} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
