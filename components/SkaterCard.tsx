"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { NHLSkater } from "@/types/nhl";

interface Props {
  skater: NHLSkater;
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
      <StatBox label="L3" value={String(v3)} />
      <StatBox label="L6" value={String(v6)} />
      <StatBox label="L10" value={String(v10)} />
    </div>
  );
}

export function SkaterCard({ skater }: Props) {
  return (
    <Card>
      <CardHeader className="pb-1.5 pt-2 px-2">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-muted-foreground font-mono">#{skater.sweaterNumber}</span>
              <span className="font-semibold text-xs truncate">{skater.name}</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">{skater.position}</Badge>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground">&#9201; {skater.avgToi}/gm</span>
              {skater.goalStreak > 0 && (
                <span className="text-[10px] text-amber-500 dark:text-amber-400">
                  &#128293; {skater.goalStreak}-gm goal streak
                </span>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-1.5 px-2 pb-2">
        {/* Season stats */}
        <div className="grid grid-cols-5 gap-1">
          <StatBox label="GP"  value={String(skater.seasonGP)} highlight />
          <StatBox label="G"   value={String(skater.seasonGoals)} highlight />
          <StatBox label="A"   value={String(skater.seasonAssists)} highlight />
          <StatBox label="Pts" value={String(skater.seasonPoints)} highlight />
          <StatBox label="SOG" value={String(skater.seasonSOG)} highlight />
        </div>

        {/* Rolling windows */}
        <div className="space-y-0.5">
          <WindowStats label="G"   v3={skater.last3Goals}  v6={skater.last6Goals}  v10={skater.last10Goals} />
          <WindowStats label="SOG" v3={skater.last3SOG}    v6={skater.last6SOG}    v10={skater.last10SOG} />
          <WindowStats label="Pts" v3={skater.last3Points} v6={skater.last6Points} v10={skater.last10Points} />
        </div>
      </CardContent>
    </Card>
  );
}
