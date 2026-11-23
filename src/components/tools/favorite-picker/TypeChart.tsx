"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Play, Plus, Search, Share2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import picker from "@/messages/favorite-picker";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { matchesQuery } from "@/lib/tier-list/filter";
import type { ArtStyle } from "@/lib/tier-list/art";
import { TYPES, type Mon, type TypeName } from "@/lib/tier-list/types";
import { Modal, PillButton } from "../tier-list/ui";
import { MonArt, ShinyMakerLink, ShinyToggle, typeName } from "./common";
import type { Slot } from "./Result";

/** "Favorite Pokémon of every type": a slot per type, filled by search or by a run of the picker on that type. */

export type Chart = Partial<Record<TypeName, Slot>>;

interface Props {
  chart: Chart;
  mons: readonly Mon[];
  byKey: ReadonlyMap<string, Mon>;
  art: ArtStyle;
  readOnly?: boolean;
  shinyHref(m: Mon, shiny: boolean): string | null;
  onChange(chart: Chart): void;
  onRun?(type: TypeName): void;
  /** A run of the picker on one type, left part-way. */
  paused?: TypeName | null;
  onShare?(): void;
  onExport(): void;
}

export function TypeChart(p: Props) {
  const t = useT(picker);
  const [open, setOpen] = useState<TypeName | null>(null);
  const [clearing, setClearing] = useState(false);
  const filled = TYPES.filter((ty) => p.chart[ty] && p.byKey.has(p.chart[ty]!.k)).length;
  const set = (ty: TypeName, s: Slot | null) => {
    const next = { ...p.chart };
    if (s) next[ty] = s;
    else delete next[ty];
    p.onChange(next);
  };
  return (
    <section className="rounded-[28px] border border-foreground/[0.08] bg-card p-6 shadow-[0_20px_60px_-40px_hsl(var(--shade)/0.6)] max-sm:rounded-[22px] max-sm:p-4" data-testid="fp-chart" aria-labelledby="fp-chart-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="fp-chart-title" className="font-display text-[26px] font-semibold tracking-tight max-sm:text-[22px]">
            {t("chart.title")}
          </h2>
          {!p.readOnly && <p className="mt-1 text-[15px] text-muted-foreground">{t("chart.hint")}</p>}
          <p className="mt-1 text-[13px] font-semibold text-muted-foreground" data-testid="fp-chart-count">
            {t("chart.filledCount", { n: filled, total: TYPES.length })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.onShare && (
            <PillButton onClick={p.onShare} disabled={!filled} testId="fp-chart-share">
              <Share2 className="h-4 w-4" aria-hidden /> {t("result.share")}
            </PillButton>
          )}
          <PillButton primary onClick={p.onExport} disabled={!filled} testId="fp-chart-export">
            <Download className="h-4 w-4" aria-hidden /> {t("result.download")}
          </PillButton>
        </div>
      </div>

      <ul className="mt-6 grid grid-cols-3 gap-3 max-sm:gap-2 sm:grid-cols-4 lg:grid-cols-6" data-testid="fp-chart-grid">
        {TYPES.map((ty) => {
          const s = p.chart[ty];
          const m = s ? p.byKey.get(s.k) : undefined;
          const tn = typeName(t, ty);
          return (
            <li key={ty} className="flex flex-col overflow-hidden rounded-2xl border border-foreground/[0.07] bg-foreground/[0.03]" data-testid={`fp-slot-${ty}`} data-filled={m ? m.k : ""}>
              <div className="flex h-8 items-center justify-center px-2 text-[13px] font-bold" style={{ background: typeColor(ty), color: typeTextColor(ty) }}>
                <span className="truncate">{tn}</span>
              </div>
              <button
                type="button"
                disabled={p.readOnly}
                onClick={() => setOpen(ty)}
                aria-label={m ? t("chart.slotFilled", { type: tn, name: m.n }) : t("chart.slotEmpty", { type: tn })}
                className="group flex flex-1 flex-col items-center px-1.5 pb-2 pt-1.5 text-center transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
                data-testid={`fp-slot-open-${ty}`}
              >
                <span className="fp-slot-art relative block aspect-square w-full">
                  {m ? (
                    <MonArt mon={m} art={p.art} shiny={s!.shiny} className="absolute inset-[6%] h-[88%] w-[88%] transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none" />
                  ) : (
                    <span className="absolute inset-[14%] flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-foreground/[0.12] text-muted-foreground">
                      <Plus className="h-5 w-5" aria-hidden />
                      <span className="text-[12px] font-semibold">{t("chart.choose")}</span>
                    </span>
                  )}
                  {paused(p, ty) && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />}
                </span>
                <span className={cn("block w-full truncate text-[13px] font-semibold leading-tight", !m && "text-muted-foreground")}>{m ? m.n : " "}</span>
              </button>
              {m && (
                <div className="flex items-center justify-center border-t border-foreground/[0.06]">
                  {!p.readOnly && <ShinyToggle size="sm" on={s!.shiny} onChange={(v) => set(ty, { ...s!, shiny: v })} label={t("result.shinyOf", { name: m.n })} testId={`fp-slot-shiny-${ty}`} />}
                  <ShinyMakerLink compact href={p.shinyHref(m, s!.shiny)} label={t("result.shinyMakerOf", { name: m.n })} testId={`fp-slot-maker-${ty}`} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!p.readOnly && filled > 0 && (
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={() => setClearing(true)} className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="fp-chart-clear">
            <Trash2 className="h-4 w-4" aria-hidden /> {t("chart.clearAll")}
          </button>
        </div>
      )}

      {open && (
        <SlotDialog
          type={open}
          mons={p.mons}
          current={p.chart[open] ?? null}
          art={p.art}
          onClose={() => setOpen(null)}
          onPick={(k) => {
            set(open, { k, shiny: p.chart[open]?.k === k ? p.chart[open]!.shiny : false });
            setOpen(null);
          }}
          onClear={() => {
            set(open, null);
            setOpen(null);
          }}
          onRun={
            p.onRun
              ? () => {
                  const ty = open;
                  setOpen(null);
                  p.onRun!(ty);
                }
              : undefined
          }
          paused={p.paused === open}
        />
      )}
      {clearing && (
        <Modal title={t("chart.clearAll")} onClose={() => setClearing(false)} closeLabel={t("close")}>
          <p className="text-[15px] text-muted-foreground">{t("chart.clearConfirm")}</p>
          <div className="mt-5 flex justify-end gap-2">
            <PillButton onClick={() => setClearing(false)}>{t("cancel")}</PillButton>
            <PillButton
              primary
              onClick={() => {
                p.onChange({});
                setClearing(false);
              }}
              testId="fp-chart-clear-yes"
            >
              {t("chart.clearAll")}
            </PillButton>
          </div>
        </Modal>
      )}
    </section>
  );
}

const paused = (p: Props, ty: TypeName) => !p.readOnly && p.paused === ty;

const SHOWN = 400;

function SlotDialog({ type, mons, current, art, onClose, onPick, onClear, onRun, paused: isPaused }: { type: TypeName; mons: readonly Mon[]; current: Slot | null; art: ArtStyle; onClose(): void; onPick(k: string): void; onClear(): void; onRun?(): void; paused: boolean }) {
  const t = useT(picker);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const tn = typeName(t, type);
  const ofType = useMemo(() => mons.filter((m) => m.t.includes(type)), [mons, type]);
  const found = useMemo(() => ofType.filter((m) => matchesQuery(m, q)), [ofType, q]);
  useEffect(() => input.current?.focus(), []);
  return (
    <Modal title={t("chart.dialogTitle", { type: tn })} onClose={onClose} closeLabel={t("close")} wide testId="fp-slot-dialog">
      {onRun && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary/[0.08] px-4 py-3">
          <p className="text-[14px] text-muted-foreground">{t("chart.runHint", { type: tn })}</p>
          <PillButton primary onClick={onRun} testId="fp-slot-run">
            <Play className="h-4 w-4" aria-hidden /> {t("chart.runPicker")}
            {isPaused && <span className="h-2 w-2 rounded-full bg-primary-foreground" aria-hidden />}
          </PillButton>
        </div>
      )}
      <label className="relative block">
        <span className="sr-only">{t("chart.searchLabel", { type: tn })}</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("chart.searchPlaceholder")}
          className="h-12 w-full rounded-full border border-foreground/[0.1] bg-background pl-11 pr-11 text-[16px] outline-none focus:border-primary/60"
          data-testid="fp-slot-search"
          inputMode="search"
          autoComplete="off"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label={t("close")} className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </label>
      {found.length ? (
        <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5" data-testid="fp-slot-results">
          {found.slice(0, SHOWN).map((m) => (
            <li key={m.k}>
              <button
                type="button"
                onClick={() => onPick(m.k)}
                aria-pressed={current?.k === m.k}
                className={cn("flex w-full flex-col items-center rounded-2xl border p-1.5 pb-2 text-center transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", current?.k === m.k ? "border-primary/60 bg-primary/[0.1]" : "border-transparent bg-foreground/[0.035]")}
                data-testid="fp-slot-result"
              >
                <span className="fp-slot-art relative block aspect-square w-full">
                  <MonArt mon={m} art={art} shiny={false} className="absolute inset-[6%] h-[88%] w-[88%]" />
                </span>
                <span className="block w-full truncate text-[12px] font-semibold">{m.n}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-muted-foreground">{t("chart.noMatch", { type: tn })}</p>
      )}
      {current && (
        <div className="mt-4 flex justify-end">
          <PillButton onClick={onClear} testId="fp-slot-clear">
            <Trash2 className="h-4 w-4" aria-hidden /> {t("chart.clear")}
          </PillButton>
        </div>
      )}
    </Modal>
  );
}
