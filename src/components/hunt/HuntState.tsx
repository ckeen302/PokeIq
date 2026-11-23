"use client";

import { RotateCcw } from "lucide-react";
import { useT } from "@/i18n/client";
import huntNs from "@/messages/hunt";
import { PokeBallMark } from "./HuntRoundCard";

/**
 * The hunt's in-game states, on the game frame's navy: loading (a Poké Ball
 * spinning on the radar), an error with Try again and Back, and an empty
 * map (nothing to hunt in that region yet) with Back.
 */
export function HuntState({ kind, message, onRetry, onBack }: { kind: "loading" | "error" | "empty"; message?: string; onRetry?: () => void; onBack?: () => void }) {
  const t = useT(huntNs);
  const text = message ?? (kind === "loading" ? t("state.loading") : kind === "error" ? t("state.error") : t("state.empty"));
  return (
    <div className="absolute inset-0 z-[50] flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_45%,#2d2766_0%,#1a163a_45%,#0f0d1f_80%)] p-4" data-testid={`hunt-${kind}`}>
      <div className="w-full max-w-sm text-center text-white" role={kind === "loading" ? "status" : "alert"} aria-live="polite">
        {kind === "loading" ? (
          <div className="relative mx-auto h-16 w-16">
            <PokeBallMark className="h-16 w-16 animate-spin text-[#a99cff] [animation-duration:1.4s] motion-reduce:animate-none" />
          </div>
        ) : (
          <PokeBallMark className="mx-auto h-14 w-14 text-white/30" />
        )}
        <p className="mt-4 font-display text-lg font-bold uppercase italic tracking-wide">{text}</p>
        {kind !== "loading" && (
          <div className="mt-5 flex justify-center gap-2">
            {onRetry && (
              <button type="button" onClick={onRetry} className="inline-flex h-11 items-center gap-2 rounded-md bg-[#4cbb17] px-5 font-display text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#58d01c]" data-testid="hunt-retry">
                <RotateCcw className="h-4 w-4" aria-hidden />
                {t("state.retry")}
              </button>
            )}
            {onBack && (
              <button type="button" onClick={onBack} className="inline-flex h-11 items-center rounded-md bg-white/10 px-5 font-display text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-white/20" data-testid="hunt-back-to-hub">
                {t("state.back")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
