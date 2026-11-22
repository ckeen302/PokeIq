import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { TeamBuilder } from "@/components/battle/TeamBuilder";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import battlePages from "@/messages/battle-tools-pages";
import battleTeams from "@/messages/battle-teams";
import battleTeamInsights from "@/messages/battle-team-insights";
import battleTerms from "@/messages/battle-terms";
import battlePickers from "@/messages/battle-pickers";
import battleInputs from "@/messages/battle-inputs";

export function generateMetadata(): Metadata {
  const t = serverT(battlePages);
  return pageMetadata({
    title: t("teams.title"),
    description: t("teams.description"),
    image: SHARE_IMAGES.battle,
    path: "/battle/teams",
  });
}

export default function TeamsPage() {
  const t = serverT(battlePages);
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb={t("teams.crumb")} title={t("teams.heading")} accent={t("teams.accent")}>
        {t("teams.intro")}
      </BattleHeader>
      <ClientMessages namespaces={[battleTeams, battleTeamInsights, battleTerms, battlePickers, battleInputs]}>
        <TeamBuilder />
      </ClientMessages>
    </div>
  );
}
