import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { NHLDailySnapshot } from "@/types/nhl";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const key = `nhl-${date}`;

  const { data, error } = await supabase()
    .from("snapshots")
    .select("data")
    .eq("date", key)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "No NHL data available." }, { status: 404 });
  }

  return NextResponse.json(data.data as NHLDailySnapshot);
}
