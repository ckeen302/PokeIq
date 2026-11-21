"use client";

import Link from "@/components/ui/Link";
import { ChevronRight, Fingerprint, ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import { QUIZ_PATH } from "@/lib/which-pokemon/match";
import { MODULE_INFO, PLAY_MODULES, moduleHref } from "@/lib/modes";
import { useProgress } from "@/lib/progress";
import { ModeIcon } from "@/components/game/ModeIcon";

/** Each tile slides in a beat after the one before. In CSS, so the tiles paint with the page instead of waiting for the scripts. */
const ENTER = "animate-in fade-in-0 slide-in-from-left-3 fill-mode-both duration-300 ease-out";

interface Tile { key: string; href: string; title: string; description: string; accent: string; icon: ReactNode; best?: number; testId?: string }

/** Quizzes outside the mode list, shown as the same tiles at its end. */
const EXTRAS: Tile[] = [
  {
    key: "name-em-all",
    href: "/quiz/name-em-all",
    title: "Name 'em All",
    description: "Name every Pokémon you can.",
    accent: "170 80% 50%",
    icon: <ListChecks className="relative z-[3] h-6 w-6" aria-hidden />,
    testId: "play-name-em-all",
  },
  {
    key: "which-pokemon",
    href: QUIZ_PATH,
    title: "Which Pokémon Are You?",
    description: "Find the Pokémon most like you.",
    accent: "290 80% 66%",
    icon: <Fingerprint className="relative z-[3] h-6 w-6" aria-hidden />,
    testId: "play-which-pokemon-tile",
  },
];

/**
 * The order on the page: the quizzes most visitors are likely to pick first,
 * the more specialist ones last. A tile that isn't listed goes to the end.
 */
const ORDER = [
  "whos-that",
  "which-pokemon",
  "higher-lower",
  "name-em-all",
  "shiny",
  "zoom-reveal",
  "types",
  "cry",
  "mixed",
  "whose-team",
  "anime",
  "games",
  "dex",
  "competitive",
];
const rank = (key: string) => {
  const i = ORDER.indexOf(key);
  return i < 0 ? ORDER.length : i;
};

/** Game-menu list of modes: ▶ cursor on hover, accent stripe per mode. */
export function ModeGrid() {
  const progress = useProgress();
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
      ]
        .sort((a, b) => rank(a.key) - rank(b.key))
        .map((t, i) => (
        <div key={t.key} className={ENTER} style={{ animationDelay: `${50 + i * 50}ms` }}>
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
        </div>
      ))}
    </div>
  );
}
