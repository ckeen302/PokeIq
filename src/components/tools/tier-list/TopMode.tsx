"use client";

/* eslint-disable @next/next/no-img-element -- remote Pokémon pictures */
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import tierList from "@/messages/tier-list";
import { artUrl, isPixelUrl, type ArtStyle } from "@/lib/tier-list/art";
import type { TopState } from "@/lib/tier-list/state";
import type { Mon } from "@/lib/tier-list/types";
import { Tile } from "./Tile";

interface Props {
  top: TopState;
  byKey: ReadonlyMap<string, Mon>;
  art: ArtStyle;
  shiny: boolean;
  moving: ReadonlySet<string>;
  onTileDown(e: React.PointerEvent<HTMLElement>, key: string, from: string): void;
  onRemove(key: string): void;
  onMove(key: string, to: number): void;
  onCaption(key: string, text: string): void;
  onCaptionStart(): void;
  onCaptionDone(): void;
}

const MEDAL = ["#f6c94a", "#c9d2e0", "#e09a5f"];

/** Top N: a podium for the top three, then a numbered list; every place is a drop target, each entry can carry a line. */
export function TopMode({ top, byKey, art, shiny, moving, onTileDown, onRemove, onMove, onCaption, onCaptionStart, onCaptionDone }: Props) {
  const t = useT(tierList);
  const items = top.items;
  const podium = Math.min(3, top.length);
  const order = podium === 3 ? [1, 0, 2] : podium === 2 ? [0, 1] : [0];

  return (
    <div className="space-y-4" data-testid="top-board">
      <div className={cn("grid items-end gap-3 max-sm:gap-2", podium === 3 ? "grid-cols-3" : podium === 2 ? "grid-cols-2" : "grid-cols-1")}>
        {order.map((i) => {
          const k = items[i];
          const m = k ? byKey.get(k) : undefined;
          const h = i === 0 ? "h-[288px] max-sm:h-[204px]" : i === 1 ? "h-[248px] max-sm:h-[178px]" : "h-[224px] max-sm:h-[164px]";
          return (
            <div
              key={i}
              data-drop={`top@${i}`}
              data-testid="top-slot"
              className={cn("relative flex flex-col items-center justify-end overflow-hidden rounded-[24px] border border-foreground/[0.07] bg-foreground/[0.035] px-2 pb-3 pt-8 transition-colors max-sm:rounded-[18px] max-sm:pb-2", h)}
              style={m ? { background: `radial-gradient(80% 60% at 50% 40%, ${MEDAL[i]}33, transparent 70%), hsl(var(--foreground) / 0.035)` } : undefined}
            >
              <span className="absolute left-3 top-2.5 font-display text-[22px] font-bold max-sm:left-2 max-sm:top-1.5 max-sm:text-[17px]" style={{ color: MEDAL[i] }}>
                {t("top.rank", { n: i + 1 })}
              </span>
              {m ? (
                <>
                  <div
                    data-tile={m.k}
                    className={cn("tlm-pop relative min-h-0 w-full flex-1 cursor-grab touch-pan-y", moving.has(m.k) && "opacity-30")}
                    onPointerDown={(e) => onTileDown(e, m.k, "top")}
                    title={m.n}
                  >
                    <img
                      src={artUrl(m, art, shiny)}
                      alt={m.n}
                      className={cn("pointer-events-none absolute inset-0 h-full w-full object-contain drop-shadow-[0_10px_18px_rgb(0_0_0/0.35)]", isPixelUrl(artUrl(m, art, shiny)) && "[image-rendering:pixelated]")}
                      draggable={false}
                    />
                  </div>
                  <p className="mt-1 w-full truncate text-center font-display text-[15px] font-semibold max-sm:text-[13px]">{m.n}</p>
                  <input
                    value={top.captions[m.k] ?? ""}
                    onChange={(e) => onCaption(m.k, e.target.value.slice(0, 80))}
                    onFocus={onCaptionStart}
                    onBlur={onCaptionDone}
                    placeholder={t("top.caption")}
                    aria-label={t("top.captionLabel", { n: i + 1 })}
                    className="h-7 w-full min-w-0 truncate rounded-lg bg-transparent px-1 text-center text-[13px] text-muted-foreground outline-none placeholder:text-muted-foreground/50 focus:bg-foreground/[0.05] focus:text-foreground max-sm:text-[12px]"
                    maxLength={80}
                    data-testid="top-caption"
                  />
                  <button type="button" onClick={() => onRemove(m.k)} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground" aria-label={t("top.remove", { name: m.n })}>
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </>
              ) : (
                <p className="mb-auto mt-auto text-center text-[13px] text-muted-foreground">{t("top.empty")}</p>
              )}
            </div>
          );
        })}
      </div>
      {top.length > 3 && (
        <ol className="space-y-1.5" data-testid="top-list">
          {Array.from({ length: top.length - 3 }, (_, j) => {
            const i = j + 3;
            const k = items[i];
            const m = k ? byKey.get(k) : undefined;
            return (
              <li key={i} data-drop={`top@${i}`} data-testid="top-slot" className="flex items-center gap-3 rounded-2xl bg-foreground/[0.035] p-1.5 pr-2 transition-colors max-sm:gap-2">
                <span className="w-10 shrink-0 text-center font-display text-lg font-bold text-muted-foreground max-sm:w-7 max-sm:text-base">{i + 1}</span>
                {m ? (
                  <>
                    <Tile mon={m} art={art} shiny={shiny} size={56} from="top" moving={moving.has(m.k)} onPointerDown={onTileDown} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-[15px] font-semibold">{m.n}</p>
                      <input
                        value={top.captions[k] ?? ""}
                        onChange={(e) => onCaption(k, e.target.value.slice(0, 80))}
                        onFocus={onCaptionStart}
                    onBlur={onCaptionDone}
                        placeholder={t("top.caption")}
                        aria-label={t("top.captionLabel", { n: i + 1 })}
                        className="h-8 w-full min-w-0 bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/60 focus:text-foreground"
                        maxLength={80}
                      />
                    </div>
                    <div className="flex shrink-0 items-center max-sm:flex-col">
                      <button type="button" onClick={() => onMove(k, i - 1)} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground max-sm:h-7" aria-label={t("top.up", { name: m.n })}>
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </button>
                      <button type="button" onClick={() => onMove(k, i + 1)} disabled={i >= items.length - 1} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:opacity-30 max-sm:h-7" aria-label={t("top.down", { name: m.n })}>
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                    <button type="button" onClick={() => onRemove(k)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground" aria-label={t("top.remove", { name: m.n })}>
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </>
                ) : (
                  <div className="flex h-14 flex-1 items-center rounded-xl border border-dashed border-foreground/[0.1] px-4 text-sm text-muted-foreground/80">{t("top.empty")}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!items.length && <p className="px-1 text-center text-sm text-muted-foreground">{t("top.emptyHint")}</p>}
    </div>
  );
}
