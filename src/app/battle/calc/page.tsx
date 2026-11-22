import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import battleCalc from "@/messages/battle-calc";
import battleTerms from "@/messages/battle-terms";
import battlePickers from "@/messages/battle-pickers";
import battleInputs from "@/messages/battle-inputs";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { DamageCalc } from "@/components/battle/DamageCalc";

export function generateMetadata(): Metadata {
  const t = serverT(battleCalc);
  return pageMetadata({
    title: t("page.metaTitle"),
    description: t("page.metaDescription"),
    image: SHARE_IMAGES.battle,
    path: "/battle/calc",
  });
}

export default function CalcPage() {
  const t = serverT(battleCalc);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <BattleHeader crumb={t("page.crumb")} title={t("page.title")} accent={t("page.accent")} compact>
        {t("page.intro")}
      </BattleHeader>
      <ClientMessages namespaces={[battleCalc, battleTerms, battlePickers, battleInputs]}>
        <DamageCalc />
      </ClientMessages>
    </div>
  );
}
