// Manual sync trigger — useful for testing before scheduled function runs
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildDailySnapshot } from "@/lib/mlbApi";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0];

  try {
    const snapshot = await buildDailySnapshot(date);

    const { error } = await supabase()
      .from("snapshots")
      .upsert({ date, data: snapshot, synced_at: new Date().toISOString() });

    if (error) throw error;

    return NextResponse.json({ success: true, date, games: snapshot.games.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
