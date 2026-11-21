"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DLE_FREEZE_EVERY, DLE_MAX_FREEZES, type DleStats } from "@/lib/dle-stats";
import { CONN_LAUNCH_DATE, CONN_MAX_MISTAKES, connNumber } from "@/lib/connections/types";
import type { ConnRecord } from "@/lib/progress";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/catalog";
import cs from "@/messages/connections-stats";

/** PokéConnections' stats (the sheet and the results-screen card) and the archive calendar. */

/** Played, win %, streaks and the mistakes distribution, from the daily results (lib/connections/local connStats). */
export function ConnStatsBody({ stats, todayMistakes, compact }: { stats: DleStats; todayMistakes: number | null; compact?: boolean }) {
  const tr = useT(cs);
  const tiles = [
    { label: tr("played"), value: stats.played },
    { label: tr("winPct"), value: stats.winPct },
    { label: tr("current"), value: `🔥${stats.playStreak}` },
    { label: tr("max"), value: stats.bestPlayStreak },
  ];
  const bars = [...stats.distribution.map((n, i) => ({ label: String(i), n, today: todayMistakes === i })), { label: "X", n: stats.losses, today: todayMistakes === CONN_MAX_MISTAKES }];
  const peak = Math.max(1, ...bars.map((b) => b.n));
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-4 gap-2 text-center">
        {tiles.map((t) => (
          <div key={t.label}>
            <div className="font-display text-2xl font-bold tabular-nums">{t.value}</div>
            <div className="text-[11px] leading-tight text-muted-foreground">{t.label}</div>
          </div>
        ))}
      </div>
      {!compact && (
        <p className="rounded-md border bg-shade/30 px-3 py-2">
          {tr.rich("freezes", { freezes: stats.freezes, max: DLE_MAX_FREEZES, every: DLE_FREEZE_EVERY, win: stats.winStreak, best: stats.bestWinStreak, b: (c) => <b>{c}</b> })}
        </p>
      )}
      <div>
        <p className="hud-label mb-2">{tr("distribution")}</p>
        <div className="space-y-1" role="list" aria-label={tr("distributionAria")}>
          {bars.map((b) => (
            <div key={b.label} className="flex items-center gap-2" role="listitem" aria-label={b.label === "X" ? tr("barLost", { count: b.n }) : tr("barAria", { n: Number(b.label), count: b.n })}>
              <span className="w-3 text-right font-semibold tabular-nums">{b.label}</span>
              <div
                className={cn("flex h-5 min-w-[1.5rem] items-center justify-end rounded-sm px-1.5 text-[11px] font-semibold", b.today ? "bg-screen text-background" : "bg-secondary")}
                style={{ width: `${Math.max(6, (100 * b.n) / peak)}%` }}
              >
                {b.n}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The stats on the results screen. */
export function ConnStatsCard({ stats, todayMistakes }: { stats: DleStats; todayMistakes: number | null }) {
  const tr = useT(cs);
  return (
    <section aria-labelledby="conn-stats-title" className="mx-auto max-w-md space-y-3 rounded-lg border bg-card p-5" data-testid="conn-stats-card">
      <h2 id="conn-stats-title" className="hud-label">
        {tr("cardTitle")}
      </h2>
      <ConnStatsBody stats={stats} todayMistakes={todayMistakes} compact />
      <p className="text-[11px] text-muted-foreground">{tr("onlyDailies")}</p>
    </section>
  );
}

type DayStatus = "perfect" | "solved" | "missed" | "progress" | "none";

const STATUS: Record<DayStatus, { cell: string }> = {
  perfect: { cell: "border-success bg-success text-background" },
  solved: { cell: "border-success/60 bg-success/25" },
  missed: { cell: "border-destructive/60 bg-destructive/20" },
  progress: { cell: "border-warning/60 bg-warning/15" },
  none: { cell: "border-foreground/10 bg-shade/20" },
};

const statusOf = (r: ConnRecord | undefined): DayStatus => (!r ? "none" : r.over ? (r.solved ? (r.mistakes ? "solved" : "perfect") : "missed") : r.guesses.length ? "progress" : "none");

/** "January 2026" and the weekdays' initials, Monday first, as the page's language writes them (en-US: as before). */
const monthTitle = (locale: string, y: number, m: number) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m, 1));
const weekdays = (locale: string) => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(Date.UTC(2024, 0, 1 + i)));
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Every daily since launch as a month calendar, coloured by how it went
 * (the daily itself, else an archive replay). Past days open in the
 * archive; today goes back to the daily.
 */
export function ConnArchiveCalendar({
  today,
  daily,
  archive,
  onPlay,
  onToday,
}: {
  today: string;
  daily: Readonly<Record<string, ConnRecord>>;
  archive: Readonly<Record<string, ConnRecord>>;
  onPlay: (date: string) => void;
  onToday: () => void;
}) {
  const tr = useT(cs);
  const intl = INTL_LOCALE[tr.locale];
  const [ty, tm] = today.split("-").map(Number);
  const [ly, lm] = CONN_LAUNCH_DATE.split("-").map(Number);
  const [month, setMonth] = useState({ y: ty, m: tm - 1 });
  const first = month.y === ly && month.m === lm - 1;
  const last = month.y === ty && month.m === tm - 1;
  const step = (k: number) => setMonth(({ y, m }) => ({ y: y + Math.floor((m + k) / 12), m: (((m + k) % 12) + 12) % 12 }));
  const days = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  // Monday first.
  const lead = (new Date(Date.UTC(month.y, month.m, 1)).getUTCDay() + 6) % 7;
  const counts: Record<DayStatus, number> = { perfect: 0, solved: 0, missed: 0, progress: 0, none: 0 };
  const cells = Array.from({ length: days }, (_, i) => {
    const date = iso(month.y, month.m, i + 1);
    const playable = date >= CONN_LAUNCH_DATE && date <= today;
    const own = daily[date];
    const status = playable ? statusOf(own?.over || own?.guesses.length ? own : archive[date]) : "none";
    if (playable && date < today) counts[status]++;
    return { date, day: i + 1, playable, status, fromArchive: !(own?.over || own?.guesses.length) && !!archive[date] };
  });
  return (
    <div className="space-y-3" data-testid="conn-calendar">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => step(-1)} disabled={first} aria-label={tr("prev")} className="rounded-md p-1.5 text-muted-foreground hover:bg-screen/10 hover:text-foreground disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="font-display text-base font-bold uppercase tracking-wide" aria-live="polite">
          {monthTitle(intl, month.y, month.m)}
        </p>
        <button type="button" onClick={() => step(1)} disabled={last} aria-label={tr("next")} className="rounded-md p-1.5 text-muted-foreground hover:bg-screen/10 hover:text-foreground disabled:opacity-30">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center sm:gap-1.5" role="grid" aria-label={monthTitle(intl, month.y, month.m)}>
        {weekdays(intl).map((w, i) => (
          <span key={i} className="hud-label pb-0.5" aria-hidden>
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden />
        ))}
        {cells.map((c) =>
          c.playable ? (
            <button
              key={c.date}
              type="button"
              onClick={() => (c.date === today ? onToday() : onPlay(c.date))}
              aria-label={`${tr("day", { n: connNumber(c.date), date: c.date, status: tr(`status.${c.status}`) })}${c.fromArchive ? tr("fromArchive") : ""}${c.date === today ? tr("today") : ""}`}
              data-date={c.date}
              data-status={c.status}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center rounded-md border text-sm font-semibold tabular-nums transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                STATUS[c.status].cell,
                c.date === today && "ring-2 ring-primary ring-offset-1 ring-offset-background"
              )}
            >
              {c.day}
              <span className="text-[9px] font-normal leading-none opacity-70">#{connNumber(c.date)}</span>
            </button>
          ) : (
            <span key={c.date} className="flex aspect-square items-center justify-center rounded-md text-sm tabular-nums text-muted-foreground/40" aria-hidden>
              {c.day}
            </span>
          )
        )}
      </div>
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label={tr("key")}>
        {(Object.keys(STATUS) as DayStatus[]).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cn("inline-block h-3 w-3 rounded-sm border", STATUS[s].cell)} aria-hidden />
            {tr(`status.${s}`)}
            {s !== "none" && counts[s] > 0 && <b className="text-foreground">{counts[s]}</b>}
          </li>
        ))}
      </ul>
    </div>
  );
}
