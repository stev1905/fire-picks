import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { NFLDailySnapshot } from "@/types/nfl";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// GET /api/nfl                     → latest synced week
// GET /api/nfl?season=2026&week=3  → specific week
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = searchParams.get("season");
  const week = searchParams.get("week");
  const key = season && week ? `nfl-${season}-w${week}` : "nfl-latest";

  const { data, error } = await supabase()
    .from("snapshots")
    .select("data")
    .eq("date", key)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "No NFL data available." }, { status: 404 });
  }

  return NextResponse.json(data.data as NFLDailySnapshot);
}
