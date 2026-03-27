"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Construction } from "lucide-react";

const SPORTS = [
  { label: "MLB", href: "/", active: true },
  { label: "NHL", href: null },
  { label: "NBA", href: null },
  { label: "NFL", href: null },
];

export function SportNav() {
  const pathname = usePathname();
  const [pending, setPending] = useState<string | null>(null);

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        {SPORTS.map((sport) => {
          const isActive = sport.href
            ? pathname === sport.href || pathname.startsWith("/game") || pathname.startsWith("/analytics")
              ? sport.label === "MLB"
              : false
            : false;

          if (sport.href) {
            return (
              <Link
                key={sport.label}
                href={sport.href}
                onClick={() => setPending(null)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                  isActive
                    ? "brand-gradient text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {sport.label}
              </Link>
            );
          }

          return (
            <button
              key={sport.label}
              onClick={() => setPending(pending === sport.label ? null : sport.label)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                pending === sport.label
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {sport.label}
            </button>
          );
        })}
      </div>

      {pending && (
        <div className="absolute top-10 left-0 z-50 bg-card border border-border rounded-xl px-5 py-4 shadow-xl flex items-center gap-3 w-52">
          <Construction size={18} className="text-primary shrink-0" />
          <div>
            <div className="font-semibold text-sm">{pending} — Coming Soon</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              We&apos;re building this out. Stay tuned!
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
