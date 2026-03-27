"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { LogOut, User, BarChart3 } from "lucide-react";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export function AuthNav() {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  if (loading) return <div className="w-20 h-8" />;

  if (!user) {
    return (
      <Link
        href="/auth/login"
        className="px-3 py-1.5 rounded-lg text-sm font-semibold brand-gradient text-white shadow-sm hover:opacity-90 transition-opacity"
      >
        Sign In
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/analytics"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <BarChart3 size={14} />
        Analytics
      </Link>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <User size={13} />
        <span className="hidden sm:block max-w-28 truncate text-xs">
          {user.email}
        </span>
      </div>
      <button
        onClick={signOut}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label="Sign out"
      >
        <LogOut size={15} />
      </button>
    </div>
  );
}
