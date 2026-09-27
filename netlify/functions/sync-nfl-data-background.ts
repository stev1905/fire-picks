import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { buildNFLSnapshot } from "../../lib/nflApi";

// Background function — up to 15 min timeout
// Runs every 2 hours so injury designations, inactives and line moves stay fresh
// (Sunday inactives drop ~90 min before kickoff).
export const config: Config = {
  schedule: "0 */2 * * *",
};

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default async function handler() {
  console.log("[sync-nfl-background] Starting sync");

  try {
    const snapshot = await buildNFLSnapshot();
    const syncedAt = new Date().toISOString();

    const { error } = await supabase()
      .from("snapshots")
      .upsert([
        { date: `nfl-${snapshot.season}-w${snapshot.week}`, data: snapshot, synced_at: syncedAt },
        { date: "nfl-latest", data: snapshot, synced_at: syncedAt },
      ]);

    if (error) throw error;

    console.log(`[sync-nfl-background] Synced ${snapshot.season} week ${snapshot.week}: ${snapshot.games.length} games, ${snapshot.players.length} players`);
  } catch (err) {
    console.error("[sync-nfl-background] Error:", err);
  }
}
