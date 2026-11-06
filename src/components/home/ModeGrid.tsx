"use client";

import Link from "@/components/ui/Link";
import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { MODULE_INFO, PLAY_MODULES, moduleHref } from "@/lib/modes";
import { useProgress } from "@/lib/progress";
import { ModeIcon } from "@/components/game/ModeIcon";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } } };
const item = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.21, 0.47, 0.32, 0.98] as const } },
};

/** Game-menu list of modes: ▶ cursor on hover, accent stripe per mode. */
export function ModeGrid() {
  const progress = useProgress();
  return (
    <motion.div className="grid grid-cols-1 gap-3 md:grid-cols-2" variants={container} initial="hidden" animate="show">
      {PLAY_MODULES.map((id, i) => {
        const info = MODULE_INFO[id];
        const best = progress?.best[`${id}:${info.defaultFormat}`];
        return (
          <motion.div key={id} variants={item}>
            <Link
              href={moduleHref(id)}
              className="menu-item group flex h-full items-center gap-4 overflow-hidden rounded-lg border bg-card p-4 hover:border-screen/50 hover:bg-accent/40 max-md:gap-3"
            >
              <span className="absolute inset-y-0 left-0 w-1" style={{ background: `hsl(${info.accent})` }} aria-hidden />
              <span
                className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md max-md:h-11 max-md:w-11"
                style={{ color: `hsl(${info.accent})` }}
              >
                <ModeIcon module={id} className="relative z-[3] h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  {/* The link's name is its visible text: the title, then the description. */}
                  <span className="hud-label max-md:hidden" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate font-display text-lg font-bold uppercase tracking-wide max-md:whitespace-normal max-md:text-base max-md:leading-tight">{info.title}</span>
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground max-md:line-clamp-2">{info.description}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {best ? <span className="hud-label text-screen">Best {best.toLocaleString()}</span> : null}
                <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
              </span>
            </Link>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
