"use client";

import { Gamepad2, Loader2, MapPinned, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import huntNs from "@/messages/hunt";
import { HUNT_HINT_COSTS, type HuntHint, type HuntHintKind } from "@/lib/hunt/types";

const ICONS: Record<HuntHintKind, React.ReactNode> = {
  type: <Sparkles className="h-4 w-4" aria-hidden />,
  place: <MapPinned className="h-4 w-4" aria-hidden />,
  games: <Gamepad2 className="h-4 w-4" aria-hidden />,
};

/** A hint's answer as a line ("Dragon / Ground", "Caves · Tall grass", "Diamond / Pearl / Platinum · Sword / Shield"). */
export function useHintText(): (hint: HuntHint) => string {
  const t = useT(huntNs);
  return (hint) => {
    const parts = hint.kind === "type" ? hint.names : hint.kind === "place" ? hint.kinds.map((k) => t(`hints.kind.${k}`)) : hint.games;
    return parts.length ? parts.join(hint.kind === "type" ? " / " : " · ") : t("hints.nothing");
  };
}

/**
 * The round's hints, under the question: one button each (its type, the kind of place, its games), with
 * what it costs on it. Pressed, a hint shows its answer in its place and its cost stays, struck off the
 * round's points by the server. Hard hunts have none (the list is empty and nothing is drawn).
 */
export function HuntHints({ offered, taken, busy, failed, onTake, className }: {
  offered: HuntHintKind[];
  taken: Partial<Record<HuntHintKind, HuntHint>>;
  /** The hint on its way. */
  busy?: HuntHintKind | null;
  /** A hint that didn't load. */
  failed?: HuntHintKind | null;
  onTake: (kind: HuntHintKind) => void;
  className?: string;
}) {
  const t = useT(huntNs);
  const text = useHintText();
  const fmt = (n: number) => formatNumber(n, t.locale);
  if (!offered.length) return null;
  return (
    <div className={cn("mt-[1.6vh] flex w-full max-w-[42rem] flex-col items-center gap-1.5", className)} data-testid="hunt-hints">
      <p className="sr-only">{t("hints.label")}</p>
      <ul className="flex w-full flex-wrap items-stretch justify-center gap-1.5 sm:gap-2">
        {offered.map((kind) => {
          const hint = taken[kind];
          const cost = t("hints.cost", { cost: fmt(HUNT_HINT_COSTS[kind]) });
          return (
            <li key={kind} className="min-w-0 max-w-full">
              {hint ? (
                <div
                  className="flex h-full min-h-10 max-w-full items-center gap-2 rounded-xl bg-[#ffd23c]/12 py-1.5 pl-2.5 pr-2 text-left ring-2 ring-[#ffd23c]/60"
                  data-testid={`hunt-hint-${kind}`}
                  data-taken="true"
                  role="status"
                >
                  <span className="shrink-0 text-[#ffd23c]">{ICONS[kind]}</span>
                  <span className="min-w-0">
                    <span className="block font-display text-[10px] font-bold uppercase leading-none tracking-[0.14em] text-[#ffd23c]/85">{t(`hints.${kind}`)}</span>
                    <span className="mt-0.5 block text-sm font-semibold leading-tight text-white" data-testid={`hunt-hint-${kind}-value`}>
                      {text(hint)}
                    </span>
                  </span>
                  <span className="ml-1 shrink-0 rounded-full bg-black/35 px-2 py-0.5 font-display text-[11px] font-bold tabular-nums text-[#ffb3b3]">{cost}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onTake(kind)}
                  disabled={!!busy}
                  className={cn(
                    "group flex h-10 items-center gap-2 rounded-full bg-[#1e1a3f]/90 pl-3 pr-1.5 font-display text-sm font-bold uppercase italic tracking-wide text-white shadow-lg ring-2 ring-[#a99cff]/55 backdrop-blur transition-[background-color,box-shadow] hover:bg-[#2d2766] hover:ring-[#ffd23c]/70 disabled:opacity-70",
                    failed === kind && "ring-[#ff5a5a]/80"
                  )}
                  aria-label={`${t(`hints.${kind}`)} (${t("hints.costLabel", { cost: fmt(HUNT_HINT_COSTS[kind]) })})`}
                  title={failed === kind ? t("hints.failed") : t("hints.costLabel", { cost: fmt(HUNT_HINT_COSTS[kind]) })}
                  data-testid={`hunt-hint-${kind}`}
                >
                  <span className="text-[#c8bfff] group-hover:text-[#ffd23c]">{busy === kind ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : ICONS[kind]}</span>
                  <span className="whitespace-nowrap">{t(`hints.${kind}`)}</span>
                  <span className="rounded-full bg-[#e5484d] px-2 py-0.5 text-[11px] not-italic tabular-nums leading-tight text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.2)]" aria-hidden>
                    {cost}
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {failed && !taken[failed] && (
        <p className="text-xs text-[#ff8a8a]" role="alert">
          {t("hints.failed")}
        </p>
      )}
    </div>
  );
}
