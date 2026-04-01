import { getStore } from "@netlify/blobs";
import { buildDailySnapshot } from "../../lib/mlbApi";

// Background function — no timeout limit (up to 15 min)
// Trigger manually: POST /.netlify/functions/sync-mlb-data-background
export default async function handler() {
  const today = new Date().toISOString().split("T")[0];

  console.log(`[sync-background] Starting sync for ${today}`);

  try {
    const snapshot = await buildDailySnapshot(today);
    const store = getStore("mlb-daily");
    await store.setJSON(`snapshot-${today}`, snapshot);
    await store.setJSON("snapshot-latest", snapshot);

    console.log(`[sync-background] Synced ${snapshot.games.length} games for ${today}`);
  } catch (err) {
    console.error("[sync-background] Error:", err);
  }
}
