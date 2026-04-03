import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { NHLGoalie } from "@/types/nhl";

interface Props {
  goalie: NHLGoalie;
}

function pct(val: number) {
  return val.toFixed(3).replace(/^0/, "");
}

export function GoalieCard({ goalie }: Props) {
  const record = `${goalie.seasonWins}-${goalie.seasonLosses}-${goalie.seasonOtLosses}`;

  return (
    <Card>
      <CardHeader className="pb-1.5 pt-2 px-2">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground font-mono">#{goalie.sweaterNumber}</span>
          <span className="font-semibold text-xs">{goalie.name}</span>
          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">G</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 px-2 pb-2">
        {/* Season stats */}
        <div className="grid grid-cols-4 gap-1">
          <div className="flex flex-col items-center p-1 rounded bg-secondary col-span-1">
            <span className="text-[8px] text-muted-foreground uppercase">Record</span>
            <span className="font-mono font-bold text-[10px] mt-0.5">{record}</span>
          </div>
          <div className="flex flex-col items-center p-1 rounded bg-secondary">
            <span className="text-[8px] text-muted-foreground uppercase">SV%</span>
            <span className="font-mono font-bold text-[10px] mt-0.5">{pct(goalie.seasonSavePct)}</span>
          </div>
          <div className="flex flex-col items-center p-1 rounded bg-secondary">
            <span className="text-[8px] text-muted-foreground uppercase">GAA</span>
            <span className="font-mono font-bold text-[10px] mt-0.5">{goalie.seasonGAA.toFixed(2)}</span>
          </div>
          <div className="flex flex-col items-center p-1 rounded bg-muted">
            <span className="text-[8px] text-muted-foreground uppercase">GP</span>
            <span className="font-mono font-bold text-[10px] mt-0.5">{goalie.seasonGP}</span>
          </div>
        </div>

        {/* Last 3 summary */}
        {goalie.recentGames.length > 0 && (
          <div>
            <div className="grid grid-cols-2 gap-1 mb-1.5">
              <div className="flex flex-col items-center p-1 rounded bg-muted">
                <span className="text-[8px] text-muted-foreground uppercase">L3 SV%</span>
                <span className="font-mono font-bold text-[10px] mt-0.5">{pct(goalie.last3SavePct)}</span>
              </div>
              <div className="flex flex-col items-center p-1 rounded bg-muted">
                <span className="text-[8px] text-muted-foreground uppercase">L3 GAA</span>
                <span className="font-mono font-bold text-[10px] mt-0.5">{goalie.last3GAA.toFixed(2)}</span>
              </div>
            </div>

            {/* Recent starts */}
            <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Recent Starts</div>
            <div className="space-y-0.5">
              {goalie.recentGames.slice(0, 3).map((g, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] bg-muted/50 rounded px-1.5 py-0.5">
                  <span className="text-muted-foreground">{g.date}</span>
                  <span>vs {g.opponent}</span>
                  <span className={`font-medium ${g.decision === "W" ? "text-green-500" : g.decision === "L" ? "text-red-500" : "text-muted-foreground"}`}>
                    {g.decision}
                  </span>
                  <span>{pct(g.savePct)} ({g.saves}/{g.shotsAgainst})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
