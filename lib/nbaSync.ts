import type { SupabaseClient } from "@supabase/supabase-js";
import type { NBAPbpCache, NBAPrevLogsCache } from "@/types/nba";
import { buildNBASnapshot, seasonForDate, todayET } from "./nbaApi";

// Shared by the scheduled Netlify function and the manual /api/sync/nba route.
// Reads the season's play-by-play cache, builds today's snapshot (fetching only
// newly completed games), then writes both back.
export async function syncNBA(db: SupabaseClient, date = todayET()) {
  const season = seasonForDate(date);
  const cacheKey = `nba-pbp-${season}`;
  const prevKey = `nba-prevlogs-${season}`;

  const [{ data: cached }, { data: prevCached }] = await Promise.all([
    db.from("snapshots").select("data").eq("date", cacheKey).maybeSingle(),
    db.from("snapshots").select("data").eq("date", prevKey).maybeSingle(),
  ]);
  const { snapshot, cache, prevLogs } = await buildNBASnapshot({
    date,
    cache: (cached?.data as NBAPbpCache) ?? null,
    prevLogs: (prevCached?.data as NBAPrevLogsCache) ?? null,
  });

  const syncedAt = new Date().toISOString();
  const { error } = await db.from("snapshots").upsert([
    { date: `nba-${date}`, data: snapshot, synced_at: syncedAt },
    { date: cacheKey, data: cache, synced_at: syncedAt },
    { date: prevKey, data: prevLogs, synced_at: syncedAt },
  ]);
  if (error) throw error;

  return snapshot;
}
