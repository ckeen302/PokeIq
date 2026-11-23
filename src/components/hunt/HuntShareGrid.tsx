"use client";

import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import huntNs from "@/messages/hunt";
import { ShareButton } from "@/components/share/ShareButton";
import { huntSquare } from "./hunt-ui";

const SQUARE = {
  green: "bg-[#4cbb17]",
  yellow: "bg-[#eab308]",
  orange: "bg-[#f97316]",
  red: "bg-[#e5484d]",
} as const;

/**
 * The Daily Hunt's share card, like the other dailies': its title and
 * total, a square per round with the round's points under it, what the
 * colours mean, and Share (the share sheet, or the clipboard). `share` is
 * the text the game wrote; nothing here names a Pokémon or a place.
 */
export function HuntShareGrid({ number, scores, share, className }: { number: number; scores: number[]; share: string; className?: string }) {
  const t = useT(huntNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const total = scores.reduce((a, b) => a + b, 0);
  return (
    <div className={cn("rounded-lg border bg-card p-4 text-card-foreground", className)} data-testid="hunt-share">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-lg font-bold uppercase">{t("share.daily", { n: number })}</p>
        <p className="font-display text-lg font-bold tabular-nums text-success">{fmt(total)}</p>
      </div>
      <div className="mt-3 flex justify-center">
        <div className="inline-grid gap-x-1.5 gap-y-1" style={{ gridTemplateColumns: `repeat(${scores.length}, 2.5rem)` }} role="img" aria-label={scores.map((s, i) => t("share.roundLabel", { n: i + 1, score: fmt(s) })).join(", ")} data-testid="hunt-share-grid">
          {scores.map((s, i) => (
            <span key={`s${i}`} className={cn("h-10 w-10 rounded-[5px] shadow-[inset_0_-3px_0_rgb(0_0_0/0.3)]", SQUARE[huntSquare(s)])} />
          ))}
          {scores.map((s, i) => (
            <span key={`n${i}`} className="text-center font-pixel text-[8px] tabular-nums text-muted-foreground">
              {fmt(s)}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">{t("share.legend")}</p>
      <ShareButton className="mt-3 w-full" size="lg" kind="hunt" label={t("share.copy")} getText={() => share} data-testid="hunt-share-button" />
      <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        {t("share.next")}
      </p>
    </div>
  );
}
