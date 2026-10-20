"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Clapperboard, Loader2, Save, Share2 } from "lucide-react";
import type { BattleView } from "@/lib/battle/play";
import { rememberReplay } from "@/lib/battle/replay-client";
import { shareOrCopy } from "@/lib/share";
import { Button, buttonVariants } from "@/components/ui/button";
import type { BattleHandle } from "./use-battle";

/** Shares a replay's link (the system share sheet, or the clipboard). */
export function ShareReplay({ id, text, size = "sm" }: { id: string; text: string; size?: "sm" | "default" }) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      onClick={async () => {
        const out = await shareOrCopy(text, `${window.location.origin}/battle/replay/${id}`);
        setDone(out === "copied" ? "Link copied" : out === "shared" ? "Shared" : null);
        window.setTimeout(() => setDone(null), 2500);
      }}
      data-testid="share-replay"
    >
      {done ? <Check className="h-4 w-4" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />} {done ?? "Share"}
    </Button>
  );
}

/**
 * After a battle: its replay. Ranked battles and battles open to spectators
 * save theirs on their own; any other can be saved by either trainer.
 */
export function BattleAfter({ view, battle }: { view: BattleView; battle: BattleHandle }) {
  const [saving, setSaving] = useState(false);
  const auto = view.kind === "pvp" && (view.public || view.ranked);
  const played = view.turn >= 1 && view.end?.reason !== "nocontest";

  useEffect(() => {
    if (view.replay && view.you !== null) rememberReplay(view.replay);
  }, [view.replay, view.you]);

  if (!played || view.you === null) return null;
  const players = view.players.map((p) => p.name).join(" vs ");
  return (
    <div className="flex flex-wrap items-center justify-center gap-2" data-testid="replay-actions">
      {view.replay ? (
        <>
          <Link href={`/battle/replay/${view.replay}`} className={buttonVariants({ size: "sm" })} data-testid="watch-replay">
            <Clapperboard className="h-4 w-4" aria-hidden /> Watch replay
          </Link>
          <ShareReplay id={view.replay} text={`${players}: watch the replay on PokéIQ`} />
        </>
      ) : auto && !view.settled ? (
        <span className="hud-label flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving the replay…
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving || battle.busy}
          onClick={async () => {
            setSaving(true);
            await battle.act({ action: "savereplay" });
            setSaving(false);
          }}
          data-testid="save-replay"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} Save replay
        </Button>
      )}
    </div>
  );
}
