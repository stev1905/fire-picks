import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DailySnapshot } from "@/types/mlb";
import {
  getHottestHitters,
  getColdestHitters,
  getHottestHRHitters,
  getColdestHRHitters,
  getHottestPitchers,
  getPitchersToday,
} from "@/lib/analytics";
import Link from "next/link";
import { HitterChart } from "@/components/analytics/HitterChart";
import { HRChart } from "@/components/analytics/HRChart";
import { PitcherChart } from "@/components/analytics/PitcherChart";
import { PitchersTodayTable } from "@/components/analytics/PitchersTodayTable";
import { ChefLoading } from "@/components/ChefLoading";

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

export default async function AnalyticsPage() {
  // Auth gate
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const snapshot = await getSnapshot();

  if (!snapshot) return <ChefLoading message="Chefing up today's analytics..." />;

  const [hotHitters, coldHitters, hotHR, coldHR, hotPitchers, pitchersToday] = [
    getHottestHitters(snapshot),
    getColdestHitters(snapshot),
    getHottestHRHitters(snapshot),
    getColdestHRHitters(snapshot),
    getHottestPitchers(snapshot),
    getPitchersToday(snapshot),
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ranked across {snapshot.games.length} games today
        </p>
      </div>

      {/* Hitter trends — 2 col */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          Hitter Trends
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <HitterChart
            data={hotHitters}
            title="Hottest Hitters"
            subtitle="Ranked by recent AVG, streak & matchup favorability"
            icon="🔥"
            hot
          />
          <HitterChart
            data={coldHitters}
            title="Coldest Hitters"
            subtitle="Struggling hitters based on recent AVG & unfavorable matchups"
            icon="🧊"
            hot={false}
          />
        </div>
      </section>

      {/* HR trends — 2 col */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          Home Run Trends
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <HRChart
            data={hotHR}
            title="Hottest HR Hitters"
            subtitle="Most home runs in last 3 & 6 games"
            icon="💣"
            hot
          />
          <HRChart
            data={coldHR}
            title="Coldest HR Hitters"
            subtitle="Power hitters (5+ season HRs) in a cold streak"
            icon="❄️"
            hot={false}
          />
        </div>
      </section>

      {/* Pitchers today */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          Starters Today
        </h2>
        <PitchersTodayTable rows={pitchersToday} />
        <p className="text-[10px] text-muted-foreground mt-1.5 ml-1">
          Click column headers to sort · green = tough, red = hittable
        </p>
      </section>

      {/* Pitcher trends — full width */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          Pitcher Trends
        </h2>
        <PitcherChart data={hotPitchers} />
      </section>
    </div>
  );
}
