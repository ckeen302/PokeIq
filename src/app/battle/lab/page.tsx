import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GameJsonLd } from "@/components/seo/GameJsonLd";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { BattleLab } from "@/components/battle/lab/BattleLab";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import battlePages from "@/messages/battle-tools-pages";
import battleTeams from "@/messages/battle-teams";
import battleTerms from "@/messages/battle-terms";
import battlePickers from "@/messages/battle-pickers";
import battleLab from "@/messages/battle-lab";
import battleLabCharts from "@/messages/battle-lab-charts";
import battleInputs from "@/messages/battle-inputs";

export function generateMetadata(): Metadata {
  const t = serverT(battlePages);
  return pageMetadata({
    title: t("lab.title"),
    description: t("lab.description"),
    path: "/battle/lab",
  });
}

export default function LabPage() {
  const t = serverT(battlePages);
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb={t("lab.crumb")} title={t("lab.heading")} accent={t("lab.accent")}>
        {t("lab.intro")}
      </BattleHeader>
      <ClientMessages namespaces={[battleLab, battleLabCharts, battleTeams, battleTerms, battlePickers, battleInputs]}>
        <BattleLab />
      </ClientMessages>
      {/* Last: an invisible <script> first in a spaced stack would push the header down. */}
      <GameJsonLd name={t("lab.name")} path="/battle/lab" description={t("lab.description")} />
    </div>
  );
}
