import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { NBADailySnapshot } from "@/types/nba";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// GET /api/nba                  → today's slate (ET)
// GET /api/nba?date=2026-11-06  → a specific day
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  const { data, error } = await supabase()
    .from("snapshots")
    .select("data")
    .eq("date", `nba-${date}`)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "No NBA data available." }, { status: 404 });
  }

  return NextResponse.json(data.data as NBADailySnapshot);
}
