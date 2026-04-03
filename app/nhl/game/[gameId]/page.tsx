import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { NHLDailySnapshot } from "@/types/nhl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RosterSorter } from "@/components/RosterSorter";
import { GoalieCard } from "@/components/GoalieCard";

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

function pct(val: number) {
  if (!val) return "N/A";
  return `${(val * 100).toFixed(1)}%`;
}

function gameTime(utc: string) {
  return new Date(utc).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

export default async function NHLGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { gameId } = await params;
  const snapshot = await getSnapshot();
  if (!snapshot) notFound();

  const game = snapshot.games.find((g) => String(g.id) === gameId);
  if (!game) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/nhl"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        &larr; Back to Today&apos;s Games
      </Link>

      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
          {/* Away */}
          <div className="text-center flex-1">
            <div className="text-4xl font-bold">{game.awayTeam.abbreviation}</div>
            <div className="text-muted-foreground mt-1">{game.awayTeam.name}</div>
            <div className="mt-2 flex gap-3 justify-center text-xs">
              <span className="text-green-500">PP {pct(game.awayTeam.ppPct)}</span>
              <span className="text-blue-400">PK {pct(game.awayTeam.pkPct)}</span>
            </div>
          </div>

          {/* Game info */}
          <div className="text-center px-4 shrink-0">
            <div className="text-muted-foreground/50 font-bold text-2xl">@</div>
            <div className="text-xs text-muted-foreground mt-1">{gameTime(game.startTimeUTC)}</div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">{game.venue}</div>
          </div>

          {/* Home */}
          <div className="text-center flex-1">
            <div className="text-4xl font-bold">{game.homeTeam.abbreviation}</div>
            <div className="text-muted-foreground mt-1">{game.homeTeam.name}</div>
            <div className="mt-2 flex gap-3 justify-center text-xs">
              <span className="text-green-500">PP {pct(game.homeTeam.ppPct)}</span>
              <span className="text-blue-400">PK {pct(game.homeTeam.pkPct)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="away">
        <TabsList>
          <TabsTrigger value="away">{game.awayTeam.abbreviation} Skaters</TabsTrigger>
          <TabsTrigger value="home">{game.homeTeam.abbreviation} Skaters</TabsTrigger>
          <TabsTrigger value="goalies">Goalies</TabsTrigger>
        </TabsList>

        <TabsContent value="away" className="mt-4">
          <RosterSorter
            forwards={game.awayRoster.forwards}
            defensemen={game.awayRoster.defensemen}
            label={game.awayTeam.abbreviation}
          />
        </TabsContent>

        <TabsContent value="home" className="mt-4">
          <RosterSorter
            forwards={game.homeRoster.forwards}
            defensemen={game.homeRoster.defensemen}
            label={game.homeTeam.abbreviation}
          />
        </TabsContent>

        <TabsContent value="goalies" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...game.awayRoster.goalies, ...game.homeRoster.goalies].map((g) => (
              <GoalieCard key={g.id} goalie={g} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
