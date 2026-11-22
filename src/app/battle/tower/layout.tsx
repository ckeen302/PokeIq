import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GameJsonLd } from "@/components/seo/GameJsonLd";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { RouteSlot } from "@/components/layout/RouteSlot";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pagesNs from "@/messages/battle-pages";
import frontierNs from "@/messages/battle-frontier";
import formatsNs from "@/messages/battle-formats";
import teamPickNs from "@/messages/battle-team-pick";
import pickersNs from "@/messages/battle-pickers";
import battleTeams from "@/messages/battle-teams";
import battleTeamInsights from "@/messages/battle-team-insights";
import battleTerms from "@/messages/battle-terms";
import battleInputs from "@/messages/battle-inputs";

export function generateMetadata(): Metadata {
  const t = serverT(pagesNs);
  return pageMetadata({
    title: t("tower.meta.title"),
    description: t("tower.description"),
    path: "/battle/tower",
  });
}

export default function BattleTowerLayout({ children }: { children: React.ReactNode }) {
  const t = serverT(pagesNs);
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <GameJsonLd name={t("tower.name")} path="/battle/tower" description={t("tower.description")} />
      <BattleHeader crumb={t("tower.name")} title={t("tower.title")} accent={t("tower.accent")}>
        {t("tower.intro")}
      </BattleHeader>
      {/* The page is a client component (its start panel is a render prop): its words come from here. */}
      <ClientMessages namespaces={[frontierNs, formatsNs, teamPickNs, pickersNs, battleTeams, battleTeamInsights, battleTerms, battleInputs]}>
        <RouteSlot>{children}</RouteSlot>
      </ClientMessages>
    </div>
  );
}
