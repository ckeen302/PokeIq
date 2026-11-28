"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Play } from "lucide-react";
import Link from "@/components/ui/Link";
import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import nuz from "@/messages/nuzlocke";
import { cn } from "@/lib/utils";
import { listRuns, loadStore } from "@/lib/nuzlocke/storage";
import type { Run } from "@/lib/nuzlocke/run";
import type { GameSummary } from "@/lib/nuzlocke/view";
import { StartRun, runPath } from "./StartRun";

/** A game page's big "Start a run in …" button (it opens the new-run sheet), and Continue for a run of it saved here. */
export function GameStart({ game, label }: { game: GameSummary; label: string }) {
  const t = useT(nuz);
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<Run | null>(null);
  useEffect(() => setLast(listRuns(loadStore()).find((r) => r.game === game.id) ?? null), [game.id]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonVariants({ size: "lg" }), "h-14 px-8 text-base max-sm:w-full")} data-testid="nz-game-start">
        <Play className="h-4 w-4 fill-current" aria-hidden /> {label}
      </button>
      {last && (
        <Link href={runPath(last.id)} className="inline-flex h-12 items-center gap-2 rounded-full bg-foreground/[0.07] px-5 text-[14.5px] font-semibold transition-colors hover:bg-foreground/[0.11] max-sm:w-full max-sm:justify-center" data-testid="nz-game-continue">
          {t("home.open", { name: last.name })} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
      {open && <StartRun games={[game]} gameId={game.id} onClose={() => setOpen(false)} />}
    </div>
  );
}
