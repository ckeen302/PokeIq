import type { Metadata } from "next";
import { GEO_GAME_NAMESPACES } from "@/lib/geo-namespaces";
import { cache } from "react";
import { notFound } from "next/navigation";
import { inviteMetadata } from "@/lib/seo";
import { GeoParty } from "@/components/geo/GeoParty";
import { geoRegions } from "@/lib/server/geo";
import { peekParty } from "@/lib/server/geo-party";
import { WORLD_REGION } from "@/lib/geo-types";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import { guessrDuelNames } from "@/lib/server/guessr-duel-names";
import { mapName } from "@/components/geo/duel-names";
import page from "@/messages/guessr-duel-page";
import party from "@/messages/guessr-party";
import hud from "@/messages/guessr-hud";
import duelShared from "@/messages/duel";
import tier from "@/messages/tier";

interface PageProps {
  params: Promise<{ code: string }>;
}

const findParty = cache(peekParty);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const url = `/pokeguessr/party/${encodeURIComponent((await params).code)}`;
  const t = serverT(page);
  const found = await findParty((await params).code);
  if (!found) return inviteMetadata(t("party.fallbackTitle"), t("party.fallbackDescription"), url);
  const host = found.players.find((p) => p.id === found.hostId)?.name ?? t("party.aTrainer");
  const regions = geoRegions();
  const map = regions.find((r) => r.id === found.settings.region);
  const where = !map || map.id === WORLD_REGION ? t("where") : mapName(map, guessrDuelNames(regions));
  return inviteMetadata(t("party.title", { host }), t("party.description", { mode: t(`party.modes.${found.settings.mode}`), where, n: found.players.length }), url);
}

export default async function GeoPartyPage({ params }: PageProps) {
  const { code } = await params;
  if ((await findParty(code)) === null) notFound();
  const regions = geoRegions();
  const names = guessrDuelNames(regions);
  return (
    <ClientMessages namespaces={[party, hud, duelShared, tier, ...GEO_GAME_NAMESPACES]}>
      <GeoParty key={code} code={code} regions={regions} {...(names ? { names } : {})} />
    </ClientMessages>
  );
}
