"use client";

import { useId, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** "How it works": a card's longer explanation, folded away until asked for. */
export function HowItWorks({ children, extra }: { children: React.ReactNode; /** Shown beside the toggle, e.g. a link. */ extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-3.5 w-3.5" aria-hidden /> How it works
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {extra}
      </div>
      {open && (
        <div id={id} className="space-y-1.5 rounded-md border bg-shade/20 p-3 text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}
