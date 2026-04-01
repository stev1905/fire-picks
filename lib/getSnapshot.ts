import type { DailySnapshot } from "@/types/mlb";
import { buildDailySnapshot } from "@/lib/mlbApi";

const isLocal = process.env.NETLIFY !== "true";

export async function getSnapshot(date?: string): Promise<DailySnapshot | null> {
  const resolvedDate = date ?? new Date().toISOString().split("T")[0];

  try {
    if (isLocal) {
      return await buildDailySnapshot(resolvedDate);
    }

    const { getStore } = await import("@netlify/blobs");
    const store = getStore("mlb-daily");
    const key = `snapshot-${resolvedDate}`;
    const snapshot = await store.get(key, { type: "json" }) as DailySnapshot | null;
    return snapshot ?? null;
  } catch {
    return null;
  }
}
