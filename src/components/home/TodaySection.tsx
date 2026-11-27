"use client";

import Link from "@/components/ui/Link";
import { Check, ChevronRight } from "lucide-react";
import { TimeToNextDaily } from "@/components/NextDailyCountdown";
import { useProgress } from "@/lib/progress";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/page-header";
import { IconWell, accentStyle, cardVariants } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { DAILIES, allDone, bestStreak, dailyStatuses, localStreakText, type DailyInfo, type DailyStatus } from "./today";
import { useT } from "@/i18n/client";
import home from "@/messages/home";
import type { Translator } from "@/i18n/catalog";

type T = Translator<typeof home.en>;

/**
 * Today: the five dailies in one place, each with Play or how today's went
 * on this device, the longest streak on top, and when everything's done, when
 * the next ones come. A desktop shows one even row of cards, a phone one row
 * per game. The server sends every game as new; the browser fills in this
 * device's progress (the line on top always takes one line, so nothing moves).
 */
export function TodaySection() {
  const progress = useProgress();
  const today = useToday();
  const t = useT(home);
  const statuses = dailyStatuses(progress, today, t);
  const streak = bestStreak(statuses);
  const finished = progress && today ? allDone(statuses) : false;

  const line = finished ? (
    <span data-testid="home-today-alldone">
      <span className="font-semibold text-success">{t("today.allDone")}</span>{t("today.newIn")}<TimeToNextDaily className="font-semibold tabular-nums text-foreground" />
    </span>
  ) : streak ? (
    <span data-testid="home-today-streak">
      <span aria-hidden>🔥 </span>
      <span className="font-semibold text-foreground">{localStreakText(t, streak)}</span>
      {streak.atRisk && <span className="max-sm:hidden">{t("today.keep")}</span>}
    </span>
  ) : (
    <span>{t("today.midnight")}</span>
  );

  return (
    <section aria-labelledby="home-today" data-testid="home-today" className="scroll-mt-20">
      <SectionHeader id="home-today" title={t("today.title")} aside={line} className="mb-4 md:mb-5" />
      <ul className="grid grid-cols-5 gap-3 max-lg:hidden" data-testid="home-today-cards">
        {DAILIES.map((d, i) => (
          <li key={d.id} className="motion-safe:animate-rise" style={{ animationDelay: `${120 + i * 70}ms` }}>
            <DailyCard info={d} status={statuses[d.id]} t={t} />
          </li>
        ))}
      </ul>
      <ul className="kit-card divide-y divide-surface-line px-3.5 lg:hidden" data-testid="home-today-rows">
        {DAILIES.map((d, i) => (
          <li key={d.id} className="motion-safe:animate-rise" style={{ animationDelay: `${80 + i * 60}ms` }}>
            <DailyRow info={d} status={statuses[d.id]} t={t} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the card says under the game's name: today's result, "In progress", or the game's line. */
function subline(info: DailyInfo, status: DailyStatus, t: T): string {
  if (status.state === "done") return status.result ?? t("today.done");
  if (status.state === "progress") return t("today.inProgress");
  return t(`games.${info.id}.line`);
}

function PlayPill({ info, status, className, t }: { info: DailyInfo; status: DailyStatus; className?: string; t: T }) {
  if (status.state === "done") {
    return (
      <span className={cn("inline-flex h-8 items-center gap-1 text-sm font-semibold text-success", className)}>
        <Check className="h-4 w-4" aria-hidden /> {t("today.done")}
      </span>
    );
  }
  return (
    <span className={buttonVariants({ variant: "secondary", size: "sm", className: cn("gap-1.5 pr-2.5", className) })}>
      <span className="kit-ink">{status.state === "progress" ? t("today.continue") : t("today.play")}</span>
      <ChevronRight className="kit-ink h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
    </span>
  );
}

function DailyRow({ info, status, t }: { info: DailyInfo; status: DailyStatus; t: T }) {
  const Icon = info.icon;
  const done = status.state === "done";
  return (
    <Link href={done ? info.doneHref : info.href} className="group flex min-h-[68px] items-center gap-3.5 py-3 active:opacity-70" style={accentStyle(info.accent)} data-testid={`home-today-${info.id}`} data-state={status.state}>
      <IconWell>
        <Icon aria-hidden />
      </IconWell>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-base font-bold uppercase italic leading-tight tracking-wide">{t(`games.${info.id}.name`)}</span>
        <span className={cn("mt-0.5 line-clamp-2 text-sm", done ? "text-success" : status.state === "progress" ? "text-warning" : "text-muted-foreground")}>{subline(info, status, t)}</span>
      </span>
      <PlayPill info={info} status={status} className="shrink-0" t={t} />
    </Link>
  );
}

function DailyCard({ info, status, t }: { info: DailyInfo; status: DailyStatus; t: T }) {
  const Icon = info.icon;
  const done = status.state === "done";
  return (
    <Link
      href={done ? info.doneHref : info.href}
      className={cn(cardVariants({ variant: "base", interactive: true }), "group flex h-full min-h-[220px] flex-col overflow-hidden p-5")}
      style={accentStyle(done ? "154 68% 46%" : info.accent)}
      data-testid={`home-today-card-${info.id}`}
      data-state={status.state}
    >
      {/* The game's icon, big and faint, in the corner (the card lights its corner in the game's colour); it wakes up on hover. */}
      <Icon
        className="absolute -bottom-3 -right-3 -z-10 h-28 w-28 -rotate-12 opacity-[0.1] transition-[transform,opacity] duration-500 group-hover:-rotate-3 group-hover:scale-110 group-hover:opacity-[0.16] motion-reduce:transition-none"
        strokeWidth={1.25}
        style={{ color: `hsl(${info.accent})` }}
        aria-hidden
      />
      <IconWell style={accentStyle(info.accent)}>
        <Icon aria-hidden />
      </IconWell>
      <span className="mt-3.5 font-display text-[15px] font-bold uppercase italic leading-tight tracking-wide xl:text-base">{t(`games.${info.id}.name`)}</span>
      <span className={cn("mt-1 line-clamp-2 min-h-[2.5rem] text-[13px] leading-snug", done ? "font-medium text-success" : status.state === "progress" ? "text-warning" : "text-muted-foreground")}>
        {subline(info, status, t)}
      </span>
      <span className="mt-auto flex items-center justify-between pt-3">
        <PlayPill info={info} status={status} t={t} />
      </span>
    </Link>
  );
}
