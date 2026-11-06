import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { syncNBA } from "../../lib/nbaSync";

// Background function — up to 15 min timeout.
// Hourly from 10am to 11pm ET so injury news (and confirmed starters once games
// tip) stay fresh. 14:00–04:00 UTC covers both EDT and EST.
export const config: Config = {
  schedule: "0 0-4,14-23 * * *",
};

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default async function handler() {
  console.log("[sync-nba-background] Starting sync");
  try {
    const s = await syncNBA(supabase());
    console.log(`[sync-nba-background] Synced ${s.date}: ${s.games.length} games, ${s.players.length} starters, ${s.gamesOfData} games of history`);
  } catch (err) {
    console.error("[sync-nba-background] Error:", err);
  }
}
