"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { copyText, shareOrCopy } from "@/lib/share";
import { useT } from "@/i18n/client";
import geoNs from "@/messages/geo";
import { localeHref } from "@/i18n/href";

/** The result page's path for a signed PokéGuessr result (game, daily or streak) or a finished duel. */
export const resultPath = (token: string) => `/pokeguessr/r/${encodeURIComponent(token)}`;

/**
 * Copies the link to a result's own page (with its preview card) to the
 * clipboard, or opens the share sheet on a phone.
 */
export function ShareResultLink({ token, text: given, className }: { token: string; text?: string; className?: string }) {
  const t = useT(geoNs);
  const text = given ?? t("share.text");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const path = localeHref(resultPath(token), t.locale).href;
  const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  async function share() {
    const outcome = window.matchMedia("(pointer: coarse)").matches ? await shareOrCopy(text, url) : (await copyText(url)) ? "copied" : "failed";
    if (outcome === "cancelled") return;
    setState(outcome === "failed" ? "failed" : "copied");
    window.clearTimeout(timer.current);
    if (outcome !== "failed") timer.current = window.setTimeout(() => setState("idle"), 2200);
  }

  return (
    <div className={className}>
      <Button size="lg" variant={state === "copied" ? "success" : "outline"} className="w-full" onClick={() => void share()} data-testid="geo-share-link">
        {state === "copied" ? <Check className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
        {state === "copied" ? t("share.copied") : t("share.copy")}
      </Button>
      {state === "failed" && <CopyFallback text={url} />}
    </div>
  );
}
