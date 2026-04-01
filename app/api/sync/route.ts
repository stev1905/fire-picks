// Manual sync trigger — useful for testing before scheduled function runs
import { NextResponse } from "next/server";
import { buildDailySnapshot } from "@/lib/mlbApi";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0];

  try {
    const snapshot = await buildDailySnapshot(date);
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("mlb-daily");
    await store.setJSON(`snapshot-${date}`, snapshot);
    await store.setJSON("snapshot-latest", snapshot);

    return NextResponse.json({ success: true, date, games: snapshot.games.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
