import { NextResponse } from "next/server";
import type { DailySnapshot } from "@/types/mlb";
import { buildDailySnapshot } from "@/lib/mlbApi";

const isLocal = process.env.NETLIFY !== "true";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0];

  try {
    // Local dev: fetch live from MLB API directly
    if (isLocal) {
      const snapshot = await buildDailySnapshot(date);
      return NextResponse.json(snapshot);
    }

    // Production: read from Netlify Blob Storage
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("mlb-daily");
    const key = date ? `snapshot-${date}` : "snapshot-latest";
    const snapshot = await store.get(key, { type: "json" }) as DailySnapshot | null;

    if (!snapshot) {
      return NextResponse.json({ error: "No data available. Sync has not run yet." }, { status: 404 });
    }

    return NextResponse.json(snapshot);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
