import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { buildDailySnapshot } from "../../lib/mlbApi";

// Runs at 9am EST (14:00 UTC) every day
export const config: Config = {
  schedule: "0 14 * * *",
};

export default async function handler() {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  console.log(`[sync-mlb-data] Starting sync for ${today}`);

  try {
    const snapshot = await buildDailySnapshot(today);

    const store = getStore("mlb-daily");
    await store.setJSON(`snapshot-${today}`, snapshot);
    await store.setJSON("snapshot-latest", snapshot);

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
