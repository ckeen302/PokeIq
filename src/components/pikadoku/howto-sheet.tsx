"use client";

import type { ReactNode } from "react";
import { PDK_FAMILIES, PDK_PP } from "@/lib/pikadoku/types";
import { pdkRules } from "@/lib/pikadoku/rules";
import { HowToActions, HowToCards, HowToDialog } from "@/components/howto/shared";
import { PikadokuDemo } from "@/components/howto/PikadokuDemo";
import { useT } from "@/i18n/client";
import pikadoku from "@/messages/pikadoku";
import board from "@/messages/pikadoku-board";

/**
 * Pikadoku's how to play. It comes with the board, not with the other
 * pop-ups: a first visit's copy is in the page's HTML (see Pikadoku).
 */

const b = (c: ReactNode[]) => <b>{c}</b>;

export function PdkHowToSheet({ onClose, onNever }: { onClose: () => void; onNever?: () => void }) {
  const t = useT(pikadoku);
  const tb = useT(board);
  const tile = (big: string, small: string) => (
    <div className="rounded-md border border-foreground/10 p-3 text-center">
      <p className="font-display text-2xl font-bold tabular-nums">{big}</p>
      <p className="hud-label">{small}</p>
    </div>
  );
  return (
    <HowToDialog onClose={onClose} subtitle={t("howTo.subtitle")} testId="pdk-howto" footer={<HowToActions onClose={onClose} onNever={onNever} />}>
      <PikadokuDemo />
      <HowToCards
        cards={[
          { title: t("howTo.goal"), body: <p>{t("howTo.goalBody")}</p> },
          { title: t("howTo.core"), body: <p>{t("howTo.coreBody", { pp: PDK_PP })}</p> },
          { title: t("howTo.scoring"), body: <p>{t("howTo.scoringBody")}</p> },
        ]}
      />
      <details className="rounded-md border bg-shade/30 p-3">
        <summary className="tap cursor-pointer font-semibold max-sm:py-2.5">{t("howTo.full")}</summary>
      <div className="mt-3 space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {tile("9", t("howTo.boxes"))}
        {tile(String(PDK_PP), t("howTo.guesses"))}
        {tile("0", t("howTo.reused"))}
      </div>
      <div>
        <p className="hud-label mb-1.5">{t("howTo.core")}</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>{t.rich("howTo.rules.both", { b })}</li>
          <li>{t.rich("howTo.rules.pp", { b, pp: PDK_PP })}</li>
          <li>{t.rich("howTo.rules.score", { b })}</li>
          <li>{t.rich("howTo.rules.filled", { b })}</li>
          <li>{t.rich("howTo.rules.info", { b })}</li>
          <li>{t.rich("howTo.rules.master", { b })}</li>
        </ul>
      </div>
      <div>
        <p className="hud-label mb-1.5">{t("howTo.modes")}</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>{t.rich("howTo.modeList.daily", { b })}</li>
          <li>{t.rich("howTo.modeList.unlimited", { b })}</li>
          <li>{t.rich("howTo.modeList.ttt", { b })}</li>
        </ul>
      </div>
      <div>
        <p className="hud-label mb-1.5">{t("howTo.regions")}</p>
        <ul className="list-disc space-y-1 pl-5" data-testid="pdk-rules">
          {pdkRules(t).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="hud-label mb-1.5">{t("howTo.kinds")}</p>
        <dl className="space-y-1">
          {PDK_FAMILIES.map((k) => (
            <div key={k}>
              <dt className="inline font-semibold">{t("howTo.kind", { family: tb(`family.${k}`) })}</dt>
              <dd className="inline text-muted-foreground">{t(`howTo.kindList.${k}`)}</dd>
            </div>
          ))}
        </dl>
      </div>
      </div>
      </details>
    </HowToDialog>
  );
}
