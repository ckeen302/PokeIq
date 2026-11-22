"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { shareOrCopy } from "@/lib/share";
import { Button } from "@/components/ui/button";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { useT } from "@/i18n/client";
import neaGame from "@/messages/nea-game";

/** Share the result: the share sheet on phones, the clipboard elsewhere, with a visible "Copied" and a manual-copy fallback. */
export function NeaShareButton({ text, testId = "nea-share" }: { text: string; testId?: string }) {
  const t = useT(neaGame);
  const [state, setState] = useState<"idle" | "copied" | "shared" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied" && state !== "shared") return;
    const t = window.setTimeout(() => setState("idle"), 2200);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <div className="space-y-2">
      <Button
        size="lg"
        onClick={async () => {
          const out = await shareOrCopy(text);
          setState(out === "copied" ? "copied" : out === "shared" ? "shared" : out === "failed" ? "failed" : "idle");
        }}
        data-testid={testId}
        aria-live="polite"
      >
        {state === "copied" ? <Check className="h-4 w-4" aria-hidden /> : state === "failed" ? <Copy className="h-4 w-4" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
        {state === "copied" ? t("share.copied") : state === "shared" ? t("share.shared") : t("share.button")}
      </Button>
      {state === "failed" && <CopyFallback text={text} />}
    </div>
  );
}
