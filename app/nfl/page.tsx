import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { NFLDailySnapshot } from "@/types/nfl";
import { ChefLoading } from "@/components/ChefLoading";
import { NFLDashboard } from "@/components/nfl/NFLDashboard";
import { NFL_SCHEMA_VERSION } from "@/lib/nflModel";

async function getSnapshot(): Promise<NFLDailySnapshot | null> {
  try {
    const base = process.env.URL ?? "http://localhost:3000";
    const res = await fetch(`${base}/api/nfl`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function NFLPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const snapshot = await getSnapshot();

  if (!snapshot) {
    return <ChefLoading message="Chefing up this week's NFL slate..." />;
  }

  // Data synced by an older deploy has a different shape — wait for the next sync rather than crash
  if (snapshot.schemaVersion !== NFL_SCHEMA_VERSION) {
    return <ChefLoading message="Updating NFL data to the latest format — check back in a few minutes..." />;
  }

  return <NFLDashboard snapshot={snapshot} />;
}
