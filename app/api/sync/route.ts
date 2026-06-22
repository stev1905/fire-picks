// Manual sync trigger — useful for testing before scheduled function runs
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildDailySnapshot } from "@/lib/mlbApi";
import { writeOutcomes } from "@/lib/outcomes";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  try {
    const sb       = supabase();
    const snapshot = await buildDailySnapshot(date);

    const { error } = await sb
      .from("snapshots")
      .upsert({ date, data: snapshot, synced_at: new Date().toISOString() });

    if (error) throw error;

    await writeOutcomes(snapshot, sb);

    return NextResponse.json({ success: true, date, games: snapshot.games.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
