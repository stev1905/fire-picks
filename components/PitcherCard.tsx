"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MLBPitcher } from "@/types/mlb";

interface Props {
  pitcher: MLBPitcher;
  role: "Home SP" | "Away SP";
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center p-2 rounded-lg bg-muted">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="font-mono font-bold text-sm mt-0.5">{value}</span>
    </div>
  );
}

function eraColor(era: number) {
  if (era <= 3.0) return "text-green-500 dark:text-green-400";
  if (era <= 4.0) return "text-yellow-500 dark:text-yellow-400";
  if (era <= 5.0) return "text-orange-500 dark:text-orange-400";
  return "text-red-500 dark:text-red-400";
}

export function PitcherCard({ pitcher, role }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">{role}</div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{pitcher.name}</span>
              <Badge variant="outline" className="text-[10px] px-1.5">
                {pitcher.hand}HP
              </Badge>
            </div>
          </div>
          <div className={`text-3xl font-bold font-mono ${eraColor(pitcher.seasonERA)}`}>
            {pitcher.seasonERA.toFixed(2)}
            <div className="text-xs text-muted-foreground text-right font-normal">ERA</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <div className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">ERA by stretch</div>
          <div className="grid grid-cols-3 gap-1.5">
            <StatBox label="Season" value={pitcher.seasonERA.toFixed(2)} />
            <StatBox label="Last 3" value={pitcher.last3ERA.toFixed(2)} />
            <StatBox label="Last 6" value={pitcher.last6ERA.toFixed(2)} />
          </div>
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">Hits Allowed</div>
          <div className="grid grid-cols-2 gap-1.5">
            <StatBox label="Last 3 Starts" value={String(pitcher.last3HitsAllowed)} />
            <StatBox label="Last 6 Starts" value={String(pitcher.last6HitsAllowed)} />
          </div>
        </div>

        {pitcher.last3Starts.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Recent Starts</div>
            <div className="space-y-1.5">
              {pitcher.last3Starts.map((start, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs bg-muted rounded-lg px-2.5 py-1.5"
                >
                  <span className="text-muted-foreground">
                    {new Date(start.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {" · "}
                    <span className="text-foreground">vs {start.opponent}</span>
                  </span>
                  <div className="flex gap-3 font-mono">
                    <span>{start.inningsPitched.toFixed(1)} IP</span>
                    <span className={eraColor(start.era)}>{start.hitsAllowed}H</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
