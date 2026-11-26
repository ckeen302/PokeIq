"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Check, Gem, RotateCw, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { spriteUrl } from "@/lib/pokemon/art";
import { RARITY_EMOJI, type RarityLetter } from "@/lib/pikadoku/share";
import type { PdkRecord } from "@/lib/pikadoku/play";
import type { PdkGridView, PdkReveal } from "@/lib/pikadoku/types";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import pikadoku from "@/messages/pikadoku";
import board from "@/messages/pikadoku-board";
import { useCatLabel, usePdkLocal } from "./parts";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";

/** Pikadoku's end-of-game pieces: the next-puzzle countdown, the share-card preview, the answers reveal and the guess toast. */

/** "Next Pikadoku in 04:12:09": the shared next-daily countdown (to the player's local midnight), as on the other dailies. */
export function NextPuzzleCountdown({ className }: { className?: string }) {
  const t = useT(pikadoku);
  return (
    <div className={className} data-testid="pdk-countdown">
      <NextDailyCountdown label={t("nextIn")} />
    </div>
  );
}

/** The colours the share text will carry, with what each means. */
export function RarityPreview({ grid }: { grid: string }) {
  const t = useT(pikadoku);
  const letters = [...grid] as RarityLetter[];
  const used = (["p", "b", "g", "y", "x"] as RarityLetter[]).filter((l) => letters.includes(l));
  return (
    <div className="flex flex-col items-center gap-2" data-testid="pdk-rarity-preview">
      <div className="grid grid-cols-3 gap-1 text-2xl leading-none" aria-hidden>
        {letters.map((l, i) => (
          <span key={i}>{RARITY_EMOJI[l]}</span>
        ))}
      </div>
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {used.map((l) => (
          <li key={l}>
            {RARITY_EMOJI[l]} {t(`rarity.${l}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SHOWN = 12;

/**
 * The rarest answer a cell had, from the day's recorded picks: only when
 * there is real data for the cell (rarity off or a game with no records shows
 * nothing). Answers arrive rarest first.
 */
function RarestLine({ answers, mine, cell, nameOf }: { answers: PdkReveal["cells"][number]["answers"]; mine: number | null; cell: number; nameOf: (a: { id: number; name: string }) => string }) {
  const t = useT(pikadoku);
  const top = answers[0];
  if (!top || top.pct === null || answers.every((a) => !a.pct)) return null;
  const unpicked = answers.filter((a) => a.pct === 0).length;
  const yours = mine !== null && (mine === top.id || (top.pct === 0 && answers.find((a) => a.id === mine)?.pct === 0));
  return (
    <p className="mb-2 flex items-start gap-1.5 text-xs" data-testid={`pdk-rarest-${cell}`}>
      <Gem className="mt-px h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
      <span className="min-w-0">
        {yours ? (
          <b>{t("rarest.yours")}</b>
        ) : (
          <>
            {t.rich("rarest.possible", { name: nameOf(top), b: (c) => <b>{c}</b> })}{" "}
            <span className="tabular-nums text-muted-foreground">
              {top.pct === 0 ? (unpicked > 1 ? t("rarest.nobodyMore", { n: unpicked - 1 }) : t("rarest.nobody")) : t("rarest.pct", { pct: top.pct })}
            </span>
          </>
        )}
      </span>
    </p>
  );
}

/** Every valid answer per cell, rarest first when the stats are on, your pick marked; misses explained. */
export function RevealGrid({ reveal, grid, locked }: { reveal: PdkReveal; grid: PdkGridView | null; locked: Record<number, { id: number; pct: number | null } | undefined> }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const t = useT(pikadoku);
  const tb = useT(board);
  const local = usePdkLocal();
  const labelOf = useCatLabel();
  /** A Pokémon's name as the page shows it (the API sends English). */
  const nameOf = (a: { id: number; name: string }) => local?.names[a.id]?.[0] ?? a.name;
  /** Why a miss didn't fit, in the page's language: the server's reason quotes the English labels that failed. */
  const reason = (m: PdkReveal["misses"][number]) => {
    if (!local || !grid) return m.reason;
    const failed = [grid.rows[Math.floor(m.cell / 3)], grid.cols[m.cell % 3]].filter((c) => m.reason.includes(`"${c.label}"`)).map((c) => t("reveal.missCat", { label: labelOf(c) }));
    if (!failed.length) return m.reason;
    return t("reveal.miss", { name: nameOf(m), cats: failed.length > 1 ? t("reveal.missOr", { a: failed[0], b: failed[1] }) : failed[0] });
  };
  return (
    <section className="space-y-3" aria-label={t("reveal.label")} data-testid="pdk-reveal">
      <div>
        <h2 className="font-display text-xl font-bold uppercase">{t("reveal.title")}</h2>
        <p className="text-xs text-muted-foreground">{reveal.cells.some((c) => c.answers.some((a) => a.pct !== null)) ? t("reveal.introRare") : t("reveal.intro")}</p>
      </div>
      {reveal.misses.length > 0 && (
        <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="pdk-misses">
          {reveal.misses.map((m, i) => (
            <li key={i} className="flex items-start gap-2">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <span>{reason(m)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {reveal.cells.map((c, i) => {
          const mine = locked[i];
          const all = open.has(i);
          const answers = all ? c.answers : c.answers.slice(0, SHOWN);
          const mineAnswer = mine ? c.answers.find((a) => a.id === mine.id) : undefined;
          return (
            <div key={i} className="min-w-0 rounded-md border border-foreground/10 bg-card p-3" data-testid={`pdk-reveal-${i}`}>
              <p className="text-xs font-bold uppercase tracking-wide">
                {grid ? tb("board.cross", { row: labelOf(grid.rows[Math.floor(i / 3)]), col: labelOf(grid.cols[i % 3]) }) : " × "}
              </p>
              <p className="mb-2 text-xs text-muted-foreground">{t("reveal.valid", { total: c.total })}</p>
              {mine ? (
                <p className="mb-2 flex items-center gap-2 rounded border border-success/50 bg-success/10 px-2 py-1 text-sm font-semibold">
                  <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
                  <Image src={spriteUrl(mine.id)} alt="" width={28} height={28} unoptimized className="h-7 w-7 shrink-0" style={{ imageRendering: "pixelated" }} />
                  <span className="min-w-0 truncate">{mineAnswer ? nameOf(mineAnswer) : `#${mine.id}`}</span>
                  {mine.pct !== null && <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{mine.pct}%</span>}
                </p>
              ) : (
                <p className="mb-2 rounded border border-dashed border-foreground/20 px-2 py-1 text-sm text-muted-foreground">{t("reveal.notFilled")}</p>
              )}
              <RarestLine answers={c.answers} mine={mine?.id ?? null} cell={i} nameOf={nameOf} />
              <ul className="flex flex-wrap gap-1 text-xs">
                {answers.map((a) => (
                  <li key={a.id} className={cn("rounded border px-1.5 py-0.5", mine?.id === a.id ? "border-primary bg-primary/15 font-bold" : "border-foreground/15")}>
                    {nameOf(a)}
                    {!!a.pct && <span className="ml-1 tabular-nums text-muted-foreground">{a.pct}%</span>}
                  </li>
                ))}
              </ul>
              {c.answers.length > SHOWN && (
                <button type="button" onClick={() => setOpen((s) => new Set(s).add(i))} hidden={all} className="mt-1.5 text-xs font-semibold text-screen hover:underline">
                  {t("reveal.showAll", { total: c.total })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A guess's verdict, floating above the bottom bar so it is seen wherever the page is scrolled. Never moves the layout. */
export function GuessToast({ toast }: { toast: { text: string; kind: "hit" | "miss" | "info" } | null }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 sm:bottom-10" aria-live="polite">
      {toast && (
        <p
          role="status"
          data-testid="pdk-toast"
          className={cn(
            "flex max-w-md items-center gap-2 rounded-lg border-2 bg-card px-4 py-2.5 text-sm font-semibold shadow-xl",
            toast.kind === "hit" ? "border-success/70" : toast.kind === "miss" ? "border-destructive/70" : "border-warning/70"
          )}
        >
          {toast.kind === "hit" ? <Check className="h-4 w-4 shrink-0 text-success" aria-hidden /> : toast.kind === "miss" ? <X className="h-4 w-4 shrink-0 text-destructive" aria-hidden /> : null}
          {toast.text}
        </p>
      )}
    </div>
  );
}

/** PP as pips: one per guess, filled while unspent. */
export function PpPips({ left, total }: { left: number; total: number }) {
  return (
    <span className="mt-0.5 flex justify-center gap-0.5" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i < left ? (left <= 2 ? "bg-destructive" : "bg-primary") : "bg-foreground/15")} />
      ))}
    </span>
  );
}

/** Whether the browser says it is online (true until mounted, so the HTML never shows the banner). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine !== false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

/** Offline, a failed load (with a retry) and a new daily that arrived while this one was open. */
export function PdkStatusBanners({ offline, newPuzzle, onNewPuzzle, failed, onRetry }: { offline: boolean; newPuzzle: boolean; onNewPuzzle: () => void; failed: string | null; onRetry: () => void }) {
  const t = useT(pikadoku);
  return (
    <>
      {offline && (
        <p role="status" data-testid="pdk-offline" className="mx-auto flex max-w-md items-center justify-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-center text-sm font-semibold">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden /> {t("banner.offline")}
        </p>
      )}
      {newPuzzle && (
        <div role="status" data-testid="pdk-new-puzzle" className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-md border border-screen/40 bg-screen/[0.06] px-3 py-2 text-sm">
          <span className="font-semibold">{t("banner.newPuzzle")}</span>
          <Button type="button" size="sm" onClick={onNewPuzzle} data-testid="pdk-new-puzzle-btn">
            {t("banner.playIt")}
          </Button>
        </div>
      )}
      {failed && (
        <div role="alert" data-testid="pdk-load-error" className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-center text-sm">
          <span>{failed}</span>
          <Button type="button" size="sm" variant="outline" onClick={onRetry} data-testid="pdk-retry">
            <RotateCw className="h-4 w-4" aria-hidden /> {t("banner.retry")}
          </Button>
        </div>
      )}
    </>
  );
}

const average = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/**
 * Your dailies at a glance: the streak, your best (lowest) rarity score and
 * today's score against your average. Scores are the server's, from this
 * device's finished dailies; with no scored games yet those tiles stay blank.
 */
export function PdkDailyStatsCard({ streak, best, results, todayKey }: { streak: number; best: number; results: Readonly<Record<string, PdkRecord>>; todayKey: string | null }) {
  const t = useT(pikadoku);
  const done = Object.entries(results).filter(([, r]) => r.over);
  if (!done.length) return null;
  const scored = (list: [string, PdkRecord][]) => list.map(([, r]) => r.score).filter((x): x is number => typeof x === "number");
  const allScores = scored(done);
  const today = todayKey ? results[todayKey] : undefined;
  const todayScore = today?.over && typeof today.score === "number" ? today.score : null;
  const avg = average(scored(done.filter(([k]) => k !== todayKey)));
  const bestScore = allScores.length ? Math.min(...allScores) : null;
  const diff = todayScore !== null && avg !== null ? todayScore - avg : null;
  const todayNote = diff === null ? (avg === null ? t("card.noAverage") : t("card.average", { avg })) : diff === 0 ? t("card.level", { avg: avg! }) : t(diff < 0 ? "card.rarer" : "card.commoner", { diff: Math.abs(diff), avg: avg! });
  const tile = (label: string, value: string | number, testId: string, note: string) => (
    <div className="min-w-0 rounded-md border border-foreground/10 px-2 py-2 text-center" data-testid={testId}>
      <p className="hud-label truncate">{label}</p>
      <p className="font-display text-xl font-bold tabular-nums leading-tight sm:text-2xl">{value}</p>
      <p className="text-[11px] leading-tight text-muted-foreground">{note}</p>
    </div>
  );
  return (
    <section className="rounded-md border border-foreground/15 bg-card p-3" aria-label={t("card.label")} data-testid="pdk-stats-card">
      <p className="hud-label mb-2 text-center">{t("card.title")}</p>
      <div className="grid grid-cols-3 gap-2">
        {tile(t("card.streak"), streak, "pdk-sc-streak", t("card.best", { best }))}
        {tile(t("card.bestRarity"), bestScore ?? "–", "pdk-sc-best", t("card.lower"))}
        {tile(t("card.today"), todayScore ?? (today?.over ? `${today.solved}/9` : "–"), "pdk-sc-today", todayNote)}
      </div>
    </section>
  );
}
