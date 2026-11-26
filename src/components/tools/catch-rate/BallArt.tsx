"use client";

import { memo } from "react";
import { ballCss, BALL_SHADE } from "@/lib/pokeball-maker/css";
import { ballPreset, type BallId } from "@/lib/pokeball-maker/presets";
import { cn } from "@/lib/utils";

/** Each ball as the Poké Ball Maker's flat CSS ball (its official colours and markings), drawn once per ball. */
const cache = new Map<BallId, string>();
export function ballBackground(id: BallId): string {
  let css = cache.get(id);
  if (!css) {
    css = ballCss(ballPreset(id));
    cache.set(id, css);
  }
  return css;
}

export const BallArt = memo(function BallArt({ id, size, className }: { id: BallId; size: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{ width: size, height: size, background: ballBackground(id), boxShadow: `${BALL_SHADE}, 0 2px 6px rgb(0 0 0 / 0.35)`, border: "1px solid rgb(0 0 0 / 0.55)" }}
    />
  );
});
