"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, subtitle, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between group mb-1 py-1"
      >
        <div className="text-left">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest group-hover:text-foreground transition-colors">
            {title}
          </h2>
          {subtitle && !open && (
            <p className="text-xs text-muted-foreground/60 mt-0.5">{subtitle}</p>
          )}
        </div>
        <ChevronDown
          size={16}
          className={`text-muted-foreground shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && subtitle && (
        <p className="text-xs text-muted-foreground mb-4">{subtitle}</p>
      )}

      {open && <div>{children}</div>}
    </section>
  );
}
