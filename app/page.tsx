import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DailySnapshot, MLBGame } from "@/types/mlb";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

async function getSnapshot(): Promise<DailySnapshot | null> {
  try {
    const base = process.env.URL ?? "http://localhost:3000";
    const res = await fetch(`${base}/api/mlb`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function parkLabel(factor: number) {
  if (factor >= 1.10) return { label: "Very Hitter Friendly", color: "bg-green-500/90 text-white" };
  if (factor >= 1.04) return { label: "Hitter Friendly", color: "bg-green-600/80 text-white" };
  if (factor <= 0.92) return { label: "Pitcher Friendly", color: "bg-red-500/80 text-white" };
  if (factor <= 0.96) return { label: "Slight Pitcher", color: "bg-orange-500/80 text-white" };
  return { label: "Neutral", color: "bg-muted text-muted-foreground" };
}

function GameCard({ game }: { game: MLBGame }) {
  const park = parkLabel(game.parkFactor);
  const gameTime = new Date(game.gameDate).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });

  return (
    <Link href={`/game/${game.gamePk}`}>
      <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer group h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{gameTime}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${park.color}`}>
              {park.label}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Matchup */}
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-2xl font-bold group-hover:text-primary transition-colors">
                {game.awayTeam.abbreviation}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{game.awayTeam.name}</div>
            </div>
            <div className="text-muted-foreground/50 font-bold text-lg px-4">@</div>
            <div className="text-center flex-1">
              <div className="text-2xl font-bold group-hover:text-primary transition-colors">
                {game.homeTeam.abbreviation}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{game.homeTeam.name}</div>
            </div>
          </div>

          {/* Pitchers */}
          <div className="border-t border-border pt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground mb-1">Away SP</div>
              {game.awayStartingPitcher ? (
                <>
                  <div className="font-medium truncate">{game.awayStartingPitcher.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      {game.awayStartingPitcher.hand}HP
                    </Badge>
                    <span className="text-muted-foreground">ERA {game.awayStartingPitcher.seasonERA.toFixed(2)}</span>
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground/50">TBD</div>
              )}
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Home SP</div>
              {game.homeStartingPitcher ? (
                <>
                  <div className="font-medium truncate">{game.homeStartingPitcher.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      {game.homeStartingPitcher.hand}HP
                    </Badge>
                    <span className="text-muted-foreground">ERA {game.homeStartingPitcher.seasonERA.toFixed(2)}</span>
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground/50">TBD</div>
              )}
            </div>
          </div>

          <div className="text-xs text-muted-foreground/60 truncate">{game.venue}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const snapshot = await getSnapshot();

  if (!snapshot) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
        <div className="text-6xl">⚾</div>
        <h1 className="text-2xl font-bold">No Data Yet</h1>
        <p className="text-muted-foreground max-w-sm">
          The daily sync hasn&apos;t run yet. Data syncs automatically at 9am EST.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Today&apos;s Games</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{snapshot.games.length} games today</p>
      </div>

      {snapshot.games.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">No games scheduled today.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {snapshot.games.map((game) => (
            <GameCard key={game.gamePk} game={game} />
          ))}
        </div>
      )}
    </div>
  );
}
