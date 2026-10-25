"use client";

import { motion } from "framer-motion";
import { artUrl } from "@/lib/pokemon/art";
import { CONN_MAX_MISTAKES } from "@/lib/connections/types";
import { LevelMark, MistakeDots, levelStyle } from "@/components/connections/parts";
import { cn } from "@/lib/utils";
import { DemoFrame, useDemoFrame } from "./shared";

/** Real Pokémon: the first four are the Fire-type starters of Gens 1 to 4; Vaporeon, Jolteon, Flareon and Umbreon are Eevee's Gen 1-2 evolutions. */
const T = (id: number, name: string) => ({ id, name });
const FIRE = [T(4, "Charmander"), T(155, "Cyndaquil"), T(255, "Torchic"), T(390, "Chimchar")];
const EEVEE = [T(134, "Vaporeon"), T(135, "Jolteon"), T(136, "Flareon"), T(197, "Umbreon")];
const GHOST = [T(92, "Gastly"), T(93, "Haunter"), T(200, "Misdreavus"), T(353, "Shuppet")];
const BIRDS = [T(144, "Articuno"), T(145, "Zapdos"), T(146, "Moltres"), T(150, "Mewtwo")];
const ORDER = [FIRE[0], EEVEE[0], GHOST[0], BIRDS[0], EEVEE[1], FIRE[1], GHOST[1], BIRDS[1], GHOST[2], EEVEE[2], FIRE[2], BIRDS[2], BIRDS[3], FIRE[3], EEVEE[3], GHOST[3]];

const WRONG = [EEVEE[0], EEVEE[1], EEVEE[2], GHOST[0]];

interface Frame {
  selected: number[];
  found: boolean;
  /** The Submit button is pressed. */
  press?: boolean;
  /** "One away…" shows and the picked tiles shake. */
  oneAway?: boolean;
  ms: number;
}
const FRAMES: Frame[] = [
  { selected: [], found: false, ms: 800 },
  ...FIRE.map((_, i): Frame => ({ selected: FIRE.slice(0, i + 1).map((m) => m.id), found: false, ms: 450 })),
  { selected: FIRE.map((m) => m.id), found: false, press: true, ms: 500 },
  { selected: [], found: true, ms: 1500 },
  ...WRONG.map((_, i): Frame => ({ selected: WRONG.slice(0, i + 1).map((m) => m.id), found: true, ms: 450 })),
  { selected: WRONG.map((m) => m.id), found: true, press: true, ms: 500 },
  { selected: WRONG.map((m) => m.id), found: true, oneAway: true, ms: 1900 },
];
const MS = FRAMES.map((f) => f.ms);
const FOUND_LABEL = "Fire starters";

export function ConnectionsDemo() {
  const frame = FRAMES[useDemoFrame(MS)];
  const rest = ORDER.filter((m) => !(frame.found && FIRE.some((f) => f.id === m.id)));
  return (
    <DemoFrame label="Demo: four Fire-type starters are picked and submitted, locking in as a purple group, then a guess that is one away">
      <div className="mx-auto max-w-sm space-y-1.5">
        <div className="relative h-5 text-center text-xs font-bold">
          {frame.oneAway && (
            <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded bg-foreground px-2 py-0.5 text-background">
              One away…
            </motion.span>
          )}
        </div>
        {frame.found && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex h-16 flex-col items-center justify-center rounded-lg px-2 text-center shadow-[0_3px_0_rgb(0_0_0/0.25)]"
            style={levelStyle(3)}
          >
            <p className="flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide">
              <LevelMark level={3} className="text-xs opacity-70" /> {FOUND_LABEL} <LevelMark level={3} className="text-xs opacity-70" />
            </p>
            <p className="text-[11px] font-semibold">{FIRE.map((m) => m.name).join(", ")}</p>
          </motion.div>
        )}
        <div className="grid grid-cols-4 gap-1.5">
          {rest.map((m) => {
            const on = frame.selected.includes(m.id);
            return (
              <motion.div
                key={m.id}
                layout
                transition={{ layout: { type: "spring", stiffness: 420, damping: 36 } }}
                animate={frame.oneAway && on ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
                className={cn(
                  "flex h-[4.25rem] min-w-0 flex-col items-center justify-center rounded-lg border px-0.5 text-center",
                  on ? "border-screen bg-screen text-background shadow-[0_3px_0_hsl(var(--screen)/0.45)]" : "border-foreground/10 bg-card shadow-[0_3px_0_hsl(var(--border))]"
                )}
              >
                <img src={artUrl(m.id, 96)} alt="" width={36} height={36} className="h-9 w-9 object-contain" />
                <span className="w-full truncate font-display text-[9px] font-bold uppercase leading-tight">{m.name}</span>
              </motion.div>
            );
          })}
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MistakeDots left={frame.oneAway ? CONN_MAX_MISTAKES - 1 : CONN_MAX_MISTAKES} max={CONN_MAX_MISTAKES} />
          </div>
          <span className={cn("rounded-md border-2 px-3 py-1 text-xs font-bold uppercase", frame.press ? "border-screen bg-screen text-background" : frame.selected.length === 4 ? "border-foreground/40" : "border-foreground/10 text-muted-foreground")}>Submit</span>
        </div>
      </div>
    </DemoFrame>
  );
}
