"use client";

import dynamic from "next/dynamic";
import type { GameSummary } from "@/lib/nuzlocke/view";

/**
 * The run screen runs in the browser only (runs live in this browser's storage); until it loads, a skeleton with the
 * same geometry, so nothing jumps when it arrives.
 */
export function RunSkeleton() {
  return (
    <div className="mx-auto max-w-[1360px] animate-pulse motion-reduce:animate-none" data-testid="nz-skeleton" aria-hidden>
      <div className="h-[168px] rounded-[26px] border border-foreground/[0.07] bg-card/60 max-sm:h-[188px]" />
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-3">
          <div className="h-11 w-72 max-w-full rounded-full bg-foreground/[0.06]" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[92px] rounded-[22px] bg-foreground/[0.04]" />
          ))}
        </div>
        <div className="h-[520px] rounded-[26px] border border-foreground/[0.07] bg-card/60 max-lg:hidden" />
      </div>
    </div>
  );
}

const RunApp = dynamic(() => import("./RunApp"), { ssr: false, loading: RunSkeleton });

/** `shared`: a share link's payload (read-only), or null for a run saved here (?id=). */
export function RunShell({ games, shared, brokenText }: { games: GameSummary[]; shared: string | null; brokenText?: string }) {
  return <RunApp games={games} shared={shared} brokenText={brokenText} />;
}
