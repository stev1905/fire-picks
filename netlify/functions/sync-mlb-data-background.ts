import { createClient } from "@supabase/supabase-js";
import { buildDailySnapshot } from "../../lib/mlbApi";

// Background function — no timeout limit (up to 15 min)
// Trigger manually: POST /.netlify/functions/sync-mlb-data-background
function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default async function handler() {
  const today = new Date().toISOString().split("T")[0];

  console.log(`[sync-background] Starting sync for ${today}`);

  try {
    const snapshot = await buildDailySnapshot(today);

    const { error } = await supabase()
      .from("snapshots")
      .upsert({ date: today, data: snapshot, synced_at: new Date().toISOString() });

    if (error) throw error;

    console.log(`[sync-background] Synced ${snapshot.games.length} games for ${today}`);
  } catch (err) {
    console.error("[sync-background] Error:", err);
  }
}
