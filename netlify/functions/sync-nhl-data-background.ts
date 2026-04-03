import { createClient } from "@supabase/supabase-js";
import { buildDailyNHLSnapshot } from "../../lib/nhlApi";

// Background function — up to 15 min timeout
// Trigger: POST /.netlify/functions/sync-nhl-data-background
function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default async function handler() {
  const today = new Date().toISOString().split("T")[0];
  const key = `nhl-${today}`;

  console.log(`[sync-nhl-background] Starting sync for ${today}`);

  try {
    const snapshot = await buildDailyNHLSnapshot(today);

    const { error } = await supabase()
      .from("snapshots")
      .upsert({ date: key, data: snapshot, synced_at: new Date().toISOString() });

    if (error) throw error;

    console.log(`[sync-nhl-background] Synced ${snapshot.games.length} games for ${today}`);
  } catch (err) {
    console.error("[sync-nhl-background] Error:", err);
  }
}
