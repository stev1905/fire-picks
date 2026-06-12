import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { DailySnapshot } from "@/types/mlb";
import { buildPitcherAnalyticsRows } from "@/lib/analytics";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET() {
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    // Filter to MLB-only rows: plain YYYY-MM-DD dates (NHL rows are prefixed "nhl-...")
    const { data, error } = await supabase()
      .from("snapshots")
      .select("date, data")
      .like("date", "____-__-__")
      .order("date", { ascending: false })
      .limit(20);

    if (error || !data?.length) {
      return NextResponse.json([], { status: 200 });
    }

    const snapshots: DailySnapshot[] = data.map((row: { date: string; data: DailySnapshot }) => ({
      ...row.data,
      date: row.date,
    }));

    const pitchers = buildPitcherAnalyticsRows(snapshots, today);
    return NextResponse.json(pitchers);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
