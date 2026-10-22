"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clapperboard, Loader2, Save } from "lucide-react";
import { PLAY_FORMAT_INFO, type BattleView } from "@/lib/battle/play";
import { rememberReplay } from "@/lib/battle/replay-client";
import { battleShareText, replayShareText, shareUrl, type BattleShareResult } from "@/lib/share";
import { ShareButton } from "@/components/share/ShareButton";
import { Button, buttonVariants } from "@/components/ui/button";
import type { BattleHandle } from "./use-battle";
import { RatingChange } from "@/components/pokedle/Ranked";
import { isProvisional } from "@/lib/ranked";

/** Shares a replay's link (the system share sheet, or the clipboard): `result` is "Red beat Blue". */
export function ShareReplay({ id, result, formatName, size = "sm" }: { id: string; result: string; formatName: string; size?: "sm" | "default" }) {
  return (
    <ShareButton
      size={size}
      variant="outline"
      label="Share"
      kind="replay"
      data-testid="share-replay"
      getText={() => replayShareText(result, formatName, `${window.location.origin}/battle/replay/${id}`)}
    />
  );
}

/** A battle you won (or drew), as a share result. */
export function battleShareResult(view: BattleView): BattleShareResult | null {
  if (view.you === null || !view.end || view.end.reason === "nocontest" || view.turn < 1) return null;
  const outcome = view.end.winner === null ? "tie" : view.end.winner === view.you ? "win" : "loss";
  if (outcome === "loss") return null;
  return {
    game: "battle",
    format: view.format,
    outcome,
    ...(view.kind === "cpu" && view.cpu ? { cpu: view.cpu.level } : {}),
    ...(view.ranked ? { ranked: true } : {}),
    turns: view.turn,
  };
}

/** "Share result" after a win: the replay's link once there is one (its card shows the battle), else a /s/ result link. */
function ShareWin({ view, result }: { view: BattleView; result: BattleShareResult }) {
  const formatName = view.formatName ?? PLAY_FORMAT_INFO[view.format].name;
  return (
    <ShareButton
      size="sm"
      kind="battle"
      getText={() => battleShareText(result, view.replay ? `${window.location.origin}/battle/replay/${view.replay}` : shareUrl(result), formatName)}
    />
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

  if (view.you === null) return null;
  const players = view.players.map((p) => p.name).join(" vs ");
  const mine = view.ratings?.[view.you];
  const games = view.players[view.you]?.games;
  const win = battleShareResult(view);
  return (
    <div className="space-y-3">
      {win && (
        <div className="flex flex-wrap justify-center gap-2" data-testid="share-battle">
          <ShareWin view={view} result={win} />
        </div>
      )}
      {view.ranked &&
        (mine ? (
          <div className="mx-auto max-w-sm text-left" data-testid="rating-change">
            <RatingChange before={mine.before} after={mine.after} provisional={games !== undefined && isProvisional(games)} />
          </div>
        ) : !view.settled ? (
          <p className="hud-label flex items-center justify-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Updating ratings…
          </p>
        ) : null)}
      {played && <ReplayButtons view={view} battle={battle} auto={auto} saving={saving} setSaving={setSaving} players={players} />}
    </div>
  );
}

function ReplayButtons({
  view,
  battle,
  auto,
  saving,
  setSaving,
  players,
}: {
  view: BattleView;
  battle: BattleHandle;
  auto: boolean | undefined;
  saving: boolean;
  setSaving: (s: boolean) => void;
  players: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2" data-testid="replay-actions">
      {view.replay ? (
        <>
          <Link href={`/battle/replay/${view.replay}`} className={buttonVariants({ size: "sm" })} data-testid="watch-replay">
            <Clapperboard className="h-4 w-4" aria-hidden /> Watch replay
          </Link>
          <ShareReplay id={view.replay} result={players} formatName={view.formatName ?? PLAY_FORMAT_INFO[view.format].name} />
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
