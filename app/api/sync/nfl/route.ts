import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildNFLSnapshot } from "@/lib/nflApi";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Manual trigger: POST /api/sync/nfl  (optional ?week=N, defaults to ESPN's current week)
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const week = searchParams.get("week");

  try {
    const snapshot = await buildNFLSnapshot({ week: week ? Number(week) : undefined });
    const syncedAt = new Date().toISOString();

    const { error } = await supabase()
      .from("snapshots")
      .upsert([
        { date: `nfl-${snapshot.season}-w${snapshot.week}`, data: snapshot, synced_at: syncedAt },
        { date: "nfl-latest", data: snapshot, synced_at: syncedAt },
      ]);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      season: snapshot.season,
      week: snapshot.week,
      games: snapshot.games.length,
      players: snapshot.players.length,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
