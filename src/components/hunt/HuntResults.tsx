"use client";

import { useState } from "react";
import Link from "@/components/ui/Link";
import { Check, Copy, RotateCcw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/i18n/format";
import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";
import type { HuntResult } from "@/lib/hunt/types";

export interface HuntResultsProps {
  result: HuntResult;
  /** The share text (the Daily's grid), or null. */
  share: string | null;
  onAgain: () => void;
  daily?: { number: number };
}

/** The end of a hunt: the total, each round's Pokémon and points, share and play again. Presentation: owned by hunt design. */
export function HuntResults({ result, share, onAgain, daily }: HuntResultsProps) {
  const t = useT(huntNs);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!share) return;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) await navigator.share({ text: share });
      else await navigator.clipboard.writeText(share);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Cancelled, or no clipboard: nothing to do.
    }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-5" data-testid="hunt-results">
      <div className="text-center">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{daily ? t("round.daily", { n: daily.number }) : t("round.mode")}</p>
        <h1 className="font-display text-3xl font-bold uppercase italic">{t("results.title")}</h1>
        <p className="mt-2 font-display text-5xl font-bold tabular-nums text-success" data-testid="hunt-total">
          {t("results.total", { score: fmt(result.score), max: fmt(result.max) })}
        </p>
      </div>
      <Card>
        <CardContent className="divide-y p-0">
          {result.rounds.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3 p-3">
              <span className="w-5 text-center font-display text-sm text-muted-foreground">{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element -- small official art */}
              <img src={r.art} alt="" width={48} height={48} className="h-12 w-12 object-contain" />
              <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
              <span className="text-sm text-muted-foreground">{t("reveal.found", { found: r.found, of: r.of })}</span>
              <span className="w-16 text-right font-display font-bold tabular-nums">{fmt(r.score)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      {share && <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-center text-sm">{share}</pre>}
      <div className="flex flex-wrap justify-center gap-3">
        {share && (
          <Button variant="success" onClick={() => void copy()} data-testid="hunt-share">
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            {copied ? t("results.copied") : t("results.share")}
          </Button>
        )}
        <Button variant="outline" onClick={onAgain} data-testid="hunt-again">
          <RotateCcw className="h-4 w-4" aria-hidden /> {t("results.again")}
        </Button>
        <Link href="/pokeguessr" className={cn(buttonVariants({ variant: "ghost" }))}>
          {t("results.back")}
        </Link>
      </div>
    </div>
  );
}
