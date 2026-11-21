"use client";

import { X } from "lucide-react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { dailyNumber, LAUNCH_DATE, previousDate } from "@/lib/daily";
import { DLE_FREEZE_EVERY, DLE_MAX_FREEZES, type DleResultLike, type DleStats } from "@/lib/dle-stats";
import { DLE_COLUMNS, DLE_GUESS_COST, DLE_HINT_COST, DLE_HINT_EMOJI, DLE_HINT_KINDS, DLE_MAX_GUESSES, DLE_MIN_SOLVE_POINTS, dleBasePoints } from "@/lib/dle-types";
import { DLE_COLUMN_BONUS, DLE_MAX_BONUS, DLE_STRICT_BONUS, dailyRules, rulesBonus } from "@/lib/dle-format";
import { Board } from "./parts";
import { DLE_EXAMPLE_MONS, exampleRow } from "./examples";
import { DLE_ASSISTS, DLE_ASSIST_INFO } from "@/lib/dle-assist";
import { localMultiplier } from "@/lib/dle-i18n";
import { formatNumber } from "@/i18n/catalog";
import { useT } from "@/i18n/client";
import board from "@/messages/pokedle-board";
import game from "@/messages/pokedle-game";
import report from "@/messages/report";
import { useDleWords } from "./lexicon";
import { cn } from "@/lib/utils";
import { FitWidth, HowToActions, HowToCards, HowToDialog } from "@/components/howto/shared";
import { PokedleDemo } from "@/components/howto/PokedleDemo";

/** Pokédle's pop-up sheets: how to play, stats and the archive. */

export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  // The chrome's "Close" (every page in every language has it), so the other games' sheets need nothing more.
  const r = useT(report);
  const closeRef = useDialogFocus(onClose);
  return (
    // Phones: a bottom sheet over the tab bar, scrolling inside itself, its title and close button pinned on top
    // (the sheet has no top padding there: a sticky title would otherwise stop that far down and cover the first line).
    // It fades in from transparent, so a first visit's how-to never counts as the page's largest paint: the board does.
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 max-md:z-[65] max-md:items-end max-md:overflow-hidden max-md:p-0" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn("relative my-8 w-full rounded-lg border-2 sm:my-auto border-foreground/15 bg-card p-5 shadow-2xl max-md:my-0 max-md:max-h-[92dvh] max-md:max-w-none max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:pt-0 max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-md:animate-sheet-in", wide ? "max-w-2xl" : "max-w-md")}
      >
        <div className="mb-4 flex items-center justify-between gap-2 max-md:sticky max-md:top-0 max-md:z-10 max-md:-mx-5 max-md:mt-0 max-md:mb-2 max-md:bg-card max-md:px-5 max-md:pb-2 max-md:pt-4">
          <h2 className="font-display text-xl font-bold uppercase tracking-tight">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={r("close")} className="rounded-md p-1 max-md:-mr-2 max-md:p-2.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Pikachu guessed when the answer is Raichu. */
const EXAMPLE = exampleRow(DLE_EXAMPLE_MONS.pikachu, DLE_EXAMPLE_MONS.raichu, DLE_COLUMNS.map((c) => c.key));

const B = (c: React.ReactNode[]) => <b>{c}</b>;
const BF = (c: React.ReactNode[]) => <b className="text-foreground">{c}</b>;

export function HowToSheet({ onClose, onNever }: { onClose: () => void; onNever?: () => void }) {
  const t = useT(game);
  const bt = useT(board);
  const words = useDleWords();
  const first = formatNumber(dleBasePoints(1), t.locale);
  const hintWord = { genus: t("howto.hintGenus"), silhouette: t("howto.hintSilhouette") };
  return (
    <HowToDialog onClose={onClose} testId="howto-sheet" footer={<HowToActions onClose={onClose} onNever={onNever} />}>
      <PokedleDemo />
      <HowToCards
        cards={[
          { title: t("howto.goal"), body: <p>{t("howto.goalBody", { n: DLE_MAX_GUESSES })}</p> },
          { title: t("howto.core"), body: <p>{t("howto.coreBody")}</p> },
          {
            title: t("howto.scoring"),
            body: <p>{t("howto.scoringBody", { first, cost: DLE_GUESS_COST, min: DLE_MIN_SOLVE_POINTS })}</p>,
          },
          { title: t("howto.hints"), body: <p>{t("howto.hintsBody")}</p> },
        ]}
      />
      <details className="rounded-md border bg-shade/30 p-3">
        <summary className="tap cursor-pointer font-semibold max-sm:py-2.5">{t("howto.full")}</summary>
      <div className="mt-3 space-y-4">
      <p>
        {t("howto.example", {
          n: DLE_MAX_GUESSES,
          guess: words.name(DLE_EXAMPLE_MONS.pikachu.id, DLE_EXAMPLE_MONS.pikachu.name),
          answer: words.name(DLE_EXAMPLE_MONS.raichu.id, DLE_EXAMPLE_MONS.raichu.name),
        })}
      </p>
      <FitWidth>
        <Board rows={[EXAMPLE]} flipNewest={false} />
      </FitWidth>
      <ul className="space-y-1.5">
        <li>{t.rich("howto.match", { b: B })}</li>
        <li>{t.rich("howto.near", { b: B })}</li>
        <li>{t.rich("howto.higher", { b: B })}</li>
        <li>{t.rich("howto.miss", { b: B })}</li>
      </ul>
      <div className="space-y-1.5 rounded-md border bg-shade/30 p-3">
        <p className="font-semibold">{t("howto.formats")}</p>
        <ul className="space-y-1">
          <li>{t.rich("howto.classic", { b: B })}</li>
          <li>{t.rich("howto.squirdle", { b: B })}</li>
          <li>{t.rich("howto.custom", { b: B })}</li>
        </ul>
        <p>{t("howto.dailyFormats")}</p>
      </div>
      <div className="space-y-1.5 rounded-md border bg-shade/30 p-3">
        <p className="font-semibold">{t("howto.points")}</p>
        <p>{t("howto.pointsBody", { first, cost: DLE_GUESS_COST, min: DLE_MIN_SOLVE_POINTS, last: dleBasePoints(DLE_MAX_GUESSES) })}</p>
        <p data-testid="bonus-rule">
          {t("howto.bonus", {
            column: Math.round(DLE_COLUMN_BONUS * 100),
            strict: Math.round(DLE_STRICT_BONUS * 100),
            max: Math.round(DLE_MAX_BONUS * 100),
            stats: Math.round(rulesBonus(dailyRules("squirdle")) * 100),
          })}
        </p>
        <p>{t("howto.hintList", { list: DLE_HINT_KINDS.map((h) => `${DLE_HINT_EMOJI[h]} ${hintWord[h]} −${DLE_HINT_COST[h]}`).join(", ") })}</p>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>{t.rich("howto.dex", { b: BF, i: (c) => <i>{c}</i> })}</li>
        <li>
          {t.rich("howto.dexSetting", { b: BF })}
          <ul className="mt-1 space-y-0.5 pl-1">
            {DLE_ASSISTS.map((a) => (
              <li key={a}>{t.rich("howto.dexLevel", { emoji: DLE_ASSIST_INFO[a].emoji, label: bt(`assist.${a}.label`), m: localMultiplier(a, bt), blurb: bt(`assist.${a}.blurb`), b: BF })}</li>
            ))}
          </ul>
          {t("howto.dexAfter")}
        </li>
        <li>{t.rich("howto.hard", { b: BF })}</li>
        <li>{t.rich("howto.streaks", { b: BF, every: DLE_FREEZE_EVERY, max: DLE_MAX_FREEZES })}</li>
        <li>{t.rich("howto.archive", { b: BF })}</li>
        <li>{t.rich("howto.keys", { k: (c) => <kbd className="rounded border px-1">{c}</kbd> })}</li>
      </ul>
      </div>
      </details>
    </HowToDialog>
  );
}

export function StatsSheet({
  stats,
  todayGuesses,
  onClose,
  title,
  footer,
}: {
  stats: DleStats;
  todayGuesses: number | null;
  onClose: () => void;
  title?: string;
  /** Today's daily is done: its share button and the countdown to the next one. */
  footer?: React.ReactNode;
}) {
  const t = useT(game);
  const tiles = [
    { label: t("stats.played"), value: stats.played },
    { label: t("stats.winPct"), value: stats.winPct },
    { label: t("stats.playStreak"), value: `🔥${stats.playStreak}`, sub: t("stats.best", { n: stats.bestPlayStreak }) },
    { label: t("stats.winStreak"), value: stats.winStreak, sub: t("stats.best", { n: stats.bestWinStreak }) },
  ];
  const bars = [...stats.distribution.map((n, i) => ({ label: String(i + 1), n, today: todayGuesses === i + 1 })), { label: "X", n: stats.losses, today: todayGuesses === 0 }];
  const peak = Math.max(1, ...bars.map((b) => b.n));
  return (
    <Sheet title={title ?? t("stats.title")} onClose={onClose}>
      <div className="space-y-5 text-sm">
        <div className="grid grid-cols-4 gap-2 text-center">
          {tiles.map((t) => (
            <div key={t.label}>
              <div className="font-display text-2xl font-bold tabular-nums">{t.value}</div>
              <div className="text-[11px] text-muted-foreground">{t.label}</div>
              {t.sub && <div className="text-[10px] text-muted-foreground">{t.sub}</div>}
            </div>
          ))}
        </div>
        <p className="rounded-md border bg-shade/30 px-3 py-2">
          {t.rich("stats.freezes", { n: stats.freezes, max: DLE_MAX_FREEZES, every: DLE_FREEZE_EVERY, b: B })}
          {stats.savedByFreeze && stats.playStreak > 0 && (
            <span className="block text-success">{t("stats.saved", { n: stats.playStreak })}</span>
          )}
        </p>
        <div>
          <p className="hud-label mb-2">{t("stats.distribution")}</p>
          <div className="space-y-1" role="list" aria-label={t("stats.distributionLabel")}>
            {bars.map((b) => (
              <div
                key={b.label}
                className="flex items-center gap-2"
                role="listitem"
                aria-label={b.label === "X" ? t("stats.missed", { count: b.n }) : t("stats.bar", { n: Number(b.label), count: b.n })}
              >
                <span className="w-3 text-right font-semibold tabular-nums">{b.label}</span>
                <div
                  className={cn("flex h-5 min-w-[1.5rem] items-center justify-end rounded-sm px-1.5 text-[11px] font-semibold", b.today ? "dle-match" : "bg-secondary")}
                  style={{ width: `${Math.max(6, (100 * b.n) / peak)}%` }}
                >
                  {b.n}
                </div>
              </div>
            ))}
          </div>
        </div>
        {stats.hardWins > 0 && <p className="text-muted-foreground">{t("stats.hardWins", { n: stats.hardWins })}</p>}
        <p className="text-xs text-muted-foreground">{t("stats.only")}</p>
        {footer && <div className="space-y-3 border-t pt-4">{footer}</div>}
      </div>
    </Sheet>
  );
}

/** Every past daily, newest first, with how it went. */
export function ArchiveSheet({
  today,
  daily,
  archive,
  onPlay,
  onClose,
}: {
  today: string;
  daily: Readonly<Record<string, DleResultLike>>;
  archive: Readonly<Record<string, DleResultLike>>;
  onPlay: (date: string) => void;
  onClose: () => void;
}) {
  const t = useT(game);
  const dates: string[] = [];
  for (let d = previousDate(today); d >= LAUNCH_DATE; d = previousDate(d)) dates.push(d);
  const status = (r: DleResultLike | undefined) =>
    !r
      ? t("archive.notPlayed")
      : r.over
        ? r.solved
          ? t("archive.solvedIn", { n: r.guesses.length })
          : t("archive.missed")
        : r.guesses.length
          ? t("archive.inProgress", { n: r.guesses.length, max: DLE_MAX_GUESSES })
          : t("archive.notPlayed");
  return (
    <Sheet title={t("archive.title")} onClose={onClose}>
      <p className="mb-3 text-sm text-muted-foreground">{t("archive.intro")}</p>
      {dates.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("archive.empty")}</p>
      ) : (
        <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
          {dates.map((d) => {
            const played = daily[d]?.over ? daily[d] : undefined;
            return (
              <li key={d}>
                <button
                  type="button"
                  onClick={() => onPlay(d)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-screen/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-semibold">
                    #{dailyNumber(d)} <span className="font-normal text-muted-foreground">· {d}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{played ? t("archive.daily", { status: status(played) }) : status(archive[d])}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
