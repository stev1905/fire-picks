import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncNBA } from "@/lib/nbaSync";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Manual trigger: POST /api/sync/nba  (optional ?date=YYYY-MM-DD, defaults to today ET)
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? undefined;

  try {
    const snapshot = await syncNBA(supabase(), date);
    return NextResponse.json({
      success: true,
      date: snapshot.date,
      games: snapshot.games.length,
      players: snapshot.players.length,
      gamesOfData: snapshot.gamesOfData,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
