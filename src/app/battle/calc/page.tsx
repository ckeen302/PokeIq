import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { DamageCalc } from "@/components/battle/DamageCalc";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import battlePages from "@/messages/battle-tools-pages";
import battleCalc from "@/messages/battle-calc";
import battleTerms from "@/messages/battle-terms";
import battlePickers from "@/messages/battle-pickers";
import battleInputs from "@/messages/battle-inputs";

export function generateMetadata(): Metadata {
  const t = serverT(battlePages);
  return pageMetadata({
    title: t("calc.title"),
    description: t("calc.description"),
    image: SHARE_IMAGES.battle,
    path: "/battle/calc",
  });
}

export default function CalcPage() {
  const t = serverT(battlePages);
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb={t("calc.crumb")} title={t("calc.heading")} accent={t("calc.accent")}>
        {t("calc.intro")}
      </BattleHeader>
      <ClientMessages namespaces={[battleCalc, battleTerms, battlePickers, battleInputs]}>
        <DamageCalc />
      </ClientMessages>
    </div>
  );
}
