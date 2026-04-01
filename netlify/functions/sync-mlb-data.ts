import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { buildDailySnapshot } from "../../lib/mlbApi";

// Runs at 9am EST (14:00 UTC) every day
export const config: Config = {
  schedule: "0 14 * * *",
};

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default async function handler() {
  const today = new Date().toISOString().split("T")[0];

  console.log(`[sync-mlb-data] Starting sync for ${today}`);

  try {
    const snapshot = await buildDailySnapshot(today);

    const { error } = await supabase()
      .from("snapshots")
      .upsert({ date: today, data: snapshot, synced_at: new Date().toISOString() });

    if (error) throw error;

    console.log(`[sync-mlb-data] Synced ${snapshot.games.length} games for ${today}`);

    return new Response(
      JSON.stringify({ success: true, date: today, games: snapshot.games.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[sync-mlb-data] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
