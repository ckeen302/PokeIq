"use client";

import type { Athlete } from "@/lib/games/athlete";
import type { EventOutcome, GamesResult } from "@/lib/games/games";

/** "Make a video" (filled in by the recorder step). */
export default function MakeGamesVideo(p: { kind: "event" | "games"; outcome: EventOutcome | null; games: GamesResult | null; byKey: ReadonlyMap<string, Athlete>; title: string; slug: string; link: string; h2h: boolean; onRecording(on: boolean): void; onClose(): void }) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/55" role="dialog" aria-modal="true" data-testid="games-video-dialog">
      <button type="button" onClick={p.onClose} className="rounded bg-white/10 px-3 py-2 text-white" data-testid="games-video-close">Close</button>
    </div>
  );
}
