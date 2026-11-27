"use client";

import Link from "@/components/ui/Link";
import { ChevronRight, Fingerprint, ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import { QUIZ_PATH } from "@/lib/which-pokemon/path";
import { MODULE_INFO, PLAY_MODULES, moduleHref } from "@/lib/modes";
import { useT } from "@/i18n/client";
import { num } from "@/components/quiz/num";
import modesNs from "@/messages/quiz-modes";
import setupNs from "@/messages/quiz-setup";
import { useProgress } from "@/lib/progress";
import { ModeIcon } from "@/components/game/ModeIcon";
import { IconWell, accentStyle, cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Each tile slides in a beat after the one before. In CSS, so the tiles paint with the page instead of waiting for the scripts. */
const ENTER = "animate-in fade-in-0 slide-in-from-left-3 fill-mode-both duration-300 ease-out";

interface Tile { key: string; href: string; title: string; description: string; accent: string; icon: ReactNode; best?: number; testId?: string }

/** Quizzes outside the mode list, shown as the same tiles at its end (their words: the "quiz-setup" namespace's grid). */
const EXTRAS: Omit<Tile, "title" | "description">[] = [
  {
    key: "name-em-all",
    href: "/quiz/name-em-all",
    accent: "170 80% 50%",
    icon: <ListChecks className="relative z-[3] h-6 w-6" aria-hidden />,
    testId: "play-name-em-all",
  },
  {
    key: "which-pokemon",
    href: QUIZ_PATH,
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

/** The list of quiz modes: calm cards, each lit by its mode's colour. */
export function ModeGrid() {
  const progress = useProgress();
  const t = useT(setupNs);
  const mt = useT(modesNs);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {[
        ...PLAY_MODULES.map((id): Tile => {
          const info = MODULE_INFO[id];
          return {
            key: id,
            href: moduleHref(id),
            title: mt(`modules.${id}.title`),
            description: mt(`modules.${id}.description`),
            accent: info.accent,
            icon: <ModeIcon module={id} className="relative z-[3] h-6 w-6" />,
            best: progress?.best[`${id}:${info.defaultFormat}`],
          };
        }),
        ...EXTRAS.map((x): Tile => ({
          ...x,
          title: x.key === "name-em-all" ? t("grid.nameEmAll") : t("grid.whichPokemon"),
          description: x.key === "name-em-all" ? t("grid.nameEmAllLine") : t("grid.whichPokemonLine"),
        })),
      ]
        .sort((a, b) => rank(a.key) - rank(b.key))
        .map((tile, i) => (
        <div key={tile.key} className={ENTER} style={{ animationDelay: `${50 + i * 50}ms` }}>
          <Link
            href={tile.href}
            className={cn(cardVariants({ variant: "base", interactive: true }), "group flex h-full items-center gap-4 p-4 max-md:gap-3 max-md:p-3.5")}
            style={accentStyle(tile.accent)}
            data-testid={tile.testId}
          >
            <IconWell size="lg" className="max-md:h-11 max-md:w-11 max-md:rounded-xl max-md:[&_svg]:h-5 max-md:[&_svg]:w-5">{tile.icon}</IconWell>
            <span className="min-w-0 flex-1">
              {/* The link's name is its visible text: the title, then the description. */}
              <span className="block truncate font-display text-lg font-bold uppercase italic leading-tight tracking-wide max-md:whitespace-normal max-md:text-base">{tile.title}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground max-md:line-clamp-2">{tile.description}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {tile.best ? <span className="hud-label text-select">{t("grid.best", { score: num(tile.best, t.locale) })}</span> : null}
              <ChevronRight className="kit-ink h-5 w-5 opacity-70 transition-[transform,opacity] group-hover:translate-x-1 group-hover:opacity-100" />
            </span>
          </Link>
        </div>
      ))}
    </div>
  );
}
