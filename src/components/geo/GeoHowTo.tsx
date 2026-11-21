"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HowToActions, HowToCards, HowToDialog } from "@/components/howto/shared";
import { GuessrDemo } from "@/components/howto/GuessrDemo";
import { GEO_MAX_ROUND_SCORE, GEO_ROUND_OPTIONS, GEO_ROUNDS } from "@/lib/geo-types";
import { DUEL_HP } from "@/lib/duel-types";
import { PREFS_KEY, seenDemo } from "./GeoHowToButton";
import { useT } from "@/i18n/client";
import { formatNumber } from "@/i18n/catalog";
import geoHowto from "@/messages/geo-howto";

export { HowToHelpButton } from "./GeoHowToButton";

/**
 * PokéGuessr's "How to play" pop-up: opens by itself once per visit until "Don't show again", and on the `pokeiq:howto` event.
 * Loaded on demand by GeoHowToLoader, which opens it at once (`defaultOpen`).
 */
export function GeoHowTo({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const t = useT(geoHowto);
  const fmt = (n: number) => formatNumber(n, t.locale);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("pokeiq:howto", show);
    return () => window.removeEventListener("pokeiq:howto", show);
  }, []);
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    if (!seenDemo()) setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const never = useCallback(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ seenHowToDemo: true }));
    } catch {
      // Private mode: it stays closed for this visit only.
    }
    setOpen(false);
  }, []);
  if (!open) return null;
  return (
    <HowToDialog onClose={close} testId="howto-sheet" footer={<HowToActions onClose={close} onNever={never} />}>
      <GuessrDemo />
      <HowToCards
        cards={[
          { title: t("goal.title"), body: <p>{t("goal.body")}</p> },
          {
            title: t("scoring.title"),
            body: <p>{t("scoring.body", { max: fmt(GEO_MAX_ROUND_SCORE), lengths: GEO_ROUND_OPTIONS.join(", "), daily: GEO_ROUNDS })}</p>,
          },
          {
            title: t("modes.title"),
            body: <p>{t("modes.body", { daily: GEO_ROUNDS })}</p>,
          },
          {
            title: t("duels.title"),
            body: <p>{t("duels.body", { hp: fmt(DUEL_HP) })}</p>,
          },
        ]}
      />
    </HowToDialog>
  );
}
