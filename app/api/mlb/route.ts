import { NextResponse } from "next/server";
import type { DailySnapshot } from "@/types/mlb";
import { createClient } from "@supabase/supabase-js";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0];

  try {
    const { data, error } = await supabase()
      .from("snapshots")
      .select("data")
      .eq("date", date)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "No data available. Sync has not run yet." }, { status: 404 });
    }

    return NextResponse.json(data.data as DailySnapshot);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
