import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DailySnapshot } from "@/types/mlb";
import {
  getHottestHRHitters,
  getHitConsistency,
  buildPitcherAnalyticsRows,
  buildAiPicksRows,
  buildBestSluggersRows,
} from "@/lib/analytics";
import { getGameWeather, analyzeWindProfile } from "@/lib/weather";
import { getParkData } from "@/lib/parkFactors";
import Link from "next/link";
import { HRChart } from "@/components/analytics/HRChart";
import { PitchingAnalyticsTable } from "@/components/analytics/PitchingAnalyticsTable";
import { HitConsistencyTable } from "@/components/analytics/HitConsistencyTable";
import { AiPicksTable } from "@/components/analytics/AiPicksTable";
import { BestSluggersTable } from "@/components/analytics/BestSluggersTable";
import { CollapsibleSection } from "@/components/analytics/CollapsibleSection";
import { ChefLoading } from "@/components/ChefLoading";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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


interface ParkHRRow {
  gamePk: number;
  venue: string;
  homeTeam: string;
  awayTeam: string;
  parkFactor: number;
  parkLabel: string;
  windLabel: string | null;
  windType: string | null;
  score: number;
  indoor: boolean;
}

async function getParkHRRankings(snapshot: DailySnapshot): Promise<ParkHRRow[]> {
  const rows = await Promise.all(
    snapshot.games.map(async (game) => {
      const weather = await getGameWeather(game.venueId, game.gameDate);
      const parkData = getParkData(game.venueId);

      let windScore = 0;
      let windLabel: string | null = null;
      let windType: string | null = null;

      if (!weather.indoor) {
        const profile = analyzeWindProfile(weather, parkData.cfBearing);
        windLabel = profile.label;
        windType = profile.type;
        windScore =
          profile.type === "out"  ?  weather.windMph * 1.5 :
          profile.type === "in"   ? -weather.windMph * 1.2 :
          profile.type === "ltr" || profile.type === "rtl" ? weather.windMph * 0.3 :
          0;
      }

      const parkScore = ((game.parkFactor - 0.88) / (1.24 - 0.88)) * 50;
      const tempScore = !weather.indoor
        ? Math.max(0, Math.min(15, ((weather.tempF - 60) / 40) * 15))
        : 7.5;
      const avgDist = (parkData.lf + parkData.rf) / 2;
      const dimScore = Math.max(0, ((365 - avgDist) / 65) * 10);
      const humScore =
        !weather.indoor && weather.humidity !== undefined
          ? Math.max(0, ((weather.humidity - 50) / 100) * 5)
          : 0;

      const score = Math.min(100, Math.max(0, Math.round(
        parkScore + windScore + tempScore + dimScore + humScore
      )));

      return {
        gamePk: game.gamePk,
        venue: game.venue,
        homeTeam: game.homeTeam.abbreviation,
        awayTeam: game.awayTeam.abbreviation,
        parkFactor: game.parkFactor,
        parkLabel: parkData.label,
        windLabel,
        windType,
        score,
        indoor: weather.indoor,
      };
    })
  );

  return rows.sort((a, b) => b.score - a.score);
}

function scoreBg(score: number) {
  if (score >= 70) return "bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/30";
  if (score >= 50) return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30";
  return "bg-muted text-muted-foreground border border-border";
}

function windColor(type: string | null) {
  if (type === "out")  return "text-green-500 dark:text-green-400";
  if (type === "in")   return "text-blue-500 dark:text-blue-400";
  if (type === "ltr" || type === "rtl") return "text-amber-500 dark:text-amber-400";
  return "text-muted-foreground";
}

function ParkHRRankingTable({ rows }: { rows: ParkHRRow[] }) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="divide-y divide-border">
        {rows.map((row, i) => (
          <Link
            key={row.gamePk}
            href={`/game/${row.gamePk}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors group"
          >
            <span className="text-sm font-bold text-muted-foreground w-5 shrink-0 tabular-nums">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                {row.venue || `${row.awayTeam} @ ${row.homeTeam}`}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {row.awayTeam} @ {row.homeTeam}
              </div>
            </div>
            <div className="hidden sm:block text-[10px] text-muted-foreground shrink-0 max-w-[110px] text-right">
              {row.parkLabel}
              <div className="font-mono">{row.parkFactor.toFixed(2)}</div>
            </div>
            <div className={`hidden md:block text-[10px] font-medium shrink-0 w-32 text-right ${windColor(row.windType)}`}>
              {row.indoor ? "🏟️ Indoor" : (row.windLabel ?? "—")}
            </div>
            <div className={`text-sm font-black tabular-nums px-2.5 py-1 rounded-lg shrink-0 ${scoreBg(row.score)}`}>
              {row.score}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const snapshot = await getSnapshot();
  if (!snapshot) return <ChefLoading message="Chefing up today's analytics..." />;

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  const [hotHR, hitConsistency, parkRankings] = await Promise.all([
    Promise.resolve(getHottestHRHitters(snapshot)),
    Promise.resolve(getHitConsistency(snapshot)),
    getParkHRRankings(snapshot),
  ]);

  const aiPicks = buildAiPicksRows(snapshot);
  const bestSluggers = buildBestSluggersRows(snapshot);

  const allPitchers = buildPitcherAnalyticsRows([snapshot], today);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ranked across {snapshot.games.length} games today
        </p>
      </div>

      <Tabs defaultValue="ai-picks">
        <TabsList className="mb-6">
          <TabsTrigger value="ai-picks">AI Picks</TabsTrigger>
          <TabsTrigger value="sluggers">Best Sluggers</TabsTrigger>
          <TabsTrigger value="hitters">Hitters Analytics</TabsTrigger>
          <TabsTrigger value="pitching">Pitching Analytics</TabsTrigger>
        </TabsList>

        {/* ── AI Picks Tab ── */}
        <TabsContent value="ai-picks">
          <div className="space-y-6">
            <CollapsibleSection
              title="Today's Best AI Picks"
              subtitle="Batters scoring ≥60 on the full hit model — weighted by consistency, matchup, pitcher H/9, streak, bounce-back & lineup slot · sort by score, game time, or hit rate"
            >
              <AiPicksTable data={aiPicks} />
            </CollapsibleSection>
          </div>
        </TabsContent>

        {/* ── Best Sluggers Tab ── */}
        <TabsContent value="sluggers">
          <div className="space-y-6">
            <CollapsibleSection
              title="Best Sluggers Today"
              subtitle="Top 50 batters by HR score — Barrel%, Hard Hit%, xwOBA, xSLG, Fly Ball rate + pitcher HR/9 by hand · sort any column · green = favorable, red = unfavorable"
            >
              <BestSluggersTable data={bestSluggers} />
            </CollapsibleSection>
          </div>
        </TabsContent>

        {/* ── Hitters Tab ── */}
        <TabsContent value="hitters">
          <div className="space-y-8">
            <CollapsibleSection
              title="Ballpark HR Rankings Today"
              subtitle="Scored by park factor, wind direction, temperature, humidity & field dimensions · click to open game"
            >
              <ParkHRRankingTable rows={parkRankings} />
            </CollapsibleSection>

            <CollapsibleSection
              title="Hottest HR Hitters"
              subtitle="Most home runs in last 3 & 6 games"
            >
              <HRChart
                data={hotHR}
                title="Hottest HR Hitters"
                subtitle="Most home runs in last 3 & 6 games"
                icon="💣"
                hot
              />
            </CollapsibleSection>

            <CollapsibleSection
              title="Season Hit Consistency"
              subtitle="Top 40 batters by hit rate across rolling windows · click name to open game · click headers to sort"
            >
              <HitConsistencyTable data={hitConsistency} />
            </CollapsibleSection>
          </div>
        </TabsContent>

        {/* ── Pitching Tab ── */}
        <TabsContent value="pitching">
          <div className="space-y-6">
            <CollapsibleSection
              title="Starting Pitcher Analytics"
              subtitle="All starters from recent games · ▶ = pitching today · HH% = hard hit rate allowed · sort & filter by any stat"
            >
              <PitchingAnalyticsTable rows={allPitchers} />
            </CollapsibleSection>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
