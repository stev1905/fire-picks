import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DailySnapshot } from "@/types/mlb";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PitcherCard } from "@/components/PitcherCard";
import { LineupSorter } from "@/components/LineupSorter";
import { getGameWeather, analyzeWindProfile } from "@/lib/weather";
import type { GameWeather, WindProfile } from "@/lib/weather";
import { getParkData, getParkAsymmetryNote } from "@/lib/parkFactors";
import type { MLBBatter } from "@/types/mlb";

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

function pickWindHitters(lineup: MLBBatter[], profile: WindProfile, limit = 3): MLBBatter[] {
  return lineup
    .map((b) => {
      let score = -1;
      if (profile.type === "out") {
        score = b.last3HR * 3 + b.last6HR * 1.5 + b.seasonSLG * 5;
      } else if (profile.type === "in") {
        score = b.last3AVG * 8 + b.last10AVG * 3 + b.hittingStreak * 0.08;
      } else if (profile.type === "ltr") {
        if (b.hand === "L" || b.hand === "S") score = b.last3HR * 3 + b.seasonSLG * 5 + b.last6HR;
      } else if (profile.type === "rtl") {
        if (b.hand === "R" || b.hand === "S") score = b.last3HR * 3 + b.seasonSLG * 5 + b.last6HR;
      }
      return { b, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.b);
}

function hitterStat(b: MLBBatter, profile: WindProfile): string {
  if (profile.type === "in") {
    return b.last3AVG > 0 ? `.${Math.round(b.last3AVG * 1000)} L3` : `${b.hittingStreak}g streak`;
  }
  if (b.last3HR > 0) return `${b.last3HR} HR L3`;
  if (b.last6HR > 0) return `${b.last6HR} HR L6`;
  return b.seasonSLG > 0 ? `.${Math.round(b.seasonSLG * 1000)} SLG` : "";
}

function WindInsightSection({
  profile,
  awayLineup,
  homeLineup,
  awayAbbr,
  homeAbbr,
  parkNote,
  humidity,
}: {
  profile: WindProfile;
  awayLineup: MLBBatter[];
  homeLineup: MLBBatter[];
  awayAbbr: string;
  homeAbbr: string;
  parkNote: string | null;
  humidity?: number;
}) {
  if (profile.type === "calm") return null;

  const awayPicks = pickWindHitters(awayLineup, profile);
  const homePicks = pickWindHitters(homeLineup, profile);
  if (awayPicks.length === 0 && homePicks.length === 0) return null;

  const typeColor =
    profile.type === "out" ? "text-green-500 dark:text-green-400" :
    profile.type === "in"  ? "text-blue-500 dark:text-blue-400" :
    "text-amber-500 dark:text-amber-400";

  const handLabel = profile.favoredHand === "L" ? "LHH" : profile.favoredHand === "R" ? "RHH" : null;

  // Humidity note — humid air is slightly less dense, so balls carry marginally farther
  const humidityNote =
    humidity !== undefined && humidity >= 75 ? `💧 ${humidity}% humidity — air is slightly less dense, modest boost to ball carry` :
    humidity !== undefined && humidity <= 30 ? `🌵 ${humidity}% humidity — dry air today, minimal effect on carry` :
    null;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      {/* Wind label + blurb */}
      <div>
        <div className={`text-sm font-bold ${typeColor}`}>{profile.label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{profile.blurb}</div>
      </div>

      {/* Park asymmetry note */}
      {parkNote && (
        <div className="text-xs bg-muted/60 rounded-lg px-3 py-2 text-muted-foreground border border-border">
          🏟️ {parkNote}
        </div>
      )}

      {/* Humidity note */}
      {humidityNote && (
        <div className="text-xs text-muted-foreground/80">{humidityNote}</div>
      )}

      {/* Hitter columns */}
      {(awayPicks.length > 0 || homePicks.length > 0) && (
        <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border">
          {[{ abbr: awayAbbr, picks: awayPicks }, { abbr: homeAbbr, picks: homePicks }].map(({ abbr, picks }) => (
            <div key={abbr}>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {abbr} {handLabel ? `· ${handLabel}` : "· Power"}
              </div>
              <div className="space-y-1">
                {picks.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-xs font-medium truncate">{b.name}</span>
                      <span className="text-[9px] text-muted-foreground shrink-0">({b.hand})</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {hitterStat(b, profile)}
                    </span>
                  </div>
                ))}
                {picks.length === 0 && (
                  <div className="text-[10px] text-muted-foreground">No strong matches</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WeatherWidget({ weather }: { weather: GameWeather }) {
  if (weather.indoor) {
    return <div className="text-xs text-muted-foreground mt-1">🏟️ Indoor</div>;
  }
  return (
    <div className="text-xs mt-1 space-y-0.5">
      <div className="font-medium">
        {weather.icon} {weather.tempF}°F · {weather.windMph} mph {weather.windDir}
      </div>
      <div className="text-muted-foreground">{weather.condition}</div>
      {weather.humidity !== undefined && (
        <div className="text-muted-foreground">💧 {weather.humidity}% humidity</div>
      )}
      {weather.precipChance >= 20 && (
        <div className="text-blue-400">🌧️ {weather.precipChance}% precip</div>
      )}
    </div>
  );
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ gamePk: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { gamePk } = await params;
  const snapshot = await getSnapshot();
  if (!snapshot) notFound();

  const game = snapshot.games.find((g) => String(g.gamePk) === gamePk);
  if (!game) notFound();

  const weather = await getGameWeather(game.venueId ?? 0, game.gameDate);
  const parkData = getParkData(game.venueId ?? 0);
  const windProfile = !weather.indoor && parkData.cfBearing !== undefined
    ? analyzeWindProfile(weather, parkData.cfBearing)
    : null;

  const gameTime = new Date(game.gameDate).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
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
      <div className="bg-card border border-border rounded-xl p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
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
          <div className="text-center px-4 sm:px-6 shrink-0">
            <div className="text-muted-foreground/50 font-bold text-2xl">@</div>
            <div className="text-xs text-muted-foreground mt-1">{gameTime}</div>
            <div className={`text-xs mt-1 font-semibold ${park.color}`}>{park.label}</div>
            <div className="text-xs text-muted-foreground/70 mt-0.5">{game.venue}</div>
            <div className="text-xs text-muted-foreground/50">Park Factor: {game.parkFactor.toFixed(2)}</div>
            <WeatherWidget weather={weather} />
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

      {/* Wind insight */}
      {windProfile && (
        <WindInsightSection
          profile={windProfile}
          awayLineup={game.awayLineup}
          homeLineup={game.homeLineup}
          awayAbbr={game.awayTeam.abbreviation}
          homeAbbr={game.homeTeam.abbreviation}
          parkNote={getParkAsymmetryNote(game.venueId, windProfile.type)}
          humidity={!weather.indoor ? weather.humidity : undefined}
        />
      )}

      {/* Tabs */}
      <Tabs defaultValue="away">
        <TabsList>
          <TabsTrigger value="away">{game.awayTeam.abbreviation} Lineup</TabsTrigger>
          <TabsTrigger value="home">{game.homeTeam.abbreviation} Lineup</TabsTrigger>
          <TabsTrigger value="pitchers">Pitchers</TabsTrigger>
        </TabsList>

        <TabsContent value="away" className="mt-4">
          <LineupSorter
            lineup={game.awayLineup}
            opposingPitcher={game.homeStartingPitcher}
            parkFactor={game.parkFactor}
            venueId={game.venueId}
            weather={weather}
          />
        </TabsContent>

        <TabsContent value="home" className="mt-4">
          <LineupSorter
            lineup={game.homeLineup}
            opposingPitcher={game.awayStartingPitcher}
            parkFactor={game.parkFactor}
            venueId={game.venueId}
            weather={weather}
          />
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
