"use client";

import { useEffect, useState } from "react";
import { Music, Music2 } from "lucide-react";
import { battleMusic, DEFAULT_MUSIC, type BattleTrack, type MusicState } from "@/lib/battle/music";
import type { BattleView } from "@/lib/battle/play";
import { cn } from "@/lib/utils";

/** The track a battle calls for: a boss theme for the Tycoon (and each round's last Factory battle), trainer music against people and in runs, and the win jingle. */
export function trackFor(view: BattleView, ended: boolean, won: boolean): BattleTrack | null {
  if (view.you === null || view.status === "lobby") return null;
  if (ended) return won ? "victory" : null;
  if (view.frontier?.boss || view.frontier?.battle === 7) return "boss";
  if (view.kind === "pvp" || view.frontier) return "trainer";
  return "wild";
}

/** Plays the battle's music while mounted. */
export function useBattleMusic(track: BattleTrack | null) {
  useEffect(() => {
    battleMusic.init();
  }, []);
  useEffect(() => {
    battleMusic.want(track);
  }, [track]);
  useEffect(() => () => battleMusic.stop(), []);
}

function useMusicState(): MusicState {
  const [state, setState] = useState<MusicState>({ prefs: DEFAULT_MUSIC, muted: false, armed: false, track: null });
  useEffect(() => battleMusic.subscribe(setState), []);
  return state;
}

/** Music on / off and its volume, kept on this device. Silent while the site is muted. */
export function MusicControl() {
  const { prefs, muted } = useMusicState();
  const on = prefs.on && !muted;
  return (
    <div className="flex items-center gap-1.5" data-testid="music-control">
      <button
        type="button"
        onClick={() => battleMusic.setPrefs({ on: !prefs.on })}
        aria-pressed={prefs.on}
        data-testid="music-toggle"
        title={muted ? "Sound is muted for the whole site" : prefs.on ? "Music on" : "Music off"}
        className={cn("flex h-7 items-center gap-1 rounded-md border px-2 font-display text-[11px] font-bold uppercase tracking-wider", on ? "text-foreground" : "text-muted-foreground")}
      >
        {on ? <Music className="h-3.5 w-3.5" aria-hidden /> : <Music2 className="h-3.5 w-3.5 opacity-50" aria-hidden />}
        {muted ? "Muted" : prefs.on ? "Music" : "Music off"}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(prefs.volume * 100)}
        onChange={(e) => battleMusic.setPrefs({ volume: Number(e.target.value) / 100 })}
        disabled={!prefs.on}
        aria-label="Music volume"
        data-testid="music-volume"
        className="hidden h-1 w-20 cursor-pointer sm:block accent-[hsl(var(--primary))] disabled:opacity-40"
      />
    </div>
  );
}
