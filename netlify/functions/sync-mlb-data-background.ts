import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { buildDailySnapshot } from "../../lib/mlbApi";
import { writeOutcomes } from "../../lib/outcomes";

// Background function — no timeout limit (up to 15 min)
// Runs every 2 hours from 12pm–10pm EDT (16,18,20,22,0,2 UTC)
// Trigger manually: POST /.netlify/functions/sync-mlb-data-background
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
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  console.log(`[sync-background] Starting sync for ${today}`);

  try {
    const sb       = supabase();
    const snapshot = await buildDailySnapshot(today);

    const { error } = await sb
      .from("snapshots")
      .upsert({ date: today, data: snapshot, synced_at: new Date().toISOString() });

    if (error) throw error;

    console.log(`[sync-background] Synced ${snapshot.games.length} games for ${today}`);

    // Write per-batter prediction + outcome rows for model retraining
    await writeOutcomes(snapshot, sb);
  } catch (err) {
    console.error("[sync-background] Error:", err);
  }
}
