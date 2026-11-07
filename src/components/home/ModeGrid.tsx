"use client";

import Link from "@/components/ui/Link";
import { motion } from "framer-motion";
import { ChevronRight, ListChecks, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { QUIZ_PATH } from "@/lib/which-pokemon/match";
import { MODULE_INFO, PLAY_MODULES, moduleHref } from "@/lib/modes";
import { useProgress } from "@/lib/progress";
import { ModeIcon } from "@/components/game/ModeIcon";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } } };
const item = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.21, 0.47, 0.32, 0.98] as const } },
};

interface Tile { key: string; href: string; title: string; description: string; accent: string; icon: ReactNode; best?: number; testId?: string }

/** Quizzes outside the mode list, shown as the same tiles at its end. */
const EXTRAS: Tile[] = [
  {
    key: "name-em-all",
    href: "/quiz/name-em-all",
    title: "Name 'em All",
    description: "Type every Pokémon you can remember: a generation, a type, Legendaries, Megas or a regional dex.",
    accent: "170 80% 50%",
    icon: <ListChecks className="relative z-[3] h-6 w-6" aria-hidden />,
    testId: "play-name-em-all",
  },
  {
    key: "which-pokemon",
    href: QUIZ_PATH,
    title: "Which Pokémon Are You?",
    description: "A personality quiz with a real trait model, a share card and a compare-with-a-friend link.",
    accent: "290 80% 66%",
    icon: <Sparkles className="relative z-[3] h-6 w-6" aria-hidden />,
    testId: "play-which-pokemon-tile",
  },
];

/** Game-menu list of modes: ▶ cursor on hover, accent stripe per mode. */
export function ModeGrid() {
  const progress = useProgress();
  return (
    <motion.div className="grid grid-cols-1 gap-3 md:grid-cols-2" variants={container} initial="hidden" animate="show">
      {[
        ...PLAY_MODULES.map((id): Tile => {
          const info = MODULE_INFO[id];
          return {
            key: id,
            href: moduleHref(id),
            title: info.title,
            description: info.description,
            accent: info.accent,
            icon: <ModeIcon module={id} className="relative z-[3] h-6 w-6" />,
            best: progress?.best[`${id}:${info.defaultFormat}`],
          };
        }),
        ...EXTRAS,
      ].map((t, i) => (
        <motion.div key={t.key} variants={item}>
          <Link
            href={t.href}
            className="menu-item group flex h-full items-center gap-4 overflow-hidden rounded-lg border bg-card p-4 hover:border-screen/50 hover:bg-accent/40 max-md:gap-3"
            data-testid={t.testId}
          >
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: `hsl(${t.accent})` }} aria-hidden />
            <span
              className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md max-md:h-11 max-md:w-11"
              style={{ color: `hsl(${t.accent})` }}
            >
              {t.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                {/* The link's name is its visible text: the title, then the description. */}
                <span className="hud-label max-md:hidden" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="truncate font-display text-lg font-bold uppercase tracking-wide max-md:whitespace-normal max-md:text-base max-md:leading-tight">{t.title}</span>
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground max-md:line-clamp-2">{t.description}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {t.best ? <span className="hud-label text-screen">Best {t.best.toLocaleString()}</span> : null}
              <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
            </span>
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
