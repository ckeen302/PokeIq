"use client";

import dynamic from "next/dynamic";
import { HuntLocalContext, type HuntLocal } from "./names";

/**
 * The counter runs in the browser only (the hunts live in this browser's storage); until it loads, a skeleton with
 * the same geometry, so nothing jumps when it arrives.
 */
function Skeleton() {
  return (
    <div className="mt-6 animate-pulse motion-reduce:animate-none max-sm:mt-4" data-testid="shiny-counter-skeleton" aria-hidden>
      <div className="mb-5 flex items-center justify-between">
        <div className="flex gap-1">
          <span className="h-10 w-24 rounded-full bg-foreground/[0.08]" />
          <span className="h-10 w-20 rounded-full bg-foreground/[0.04]" />
          <span className="h-10 w-28 rounded-full bg-foreground/[0.04]" />
        </div>
        <span className="h-11 w-11 rounded-full bg-foreground/[0.04]" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="h-[600px] rounded-[28px] border border-foreground/[0.07] bg-card/60 max-sm:h-[520px]" />
        <div className="h-[600px] rounded-[24px] border border-foreground/[0.07] bg-card/60 max-lg:hidden" />
      </div>
    </div>
  );
}

const HuntApp = dynamic(() => import("./HuntApp"), { ssr: false, loading: Skeleton });

/** `local`: a page in another language's Pokémon names (English pages send none). */
export function CounterShell({ local }: { local?: HuntLocal }) {
  if (!local) return <HuntApp />;
  return (
    <HuntLocalContext.Provider value={local}>
      <HuntApp />
    </HuntLocalContext.Provider>
  );
}
