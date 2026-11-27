"use client";

import Link from "@/components/ui/Link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Brain, CalendarDays, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { IconWell, accentStyle, cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useProgress } from "@/lib/progress";
import { useToday } from "@/lib/use-today";
import { useT } from "@/i18n/client";
import featuredNs from "@/messages/quiz-featured";

interface Featured {
  id: "daily" | "iq";
  href: string;
  /** HSL triplet. */
  accent: string;
  icon: LucideIcon;
  variant: "default" | "secondary";
}

const FEATURED: readonly Featured[] = [
  {
    id: "daily",
    href: "/daily",
    accent: "340 86% 60%",
    icon: CalendarDays,
    variant: "default",
  },
  {
    id: "iq",
    href: "/iq-test",
    accent: "265 85% 72%",
    icon: Brain,
    variant: "secondary",
  },
];

/**
 * The Daily Challenge and the PokéIQ Test, as two big cards above the quiz
 * list. Once today's Daily is played on this device, its card says so (the
 * server sends it as not played; the flag sits beside the button, so nothing moves).
 */
export function QuizFeatured() {
  const progress = useProgress();
  const today = useToday();
  const dailyDone = Boolean(today && progress?.daily?.results?.[today]);
  const t = useT(featuredNs);
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {FEATURED.map((f) => {
        const Icon = f.icon;
        const done = f.id === "daily" && dailyDone;
        return (
          <li key={f.id}>
            <Link
              href={f.href}
              className={cn(cardVariants({ variant: "feature", interactive: true }), "group flex h-full flex-col overflow-hidden p-6 max-md:p-5")}
              style={accentStyle(f.accent)}
              data-testid={`quiz-featured-${f.id}`}
            >
              {/* The pick's art: its icon, big and faint, bursting from the corner. */}
              <Icon
                className="pointer-events-none absolute -bottom-6 -right-4 h-[150px] w-[150px] rotate-[-8deg] opacity-[0.14] transition-transform duration-500 group-hover:rotate-0 group-hover:scale-105 motion-reduce:transition-none [.light_&]:opacity-[0.1]"
                style={{ color: `hsl(${f.accent})` }}
                strokeWidth={1.5}
                aria-hidden
              />
              <span className="flex items-center gap-4 max-md:gap-3">
                <IconWell size="lg" className="max-md:h-12 max-md:w-12">
                  <Icon aria-hidden />
                </IconWell>
                <span className="min-w-0">
                  <span className="kit-ink block font-display text-[11px] font-bold uppercase tracking-[0.14em]">{t(`${f.id}.kicker`)}</span>
                  <span className="kit-title mt-1 block text-[1.75rem] max-md:text-2xl">{t(`${f.id}.title`)}</span>
                </span>
              </span>
              <span className="mt-3 block max-w-md text-[15px] leading-snug text-feature-sub">{t(`${f.id}.text`)}</span>
              <span className="mt-auto flex items-center gap-3 pt-5">
                <span className={buttonVariants({ variant: f.variant })}>
                  {t(`${f.id}.cta`)} <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
                {done && (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-success" data-testid="quiz-featured-daily-done">
                    <Check className="h-4 w-4" aria-hidden /> {t("done")}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
