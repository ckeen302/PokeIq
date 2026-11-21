"use client";

import { Play } from "lucide-react";

/** Opens the game's how-to pop-up (with its live demo); the game listens for this event. `label`: its text in the page's language (GameInfo's "How to play {name}"). */
export function HowToButton({ name, label }: { name: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("pokeiq:howto"))}
      className="tap inline-flex items-center gap-2 rounded-md border border-primary/60 bg-primary/10 px-4 py-2 font-display text-sm font-bold uppercase tracking-wider text-foreground transition-colors hover:bg-primary/20"
      data-testid="howto-button"
    >
      <Play className="h-4 w-4 text-primary" aria-hidden />
      {label ?? <>How to play {name}</>}
    </button>
  );
}
