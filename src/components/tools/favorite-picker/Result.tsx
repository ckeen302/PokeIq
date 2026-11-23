"use client";

import { ChevronDown, ChevronUp, Crown, Download, LayoutGrid, RotateCcw, Share2, Sparkles, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import picker from "@/messages/favorite-picker";
import type { ArtStyle } from "@/lib/tier-list/art";
import type { Mon } from "@/lib/tier-list/types";
import { IconButton, PillButton } from "../tier-list/ui";
import { MonArt, ShinyMakerLink, ShinyToggle, TypeChip } from "./common";

/** The end screen: the favorite big, and the top list under it (each one can go shiny, move, or open in the Shiny Maker). */

export interface Slot {
  k: string;
  shiny: boolean;
}

interface Props {
  top: Slot[];
  byKey: ReadonlyMap<string, Mon>;
  art: ArtStyle;
  /** A shared result: nothing to change. */
  readOnly?: boolean;
  from: string | null;
  shinyHref(m: Mon, shiny: boolean): string | null;
  onChange(top: Slot[]): void;
  onShare?(): void;
  onExport(): void;
  onToChart?(): void;
  onUndo?(): void;
  onAgain?(): void;
}

export function Result(p: Props) {
  const t = useT(picker);
  const slots = p.top.map((s) => ({ s, m: p.byKey.get(s.k) })).filter((x): x is { s: Slot; m: Mon } => !!x.m);
  if (!slots.length) return null;
  const [fav, ...rest] = slots;
  const setShiny = (i: number, v: boolean) => p.onChange(p.top.map((s, j) => (j === i ? { ...s, shiny: v } : s)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= p.top.length) return;
    const next = p.top.slice();
    [next[i], next[j]] = [next[j], next[i]];
    p.onChange(next);
  };
  return (
    <div data-testid="fp-result">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <section className="relative min-w-0 overflow-hidden rounded-[28px] border border-foreground/[0.08] bg-card p-7 text-center shadow-[0_20px_60px_-40px_hsl(var(--shade)/0.6)] max-sm:rounded-[22px] max-sm:p-5" aria-labelledby="fp-fav-name">
          <div className="fp-crown-glow pointer-events-none absolute left-1/2 top-[44%] h-[70%] w-[80%] -translate-x-1/2 -translate-y-1/2" aria-hidden />
          <p className="relative inline-flex items-center gap-2 font-display text-[13px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--warning))]">
            <Crown className="h-4 w-4" aria-hidden /> {t("result.eyebrow")}
          </p>
          <div className="relative mx-auto mt-2 aspect-square w-full max-w-[360px] max-sm:max-w-[260px]">
            <MonArt mon={fav.m} art={p.art} shiny={fav.s.shiny} eager className="tlm-pop absolute inset-0 h-full w-full drop-shadow-[0_24px_30px_rgb(0_0_0/0.35)]" />
          </div>
          <h2 id="fp-fav-name" className="relative font-display text-[40px] font-bold leading-tight tracking-tight max-sm:text-[30px]" data-testid="fp-favorite">
            {fav.m.n}
          </h2>
          <div className="relative mt-2 flex justify-center gap-1.5">
            {fav.m.t.map((ty) => (
              <TypeChip key={ty} t={t} type={ty} />
            ))}
          </div>
          <div className="relative mt-5 flex flex-wrap items-center justify-center gap-2">
            {!p.readOnly && (
              <button
                type="button"
                aria-pressed={fav.s.shiny}
                onClick={() => setShiny(0, !fav.s.shiny)}
                className={cn("inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors max-md:h-11", fav.s.shiny ? "bg-[hsl(var(--warning)/0.18)] text-foreground" : "bg-foreground/[0.07] hover:bg-foreground/[0.11]")}
                data-testid="fp-fav-shiny"
              >
                <Sparkles className={cn("h-4 w-4", fav.s.shiny && "text-[hsl(var(--warning))]")} aria-hidden /> {t("result.shiny")}
              </button>
            )}
            <ShinyMakerLink href={p.shinyHref(fav.m, fav.s.shiny)} label={t("result.shinyMaker")} testId="fp-fav-shiny-maker" />
          </div>
        </section>

        <section className="min-w-0 rounded-[28px] border border-foreground/[0.08] bg-card p-6 max-sm:rounded-[22px] max-sm:px-2.5 max-sm:py-4" aria-labelledby="fp-top-title">
          <h2 id="fp-top-title" className="font-display text-[22px] font-semibold tracking-tight max-sm:px-1.5">
            {t("result.topN", { n: slots.length })}
          </h2>
          <ol className="mt-3 space-y-1" data-testid="fp-top">
            {[fav, ...rest].map(({ s, m }, i) => (
              <li key={s.k} className={cn("flex min-w-0 items-center gap-2 rounded-2xl py-1 pl-2 pr-1 max-sm:gap-0.5 max-sm:pl-1 max-sm:pr-0", i === 0 ? "bg-[hsl(var(--warning)/0.1)]" : "hover:bg-foreground/[0.03]")} data-testid="fp-top-row">
                <span className={cn("w-7 shrink-0 text-center font-display text-[17px] font-bold tabular-nums", i === 0 ? "text-[hsl(var(--warning))]" : "text-muted-foreground")}>{i + 1}</span>
                <span className="relative h-12 w-12 shrink-0 max-sm:h-10 max-sm:w-10">
                  <MonArt mon={m} art={p.art} shiny={s.shiny} className="absolute inset-0 h-full w-full" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold max-sm:pl-1 max-sm:text-[14px]">{m.n}</span>
                {!p.readOnly && (
                  <>
                    <ShinyToggle size="sm" on={s.shiny} onChange={(v) => setShiny(i, v)} label={t("result.shinyOf", { name: m.n })} testId="fp-top-shiny" />
                    <IconButton label={t("result.up", { name: m.n })} onClick={() => move(i, -1)} disabled={i === 0} testId="fp-top-up" className="max-sm:w-8">
                      <ChevronUp className="h-4 w-4" aria-hidden />
                    </IconButton>
                    <IconButton label={t("result.down", { name: m.n })} onClick={() => move(i, 1)} disabled={i === slots.length - 1} testId="fp-top-down" className="max-sm:w-8">
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    </IconButton>
                  </>
                )}
                <ShinyMakerLink compact href={p.shinyHref(m, s.shiny)} label={t("result.shinyMakerOf", { name: m.n })} />
              </li>
            ))}
          </ol>
          {!p.readOnly && slots.length > 2 && <p className="mt-3 max-sm:px-1.5 text-[13px] leading-relaxed text-muted-foreground">{t("result.how")}</p>}
          {p.from && <p className="mt-2 text-[13px] max-sm:px-1.5 text-muted-foreground" data-testid="fp-from">{t("result.from", { pool: p.from })}</p>}
        </section>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 max-sm:grid max-sm:grid-cols-2">
        {p.onShare && (
          <PillButton onClick={p.onShare} testId="fp-share">
            <Share2 className="h-4 w-4" aria-hidden /> {t("result.share")}
          </PillButton>
        )}
        <PillButton primary onClick={p.onExport} testId="fp-export">
          <Download className="h-4 w-4" aria-hidden /> {t("result.download")}
        </PillButton>
        {p.onToChart && (
          <PillButton onClick={p.onToChart} testId="fp-to-chart">
            <LayoutGrid className="h-4 w-4" aria-hidden /> {t("result.toChart")}
          </PillButton>
        )}
        <span className="flex-1 max-sm:hidden" />
        {p.onUndo && (
          <PillButton onClick={p.onUndo} testId="fp-result-undo">
            <Undo2 className="h-4 w-4" aria-hidden /> {t("result.undoLast")}
          </PillButton>
        )}
        {p.onAgain && (
          <PillButton onClick={p.onAgain} testId="fp-again">
            <RotateCcw className="h-4 w-4" aria-hidden /> {t("result.again")}
          </PillButton>
        )}
      </div>
    </div>
  );
}
