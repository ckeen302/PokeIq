import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { TournamentLobby } from "@/components/tournaments/TournamentLobby";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import battlePages from "@/messages/battle-tools-pages";
import battleTournaments from "@/messages/battle-tournaments";

export function generateMetadata(): Metadata {
  const t = serverT(battlePages);
  return pageMetadata({
    title: t("tournaments.title"),
    description: t("tournaments.description"),
    path: "/battle/tournaments",
    image: SHARE_IMAGES.battle,
  });
}

export default function TournamentsPage() {
  const t = serverT(battlePages);
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <BattleHeader crumb={t("tournaments.crumb")} title={t("tournaments.heading")} accent={t("tournaments.accent")}>
        {t("tournaments.intro")}
      </BattleHeader>
      <ClientMessages namespaces={[battleTournaments]}>
        <TournamentLobby />
      </ClientMessages>
    </div>
  );
}
