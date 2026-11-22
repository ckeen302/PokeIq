import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { BattleSetup, type Opponent } from "@/components/battle/BattleSetup";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pagesNs from "@/messages/battle-pages";
import setupNs from "@/messages/battle-setup";
import formatsNs from "@/messages/battle-formats";
import teamPickNs from "@/messages/battle-team-pick";
import rulesNs from "@/messages/battle-rules";
import pickersNs from "@/messages/battle-pickers";

export function generateMetadata(): Metadata {
  const t = serverT(pagesNs);
  return pageMetadata({
    title: t("play.meta.title"),
    description: t("play.meta.description"),
    image: SHARE_IMAGES.battle,
    path: "/battle/play",
  });
}

export default async function BattlePlayPage({ searchParams }: { searchParams: Promise<{ vs?: string; challenge?: string }> }) {
  const { vs, challenge } = await searchParams;
  const t = serverT(pagesNs);
  // ?vs=anyone opens on "Find an opponent", ?vs=friend on the invite link.
  const friend = challenge && /^[A-Za-z0-9_-]{3,20}$/.test(challenge) ? challenge : undefined;
  const opening: Opponent = friend || vs === "friend" ? "pvp" : vs === "anyone" ? "match" : "cpu";
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb={t("play.crumb")} title={t("play.title")} accent={t("play.accent")}>
        {t("play.intro")}
      </BattleHeader>
      <ClientMessages namespaces={[setupNs, formatsNs, teamPickNs, rulesNs, pickersNs]}>
        <BattleSetup initial={opening} challenge={friend} />
      </ClientMessages>
    </div>
  );
}
