import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildDailyNHLSnapshot } from "@/lib/nhlApi";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const key = `nhl-${date}`;

  try {
    const snapshot = await buildDailyNHLSnapshot(date);

    const { error } = await supabase()
      .from("snapshots")
      .upsert({ date: key, data: snapshot, synced_at: new Date().toISOString() });

    if (error) throw error;

    return NextResponse.json({ success: true, date, games: snapshot.games.length });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
