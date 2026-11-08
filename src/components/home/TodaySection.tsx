"use client";

import Link from "@/components/ui/Link";
import { Check, ChevronRight } from "lucide-react";
import { TimeToNextDaily } from "@/components/NextDailyCountdown";
import { useProgress } from "@/lib/progress";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import { HomeHeading } from "./HomeHeading";
import { DAILIES, allDone, bestStreak, dailyStatuses, streakText, type DailyInfo, type DailyStatus } from "./today";

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
  const statuses = dailyStatuses(progress, today);
  const streak = bestStreak(statuses);
  const finished = progress && today ? allDone(statuses) : false;

  const line = finished ? (
    <span data-testid="home-today-alldone">
      <span className="font-semibold text-success">All done for today</span> · new puzzles in <TimeToNextDaily className="font-semibold tabular-nums text-foreground" />
    </span>
  ) : streak ? (
    <span data-testid="home-today-streak">
      <span aria-hidden>🔥 </span>
      <span className="font-semibold text-foreground">{streakText(streak)}</span>
      {streak.atRisk && <span className="max-sm:hidden"> · play today&apos;s to keep it</span>}
    </span>
  ) : (
    <span>New puzzles every day at midnight</span>
  );

  return (
    <section aria-labelledby="home-today" data-testid="home-today" className="scroll-mt-20">
      <HomeHeading id="home-today" title="Today" aside={<span className="text-sm text-muted-foreground">{line}</span>} />
      <ul className="grid grid-cols-5 gap-3 max-lg:hidden" data-testid="home-today-cards">
        {DAILIES.map((d) => (
          <li key={d.id}>
            <DailyCard info={d} status={statuses[d.id]} />
          </li>
        ))}
      </ul>
      <ul className="divide-y divide-foreground/[0.06] lg:hidden" data-testid="home-today-rows">
        {DAILIES.map((d) => (
          <li key={d.id}>
            <DailyRow info={d} status={statuses[d.id]} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the card says under the game's name: today's result, "In progress", or the game's line. */
function subline(info: DailyInfo, status: DailyStatus): string {
  if (status.state === "done") return status.result ?? "Done";
  if (status.state === "progress") return "In progress";
  return info.line;
}

function PlayPill({ info, status, className }: { info: DailyInfo; status: DailyStatus; className?: string }) {
  if (status.state === "done") {
    return (
      <span className={cn("inline-flex h-8 items-center gap-1 text-sm font-semibold text-success", className)}>
        <Check className="h-4 w-4" aria-hidden /> Done
      </span>
    );
  }
  return (
    <span className={cn("inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold text-black", className)} style={{ background: `hsl(${info.accent})` }}>
      {status.state === "progress" ? "Continue" : "Play"}
    </span>
  );
}

function DailyRow({ info, status }: { info: DailyInfo; status: DailyStatus }) {
  const Icon = info.icon;
  const done = status.state === "done";
  return (
    <Link href={done ? info.doneHref : info.href} className="flex min-h-[68px] items-center gap-3.5 py-3 active:opacity-70" data-testid={`home-today-${info.id}`} data-state={status.state}>
      <span className="screen flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ color: `hsl(${info.accent})` }}>
        <Icon className="relative z-[3] h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold leading-tight">{info.name}</span>
        <span className={cn("mt-0.5 block truncate text-sm", done ? "text-success" : status.state === "progress" ? "text-warning" : "text-muted-foreground")}>{subline(info, status)}</span>
      </span>
      <PlayPill info={info} status={status} className="shrink-0" />
    </Link>
  );
}

function DailyCard({ info, status }: { info: DailyInfo; status: DailyStatus }) {
  const Icon = info.icon;
  const done = status.state === "done";
  return (
    <Link
      href={done ? info.doneHref : info.href}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden min-h-[232px] rounded-lg border bg-card p-5 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[hsl(var(--accent-c)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        done && "border-success/30"
      )}
      style={{ "--accent-c": info.accent } as React.CSSProperties}
      data-testid={`home-today-card-${info.id}`}
      data-state={status.state}
    >
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `hsl(${info.accent})`, boxShadow: `0 0 12px hsl(${info.accent} / 0.8)` }} aria-hidden />
      <span className="screen flex h-10 w-10 items-center justify-center rounded-md" style={{ color: `hsl(${info.accent})` }}>
        <Icon className="relative z-[3] h-5 w-5" aria-hidden />
      </span>
      <span className="mt-3 font-display text-[15px] font-bold uppercase leading-tight tracking-wide xl:text-base">{info.name}</span>
      <span className={cn("mt-1 line-clamp-2 min-h-[2.5rem] text-[13px] leading-snug", done ? "font-medium text-success" : status.state === "progress" ? "text-warning" : "text-muted-foreground")}>
        {subline(info, status)}
      </span>
      <span className="mt-auto flex items-center justify-between pt-3">
        <PlayPill info={info} status={status} className={done ? undefined : "h-8 px-3.5"} />
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
      </span>
    </Link>
  );
}
