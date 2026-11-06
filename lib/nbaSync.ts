import type { SupabaseClient } from "@supabase/supabase-js";
import type { NBAPbpCache } from "@/types/nba";
import { buildNBASnapshot, seasonForDate, todayET } from "./nbaApi";

// Shared by the scheduled Netlify function and the manual /api/sync/nba route.
// Reads the season's play-by-play cache, builds today's snapshot (fetching only
// newly completed games), then writes both back.
export async function syncNBA(db: SupabaseClient, date = todayET()) {
  const season = seasonForDate(date);
  const cacheKey = `nba-pbp-${season}`;

  const { data: cached } = await db.from("snapshots").select("data").eq("date", cacheKey).maybeSingle();
  const { snapshot, cache } = await buildNBASnapshot({ date, cache: (cached?.data as NBAPbpCache) ?? null });

  const syncedAt = new Date().toISOString();
  const { error } = await db.from("snapshots").upsert([
    { date: `nba-${date}`, data: snapshot, synced_at: syncedAt },
    { date: cacheKey, data: cache, synced_at: syncedAt },
  ]);
  if (error) throw error;

  return snapshot;
}
