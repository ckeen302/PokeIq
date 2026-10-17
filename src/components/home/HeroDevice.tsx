"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { artUrl } from "@/lib/pokemon/art";

/** A handheld Pokédex on the title screen that cycles "Who's that Pokémon?". */
const ROSTER: [number, string][] = [
  [25, "Pikachu"], [6, "Charizard"], [94, "Gengar"], [150, "Mewtwo"], [448, "Lucario"],
  [658, "Greninja"], [133, "Eevee"], [384, "Rayquaza"], [143, "Snorlax"], [249, "Lugia"],
  [887, "Dragapult"], [1008, "Miraidon"], [700, "Sylveon"], [445, "Garchomp"],
];

export function HeroDevice() {
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const reveal = setTimeout(() => setRevealed(true), 2400);
    const next = setTimeout(() => {
      setRevealed(false);
      setI((n) => (n + 1) % ROSTER.length);
    }, 4000);
    return () => {
      clearTimeout(reveal);
      clearTimeout(next);
    };
  }, [i]);

  // Warm the cache for the next sprite.
  useEffect(() => {
    new window.Image().src = artUrl(ROSTER[(i + 1) % ROSTER.length][0], 256);
  }, [i]);

  const [id, name] = ROSTER[i];

  return (
    <div className="relative mx-auto w-full max-w-[360px] select-none" aria-hidden>
      {/* Casing */}
      <div className="rounded-[22px] border-2 border-black/60 bg-gradient-to-b from-[hsl(6_80%_50%)] to-[hsl(6_78%_38%)] p-4 shadow-[0_20px_50px_-15px_hsl(6_80%_40%/0.6),inset_0_2px_0_hsl(6_100%_70%/0.5)]">
        <div className="mb-3 flex items-center gap-3">
          <span className="relative h-10 w-10 rounded-full border-[3px] border-white/90 bg-[radial-gradient(circle_at_35%_35%,hsl(186_95%_85%),hsl(var(--screen))_45%,hsl(200_90%_25%))] shadow-[0_0_16px_hsl(var(--screen)/0.8)]">
            <span className="absolute left-2 top-2 h-2 w-2 rounded-full bg-white/90" />
          </span>
          <span className="led text-primary brightness-150" />
          <span className="led text-warning" />
          <span className="led text-success" />
          <span className="ml-auto font-pixel text-[9px] text-white/70">DEX-IQ</span>
        </div>

        {/* Display */}
        <div className="rounded-lg border-[3px] border-black/70 bg-black/80 p-2">
          <div className="screen spotlight relative aspect-square rounded-sm">
            <AnimatePresence mode="wait">
              <motion.img
                key={`${id}-${revealed}`}
                src={artUrl(id, 256)}
                alt=""
                className="absolute inset-0 z-[1] m-auto h-[82%] w-[82%] object-contain"
                style={{ filter: revealed ? "none" : "brightness(0)" }}
                initial={{ opacity: 0, scale: revealed ? 1.15 : 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: revealed ? 0.25 : 0.35 }}
              />
            </AnimatePresence>
            <div className="absolute inset-x-0 bottom-0 z-[3] bg-black/70 py-1.5 text-center font-pixel text-[11px] tracking-wider text-white">
              {revealed ? `It's ${name}!` : "Who's that Pokémon?"}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-4 flex items-center justify-between px-2">
          <div className="relative h-14 w-14">
            <span className="absolute left-1/2 top-0 h-full w-[18px] -translate-x-1/2 rounded-sm bg-black/80" />
            <span className="absolute left-0 top-1/2 h-[18px] w-full -translate-y-1/2 rounded-sm bg-black/80" />
          </div>
          <div className="flex gap-1.5">
            <span className="h-2 w-8 rounded-full bg-black/60" />
            <span className="h-2 w-8 rounded-full bg-black/60" />
          </div>
          <div className="flex gap-2">
            <span className="h-8 w-8 rounded-full bg-black/80 shadow-[inset_0_2px_0_rgb(255_255_255/0.15)]" />
            <span className="-mt-4 h-8 w-8 rounded-full bg-black/80 shadow-[inset_0_2px_0_rgb(255_255_255/0.15)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
