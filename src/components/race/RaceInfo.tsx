import type { ReactNode } from "react";
import { ACCEL, FADE, SPEED_PER_POINT } from "@/lib/race/model";
import type { Translator } from "@/i18n/catalog";
import raceInfo from "@/messages/race-info";

const strong = "text-foreground";
const b = (c: ReactNode[]) => <strong className={strong}>{c}</strong>;
const sub = (c: ReactNode[]) => <sub>{c}</sub>;
const sup = (c: ReactNode[]) => <sup>{c}</sup>;

/**
 * "How the race works": the model in plain words, what is measured and what
 * is a choice, with its sources. Shown in the 3D view's info panel and in
 * the page's server-rendered text (`t`: the caller's race-info translator,
 * serverT on the page, useT in the 3D view).
 */
export function raceInfoText(t: Translator<typeof raceInfo.en>, compact = false) {
  const v100 = 100 * SPEED_PER_POINT;
  return (
    <div className={compact ? "space-y-3 text-sm leading-relaxed" : "space-y-3 text-sm leading-relaxed text-muted-foreground"} data-testid="race-info">
      <p>{t.rich("p1", { b, v100, kmh: (v100 * 3.6).toFixed(0) })}</p>
      <p>{t.rich("p2", { b, sub, sup, tau0: ACCEL.tau0, min: ACCEL.min, max: ACCEL.max })}</p>
      <p>{t.rich("p3", { b, onset: FADE.onset, floor: Math.round(FADE.floor * 100) })}</p>
      <p>{t.rich("p4", { b, sup })}</p>
      <p>{t.rich("p5", { b })}</p>
      <p className="text-xs">{t("p6")}</p>
    </div>
  );
}
