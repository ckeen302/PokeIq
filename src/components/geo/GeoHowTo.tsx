"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { Sheet } from "@/components/pokedle/sheets";
import { HowToActions, HowToCards } from "@/components/howto/shared";
import { GuessrDemo } from "@/components/howto/GuessrDemo";
import { GEO_MAX_ROUND_SCORE, GEO_ROUND_OPTIONS, GEO_ROUNDS } from "@/lib/geo-types";
import { DUEL_HP } from "@/lib/duel-types";
import { cn } from "@/lib/utils";

const PREFS_KEY = "pokeiq:guessr-prefs:v1";
const fmt = (n: number) => n.toLocaleString("en-US");

function seenDemo(): boolean {
  try {
    return !!(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { seenHowToDemo?: boolean }).seenHowToDemo;
  } catch {
    return false;
  }
}

/** The "?" icon button: asks the pop-up (GeoHowTo) to open. */
export function HowToHelpButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("pokeiq:howto"))}
      aria-label="How to play"
      title="How to play"
      data-testid="geo-howto-open"
      className={cn(
        "rounded-md p-2 text-muted-foreground transition-colors hover:bg-screen/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <CircleHelp className="h-5 w-5" />
    </button>
  );
}

/** PokéGuessr's "How to play" pop-up: opens by itself once per visit until "Don't show again", and on the `pokeiq:howto` event. */
export function GeoHowTo() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("pokeiq:howto", show);
    return () => window.removeEventListener("pokeiq:howto", show);
  }, []);
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    if (!seenDemo()) setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const never = useCallback(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ seenHowToDemo: true }));
    } catch {
      // Private mode: it stays closed for this visit only.
    }
    setOpen(false);
  }, []);
  if (!open) return null;
  return (
    <Sheet title="How to play" onClose={close} wide>
      <div className="space-y-4 text-sm" data-testid="howto-sheet">
        <GuessrDemo />
        <HowToCards
          cards={[
            { title: "The goal", body: <p>You are dropped somewhere in the Pokémon world and shown only a screenshot. Work out where it is, drop a pin on the map and press Guess.</p> },
            {
              title: "Scoring",
              body: (
                <p>
                  Up to {fmt(GEO_MAX_ROUND_SCORE)} points a round: the closer your pin, the more you score. A game is {GEO_ROUND_OPTIONS.join(", ")} rounds; the Daily is always {GEO_ROUNDS}.
                </p>
              ),
            },
            {
              title: "Modes",
              body: (
                <p>
                  Daily: the same {GEO_ROUNDS} places for everyone. Streak: keep naming places until a pin misses. Play the world, a region or a themed map, with Classic 2D or Modern 3D games.
                </p>
              ),
            },
            {
              title: "Duels",
              body: (
                <p>
                  Face a friend live. HP battle: you both start with {fmt(DUEL_HP)} HP and the closer pin damages the other. Points race: the best total over the rounds wins.
                </p>
              ),
            },
          ]}
        />
        <HowToActions onClose={close} onNever={never} />
      </div>
    </Sheet>
  );
}
