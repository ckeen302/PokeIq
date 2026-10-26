"use client";

import { Children, useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Switch between one trainer's battles (first battle, rematches, rival
 * variants). Every panel is server-rendered; the inactive ones are hidden.
 */
export function TeamTabs({ labels, children }: { labels: string[]; children: React.ReactNode }) {
  const [active, setActive] = useState(0);
  const id = useId();
  const panels = Children.toArray(children);
  return (
    <div>
      <div role="tablist" aria-label="Battles" className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {labels.map((l, i) => (
          <button
            key={l + i}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={active === i}
            aria-controls={`${id}-panel-${i}`}
            onClick={() => setActive(i)}
            data-testid="trainer-team-tab"
            className={cn(
              "shrink-0 rounded-sm border px-2.5 py-1.5 font-pixel text-[9px] uppercase tracking-wider transition-colors",
              active === i ? "border-primary bg-primary text-primary-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:text-foreground"
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {panels.map((p, i) => (
        <div key={i} role="tabpanel" id={`${id}-panel-${i}`} aria-labelledby={`${id}-tab-${i}`} hidden={active !== i}>
          {p}
        </div>
      ))}
    </div>
  );
}
