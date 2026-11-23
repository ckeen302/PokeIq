"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, RotateCcw, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import picker from "@/messages/favorite-picker";
import { artUrl, type ArtStyle } from "@/lib/tier-list/art";
import { bitCount, type CullView, type DuelView, type View } from "@/lib/favorite-picker/run";
import type { Mon } from "@/lib/tier-list/types";
import { IconButton, Modal, PillButton } from "../tier-list/ui";
import { MonArt, type PickerT } from "./common";

/**
 * A run on screen: the steps and the progress, then a narrowing screen (keep the ones you like) or a head-to-head
 * pick. The keyboard works throughout: arrow keys move between cards, Space keeps one, N goes on, ← and → pick a side,
 * Z undoes.
 */

interface Props {
  view: View;
  byKey: ReadonlyMap<string, Mon>;
  art: ArtStyle;
  shiny: boolean;
  /** A heading above the run (a type chart's run names its type). */
  title?: string;
  /** The screen's keeps to start from (after an undo back onto it). */
  prefill: number;
  canUndo: boolean;
  onPick(p: number): void;
  onUndo(): void;
  onQuit(): void;
  /** "Back to the chart", for a type chart's run. */
  back?: { label: string; onClick(): void };
}

/** Ignore keys typed into a field or pressed while a dialog is open. */
function keyTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (e.defaultPrevented || e.altKey || e.metaKey) return false;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return false;
  // An open dialog (the phone's More sheet stays in the page, inert, while closed).
  return !document.querySelector('[role="dialog"]:not([inert])');
}

function preload(urls: string[]) {
  for (const u of urls) {
    const img = new Image();
    img.decoding = "async";
    img.src = u;
  }
}

export function RunView(p: Props) {
  const t = useT(picker);
  const [quit, setQuit] = useState(false);
  const v = p.view;
  const pct = Math.round((v.steps / Math.max(1, v.steps + v.estimate)) * 100);
  const stage = v.phase === "cull" ? 0 : v.phase === "duel" ? 1 : 2;
  const undo = p.onUndo;
  const canUndo = p.canUndo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!keyTarget(e)) return;
      if ((e.key === "z" || e.key === "Z") && canUndo && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, canUndo]);

  return (
    <section className="rounded-[28px] border border-foreground/[0.08] bg-card p-6 shadow-[0_20px_60px_-40px_hsl(var(--shade)/0.6)] max-sm:rounded-[22px] max-sm:p-4" data-testid="fp-run" data-phase={v.phase}>
      {p.title && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-[22px] font-semibold tracking-tight max-sm:text-[19px]">{p.title}</h2>
          {p.back && (
            <PillButton onClick={p.back.onClick} testId="fp-run-back">
              {p.back.label}
            </PillButton>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <ol className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-semibold" aria-label={t("run.steps")}>
          {[t("run.narrow"), t("run.duel"), t("run.result")].map((label, i) => (
            <li key={i} className="flex min-w-0 items-center gap-1.5" aria-current={i === stage ? "step" : undefined}>
              {i > 0 && <span className="h-px w-4 shrink-0 bg-foreground/15 max-sm:w-2" aria-hidden />}
              <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px]", i < stage ? "bg-primary text-primary-foreground" : i === stage ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "bg-foreground/[0.06] text-muted-foreground")} aria-hidden>
                {i < stage ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn("truncate", i === stage ? "text-foreground" : "text-muted-foreground", i !== stage && "max-sm:hidden")}>{label}</span>
            </li>
          ))}
        </ol>
        <IconButton label={t("run.undo")} onClick={p.onUndo} disabled={!p.canUndo} testId="fp-undo">
          <Undo2 className="h-[18px] w-[18px]" aria-hidden />
        </IconButton>
        <IconButton label={t("run.quit")} onClick={() => setQuit(true)} testId="fp-quit">
          <RotateCcw className="h-[17px] w-[17px]" aria-hidden />
        </IconButton>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]" role="progressbar" aria-label={t("run.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>

      {v.phase === "cull" && <Cull key={v.steps} {...p} view={v} t={t} />}
      {v.phase === "duel" && <Duel key={v.steps} {...p} view={v} t={t} />}

      <p className="mt-5 text-center text-[12px] text-muted-foreground max-lg:hidden">{t("run.shortcuts")}</p>
      <p className="mt-1 text-center text-[12px] text-muted-foreground">{t("run.saved")}</p>

      {quit && (
        <Modal title={t("run.quit")} onClose={() => setQuit(false)} closeLabel={t("close")} testId="fp-quit-dialog">
          <p className="text-[15px] text-muted-foreground">{t("run.quitConfirm")}</p>
          <div className="mt-5 flex justify-end gap-2">
            <PillButton onClick={() => setQuit(false)}>{t("run.cancel")}</PillButton>
            <PillButton
              primary
              onClick={() => {
                setQuit(false);
                p.onQuit();
              }}
              testId="fp-quit-yes"
            >
              {t("run.quit")}
            </PillButton>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Cull(p: Props & { view: CullView; t: PickerT }) {
  const { view: v, t } = p;
  const [mask, setMask] = useState(() => (bitCount(p.prefill) <= v.cap && p.prefill < 2 ** v.screen.length ? p.prefill : 0));
  const [full, setFull] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const kept = bitCount(mask);
  const short = Math.max(0, v.min - kept);
  const mons = v.screen.map((k) => p.byKey.get(k)).filter((m): m is Mon => !!m);
  const cols = mons.length <= 9 ? 3 : 4;
  const colsWide = Math.min(8, Math.max(4, Math.ceil(mons.length / 3)));

  // The next screen's pictures load while this one is up.
  const { next } = v;
  const { art, shiny, byKey } = p;
  useEffect(() => {
    if (!next) return;
    const id = setTimeout(() => preload(next.map((k) => byKey.get(k)).filter((m): m is Mon => !!m).map((m) => artUrl(m, art, shiny))), 400);
    return () => clearTimeout(id);
  }, [next, art, shiny, byKey]);

  const toggle = useCallback(
    (j: number) => {
      setMask((m) => {
        if ((m >> j) & 1) {
          setFull(false);
          return m & ~(1 << j);
        }
        if (bitCount(m) >= v.cap) {
          setFull(true);
          return m;
        }
        return m | (1 << j);
      });
    },
    [v.cap]
  );
  const go = useCallback(() => {
    if (bitCount(mask) < v.min) return;
    p.onPick(mask);
  }, [mask, v.min, p]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!keyTarget(e)) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        go();
        return;
      }
      const arrows: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 };
      if (!(e.key in arrows) || !grid.current) return;
      const tiles = [...grid.current.querySelectorAll<HTMLButtonElement>("[data-tile]")];
      const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
      const c = getComputedStyle(grid.current).gridTemplateColumns.split(" ").length || 1;
      const step = Math.abs(arrows[e.key]) === 2 ? Math.sign(arrows[e.key]) * c : arrows[e.key];
      const to = at < 0 ? 0 : Math.min(tiles.length - 1, Math.max(0, at + step));
      e.preventDefault();
      tiles[to]?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div className="mt-5" data-testid="fp-cull" data-round={v.round} data-screen={v.screenIndex}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-display text-[17px] font-semibold">
          {t("cull.round", { n: v.round + 1 })} <span className="text-muted-foreground">·</span> <span className="text-muted-foreground">{t("cull.screen", { i: v.screenIndex + 1, n: v.screens })}</span>
        </p>
        <p className={cn("text-[13px] font-semibold tabular-nums", kept === v.cap ? "text-primary" : "text-muted-foreground")} data-testid="fp-kept">
          {t("cull.kept", { n: kept, cap: v.cap })}
        </p>
      </div>
      <p className="mt-1 text-[14px] text-muted-foreground" aria-live="polite">
        {full ? t("cull.full", { n: v.cap }) : t("cull.keepHint", { n: v.cap })}
      </p>
      <div ref={grid} className="fp-grid mt-4 grid gap-2.5 max-sm:gap-1.5" style={{ "--fp-cols": cols, "--fp-cols-wide": colsWide } as React.CSSProperties}>
        {mons.map((m, j) => {
          const on = !!((mask >> j) & 1);
          return (
            <button
              key={m.k}
              type="button"
              data-tile=""
              aria-pressed={on}
              aria-label={t("cull.keep", { name: m.n })}
              onClick={() => toggle(j)}
              className={cn(
                "fp-tile group relative flex min-w-0 flex-col items-center rounded-2xl border p-1.5 pb-2 text-center max-sm:px-0.5 transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] motion-reduce:transition-none",
                on ? "border-primary/70 bg-primary/[0.12] shadow-[0_10px_30px_-14px_hsl(var(--primary)/0.8)]" : "border-transparent bg-foreground/[0.04] hover:bg-foreground/[0.08]",
                !on && kept >= v.cap && "opacity-60"
              )}
              data-testid="fp-tile"
            >
              <span className="relative block aspect-square w-full">
                <MonArt mon={m} art={p.art} shiny={p.shiny} className="absolute inset-[6%] h-[88%] w-[88%] transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none" eager />
              </span>
              <span className="mt-0.5 block w-full truncate px-0.5 text-[12px] font-semibold leading-tight max-sm:px-0 max-sm:tracking-[-0.02em]" title={m.n}>{m.n}</span>
              {on && (
                <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow" aria-hidden>
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="sticky bottom-[calc(var(--tabbar-h)+12px)] z-10 mt-5 flex flex-wrap items-center justify-end gap-3">
        {short > 0 && <p className="text-[13px] font-medium text-muted-foreground">{t("cull.needMore", { n: short })}</p>}
        <PillButton primary onClick={go} disabled={short > 0} className="h-12 min-w-[180px] px-6 text-[15px] shadow-lg max-md:h-12 max-sm:w-full" testId="fp-next">
          {kept ? t("cull.next") : t("cull.nextNone")} <ArrowRight className="h-4 w-4" aria-hidden />
        </PillButton>
      </div>
    </div>
  );
}

function Duel(p: Props & { view: DuelView; t: PickerT }) {
  const { view: v, t } = p;
  const [chosen, setChosen] = useState<0 | 1 | null>(null);
  const a = p.byKey.get(v.a), b = p.byKey.get(v.b);
  const label = v.label.kind === "round" ? t("duel.roundOf", { n: v.label.n }) : t(`duel.${v.label.kind}`);
  const { onPick } = p;
  const choose = useCallback(
    (side: 0 | 1) => {
      if (chosen !== null) return;
      setChosen(side);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(() => onPick(side), reduce ? 0 : 220);
    },
    [chosen, onPick]
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!keyTarget(e)) return;
      if (e.key === "ArrowLeft" || e.key === "1") {
        e.preventDefault();
        choose(0);
      } else if (e.key === "ArrowRight" || e.key === "2") {
        e.preventDefault();
        choose(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose]);
  if (!a || !b) return null;
  return (
    <div className="mt-5" data-testid="fp-duel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-display text-[17px] font-semibold">{label}</p>
        <p className="text-[13px] font-semibold tabular-nums text-muted-foreground">{t("duel.progress", { i: v.done + 1, n: v.total })}</p>
      </div>
      <p className="mt-1 text-[14px] text-muted-foreground">{t("duel.pickOne")}</p>
      <div className="relative mx-auto mt-4 grid max-w-3xl grid-cols-2 gap-4 max-sm:gap-2.5">
        {[a, b].map((m, side) => (
          <button
            key={m.k}
            type="button"
            onClick={() => choose(side as 0 | 1)}
            aria-label={t("duel.choose", { name: m.n })}
            className={cn(
              "tlm-duel-card tlm-rise group relative flex aspect-[4/5] flex-col items-center justify-end overflow-hidden rounded-[28px] border bg-foreground/[0.04] p-5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:rounded-[20px] max-sm:p-3",
              chosen === side ? "border-primary bg-primary/[0.12] shadow-[0_20px_50px_-20px_hsl(var(--primary)/0.8)]" : "border-foreground/[0.08] hover:border-primary/60 hover:shadow-[0_20px_50px_-20px_hsl(var(--primary)/0.6)]",
              chosen !== null && chosen !== side && "opacity-40"
            )}
            style={{ animationDelay: `${side * 60}ms` }}
            data-testid={side ? "fp-duel-b" : "fp-duel-a"}
          >
            <span className="absolute left-4 top-3 rounded-full bg-foreground/[0.07] px-2.5 py-1 font-display text-[13px] font-semibold text-muted-foreground max-sm:left-2.5 max-sm:top-2" aria-hidden>
              {side ? "→" : "←"}
            </span>
            <MonArt mon={m} art={p.art} shiny={p.shiny} eager className="absolute inset-x-[8%] top-[8%] h-[70%] w-[84%] drop-shadow-[0_16px_24px_rgb(0_0_0/0.35)] transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:transition-none" />
            <span className="relative font-display text-[26px] font-semibold leading-tight tracking-tight max-sm:text-[17px]">{m.n}</span>
          </button>
        ))}
        <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-foreground/[0.1] bg-card font-display text-lg font-bold uppercase text-muted-foreground shadow-lg max-sm:h-10 max-sm:w-10 max-sm:text-sm" aria-hidden>
          {t("duel.vs")}
        </span>
      </div>
      <p className="mt-4 text-center text-sm text-muted-foreground max-md:hidden">{t("duel.pickHint")}</p>
    </div>
  );
}
