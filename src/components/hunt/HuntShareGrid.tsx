"use client";

import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/format";
import huntNs from "@/messages/hunt";
import { ShareButton } from "@/components/share/ShareButton";
import { huntSquare, huntShareText, type HuntShareRound } from "./share";

const SQUARE: Record<string, string> = {
  "🟩": "bg-[#4cbb17]",
  "🟨": "bg-[#eab308]",
  "🟧": "bg-[#f97316]",
  "🟥": "bg-[#e5484d]",
};

/**
 * The Daily Hunt's share card, like the other dailies': the title and total,
 * a row of squares per round (one per pin, coloured by its share of the
 * round), the legend, and the Share button (share sheet or clipboard).
 * Nothing on it names a Pokémon or a place.
 */
export function HuntShareGrid({ title, rounds, url, className }: { title: string; rounds: HuntShareRound[]; url: string; className?: string }) {
  const t = useT(huntNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const total = rounds.reduce((s, r) => s + r.score, 0);
  const label = rounds
    .map((r, i) => `${i + 1}: ${(r.pins.length ? r.pins : [0]).map((p) => huntSquare(p, r.pinMax)).join("")} ${fmt(r.score)}`)
    .join(", ");
  return (
    <div className={cn("rounded-lg border bg-card p-4 text-card-foreground", className)} data-testid="hunt-share">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-lg font-bold uppercase">{title}</p>
        <p className="font-display text-lg font-bold tabular-nums text-success">
          {fmt(total)}
          <span className="text-sm text-muted-foreground">/{fmt(rounds.length * 5000)}</span>
        </p>
      </div>
      <p className="hud-label mt-2 text-screen">{t("share.grid")}</p>
      <ol className="mt-2 space-y-1.5" role="img" aria-label={label} data-testid="hunt-share-grid">
        {rounds.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-4 text-right font-pixel text-[9px] text-muted-foreground">{i + 1}</span>
            <span className="flex gap-1">
              {(r.pins.length ? r.pins : [0]).map((p, k) => (
                <span key={k} className={cn("h-7 w-7 rounded-[4px] shadow-[inset_0_-3px_0_rgb(0_0_0/0.3)]", SQUARE[huntSquare(p, r.pinMax)])} />
              ))}
            </span>
            <span className="ml-auto font-display text-sm font-bold tabular-nums">{fmt(r.score)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">{t("share.legend")}</p>
      <ShareButton className="mt-3 w-full" size="lg" kind="hunt" label={t("share.copy")} getText={() => huntShareText({ title, rounds, url, locale: t.locale })} data-testid="hunt-share-button" />
    </div>
  );
}
