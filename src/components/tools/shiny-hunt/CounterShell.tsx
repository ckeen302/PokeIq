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
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 max-sm:mb-4">
        <span className="h-12 w-[380px] max-w-full rounded-full bg-foreground/[0.06]" />
        <span className="h-12 w-[420px] max-w-full rounded-full bg-foreground/[0.04]" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.06fr)_minmax(0,1fr)]">
        <div className="h-[580px] rounded-[30px] bg-[#0d0a1d]/80 max-sm:h-[340px]" />
        <div className="h-[580px] rounded-[30px] border border-foreground/[0.07] bg-card/60 max-lg:h-[260px]" />
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
