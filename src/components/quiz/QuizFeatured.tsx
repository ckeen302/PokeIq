"use client";

import Link from "@/components/ui/Link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Brain, CalendarDays, Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
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
              className="menu-item group relative flex h-full flex-col overflow-hidden rounded-lg border bg-card p-5 hover:border-screen/50"
              data-testid={`quiz-featured-${f.id}`}
            >
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: `hsl(${f.accent})` }} aria-hidden />
              <Icon
                className="pointer-events-none absolute -bottom-[22px] -right-[14px] h-[150px] w-[150px] opacity-[0.08]"
                style={{ color: `hsl(${f.accent})` }}
                aria-hidden
              />
              <span className="flex items-center gap-4 max-md:gap-3">
                <span
                  className="screen icon-well flex h-14 w-14 shrink-0 items-center justify-center rounded-md max-md:h-11 max-md:w-11"
                  style={{ color: `hsl(${f.accent})` }}
                >
                  <Icon className="relative z-[3] h-6 w-6" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="hud-label block" style={{ color: `hsl(${f.accent})` }}>
                    {t(`${f.id}.kicker`)}
                  </span>
                  <span className="block font-display text-2xl font-bold uppercase tracking-wide max-md:text-xl">{t(`${f.id}.title`)}</span>
                </span>
              </span>
              <span className="mt-3 block text-sm text-muted-foreground">{t(`${f.id}.text`)}</span>
              <span className="mt-5 flex items-center gap-3">
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
