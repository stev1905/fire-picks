import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { NHLDailySnapshot, NHLGame } from "@/types/nhl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ChefLoading } from "@/components/ChefLoading";

async function getSnapshot(): Promise<NHLDailySnapshot | null> {
  try {
    const base = process.env.URL ?? "http://localhost:3000";
    const res = await fetch(`${base}/api/nhl`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function gameTime(utc: string) {
  return new Date(utc).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

function pct(val: number) {
  if (!val) return "N/A";
  return `${(val * 100).toFixed(1)}%`;
}

function NHLGameCard({ game }: { game: NHLGame }) {
  return (
    <Link href={`/nhl/game/${game.id}`}>
      <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer group h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{gameTime(game.startTimeUTC)}</span>
            <span className="text-xs text-muted-foreground/60 truncate ml-2">{game.venue}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Matchup */}
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-2xl font-bold group-hover:text-primary transition-colors">
                {game.awayTeam.abbreviation}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{game.awayTeam.name}</div>
            </div>
            <div className="text-muted-foreground/50 font-bold text-lg px-3">@</div>
            <div className="text-center flex-1">
              <div className="text-2xl font-bold group-hover:text-primary transition-colors">
                {game.homeTeam.abbreviation}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{game.homeTeam.name}</div>
            </div>
          </div>

          {/* PP% / PK% */}
          <div className="border-t border-border pt-2 grid grid-cols-2 gap-2 text-xs">
            <div className="space-y-0.5">
              <div className="text-muted-foreground font-medium">{game.awayTeam.abbreviation}</div>
              <div className="flex gap-2">
                <span className="text-green-500">PP {pct(game.awayTeam.ppPct)}</span>
                <span className="text-blue-400">PK {pct(game.awayTeam.pkPct)}</span>
              </div>
            </div>
            <div className="space-y-0.5 text-right">
              <div className="text-muted-foreground font-medium">{game.homeTeam.abbreviation}</div>
              <div className="flex gap-2 justify-end">
                <span className="text-green-500">PP {pct(game.homeTeam.ppPct)}</span>
                <span className="text-blue-400">PK {pct(game.homeTeam.pkPct)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function NHLPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const snapshot = await getSnapshot();

  if (!snapshot) {
    return <ChefLoading message="Chefing up today's NHL slate..." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Today&apos;s NHL Games</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{snapshot.games.length} games today</p>
      </div>

      {snapshot.games.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">No NHL games scheduled today.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {snapshot.games.map((game) => (
            <NHLGameCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </div>
  );
}
