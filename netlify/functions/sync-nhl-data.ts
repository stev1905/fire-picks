import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { buildDailyNHLSnapshot } from "../../lib/nhlApi";

// Runs every 2 hours 12pm–10pm EDT
export const config: Config = {
  schedule: "0 16,18,20,22,0,2 * * *",
};

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default async function handler() {
  const today = new Date().toISOString().split("T")[0];
  const key = `nhl-${today}`;

  console.log(`[sync-nhl-data] Starting sync for ${today}`);

  try {
    const snapshot = await buildDailyNHLSnapshot(today);

    const { error } = await supabase()
      .from("snapshots")
      .upsert({ date: key, data: snapshot, synced_at: new Date().toISOString() });

    if (error) throw error;

    console.log(`[sync-nhl-data] Synced ${snapshot.games.length} games for ${today}`);

    return new Response(
      JSON.stringify({ success: true, date: today, games: snapshot.games.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[sync-nhl-data] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
