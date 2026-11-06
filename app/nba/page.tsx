import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { NBADailySnapshot } from "@/types/nba";
import { ChefLoading } from "@/components/ChefLoading";
import { NBADashboard } from "@/components/nba/NBADashboard";
import { NBA_SCHEMA_VERSION } from "@/lib/nbaApi";

async function getSnapshot(): Promise<NBADailySnapshot | null> {
  try {
    const base = process.env.URL ?? "http://localhost:3000";
    const res = await fetch(`${base}/api/nba`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function NBAPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const snapshot = await getSnapshot();

  if (!snapshot) {
    return <ChefLoading message="Chefing up today's NBA slate..." />;
  }

  // Data synced by an older deploy has a different shape — wait for the next sync rather than crash
  if (snapshot.schemaVersion !== NBA_SCHEMA_VERSION) {
    return <ChefLoading message="Updating NBA data to the latest format — check back in a few minutes..." />;
  }

  return <NBADashboard snapshot={snapshot} />;
}
