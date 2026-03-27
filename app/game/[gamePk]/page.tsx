import Link from "next/link";
import { notFound } from "next/navigation";
import type { DailySnapshot, MLBGame } from "@/types/mlb";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BatterCard } from "@/components/BatterCard";
import { PitcherCard } from "@/components/PitcherCard";

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
  if (factor >= 1.10) return { label: "Very Hitter Friendly", color: "text-green-500 dark:text-green-400" };
  if (factor >= 1.04) return { label: "Hitter Friendly", color: "text-green-600 dark:text-green-500" };
  if (factor <= 0.92) return { label: "Pitcher Friendly", color: "text-red-500 dark:text-red-400" };
  if (factor <= 0.96) return { label: "Slight Pitcher Friendly", color: "text-orange-500 dark:text-orange-400" };
  return { label: "Neutral Park", color: "text-muted-foreground" };
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ gamePk: string }>;
}) {
  const { gamePk } = await params;
  const snapshot = await getSnapshot();
  if (!snapshot) notFound();

  const game = snapshot.games.find((g) => String(g.gamePk) === gamePk);
  if (!game) notFound();

  const gameTime = new Date(game.gameDate).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const park = parkLabel(game.parkFactor);

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        ← Back to Today&apos;s Games
      </Link>

      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          {/* Away */}
          <div className="text-center flex-1">
            <div className="text-4xl font-bold">{game.awayTeam.abbreviation}</div>
            <div className="text-muted-foreground mt-1">{game.awayTeam.name}</div>
            {game.awayStartingPitcher && (
              <div className="mt-2 text-sm">
                <span className="text-muted-foreground">SP: </span>
                <span className="font-medium">{game.awayStartingPitcher.name}</span>
                <Badge variant="outline" className="ml-1.5 text-[10px]">
                  {game.awayStartingPitcher.hand}HP
                </Badge>
                <span className="ml-1.5 text-muted-foreground">
                  ERA {game.awayStartingPitcher.seasonERA.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Game info */}
          <div className="text-center px-6">
            <div className="text-muted-foreground/50 font-bold text-2xl">@</div>
            <div className="text-xs text-muted-foreground mt-1">{gameTime}</div>
            <div className={`text-xs mt-1 font-semibold ${park.color}`}>{park.label}</div>
            <div className="text-xs text-muted-foreground/70 mt-0.5">{game.venue}</div>
            <div className="text-xs text-muted-foreground/50">Park Factor: {game.parkFactor.toFixed(2)}</div>
          </div>

          {/* Home */}
          <div className="text-center flex-1">
            <div className="text-4xl font-bold">{game.homeTeam.abbreviation}</div>
            <div className="text-muted-foreground mt-1">{game.homeTeam.name}</div>
            {game.homeStartingPitcher && (
              <div className="mt-2 text-sm">
                <span className="text-muted-foreground">SP: </span>
                <span className="font-medium">{game.homeStartingPitcher.name}</span>
                <Badge variant="outline" className="ml-1.5 text-[10px]">
                  {game.homeStartingPitcher.hand}HP
                </Badge>
                <span className="ml-1.5 text-muted-foreground">
                  ERA {game.homeStartingPitcher.seasonERA.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="away">
        <TabsList>
          <TabsTrigger value="away">{game.awayTeam.abbreviation} Lineup</TabsTrigger>
          <TabsTrigger value="home">{game.homeTeam.abbreviation} Lineup</TabsTrigger>
          <TabsTrigger value="pitchers">Pitchers</TabsTrigger>
        </TabsList>

        <TabsContent value="away" className="mt-4">
          <TeamLineup game={game} side="away" />
        </TabsContent>

        <TabsContent value="home" className="mt-4">
          <TeamLineup game={game} side="home" />
        </TabsContent>

        <TabsContent value="pitchers" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {game.awayStartingPitcher && (
              <PitcherCard pitcher={game.awayStartingPitcher} role="Away SP" />
            )}
            {game.homeStartingPitcher && (
              <PitcherCard pitcher={game.homeStartingPitcher} role="Home SP" />
            )}
            {!game.awayStartingPitcher && !game.homeStartingPitcher && (
              <div className="col-span-2 text-center py-12 text-muted-foreground">
                Starting pitchers not yet announced.
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TeamLineup({ game, side }: { game: MLBGame; side: "home" | "away" }) {
  const lineup = side === "away" ? game.awayLineup : game.homeLineup;
  const opposingPitcher = side === "away" ? game.homeStartingPitcher : game.awayStartingPitcher;

  if (lineup.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Lineup not yet posted.
      </div>
    );
  }

  const sorted = [...lineup].sort((a, b) => b.last3AVG - a.last3AVG);
  const topThree = new Set(sorted.slice(0, 3).map((b) => b.id));

  return (
    <div className="space-y-3">
      {opposingPitcher && (
        <div className="text-sm text-muted-foreground mb-4">
          Facing:{" "}
          <span className="text-foreground font-medium">{opposingPitcher.name}</span>
          <Badge variant="outline" className="ml-1.5 text-[10px]">
            {opposingPitcher.hand}HP
          </Badge>
          <span className="ml-1.5">ERA {opposingPitcher.seasonERA.toFixed(2)}</span>
        </div>
      )}

      {topThree.size > 0 && (
        <div className="text-xs text-amber-500 dark:text-amber-400 mb-2">
          ★ Top 3 hottest hitters (last 3 games) highlighted
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {lineup.map((batter) => (
          <div key={batter.id} className={topThree.has(batter.id) ? "ring-1 ring-amber-500/40 rounded-xl" : ""}>
            <BatterCard batter={batter} opposingPitcher={opposingPitcher} />
          </div>
        ))}
      </div>
    </div>
  );
}
