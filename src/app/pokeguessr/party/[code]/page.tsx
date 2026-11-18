import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { inviteMetadata } from "@/lib/seo";
import { GeoParty } from "@/components/geo/GeoParty";
import { geoRegions } from "@/lib/server/geo";
import { peekParty } from "@/lib/server/geo-party";
import { PARTY_MODE_NAMES } from "@/lib/geo-party";
import { WORLD_REGION } from "@/lib/geo-types";

interface PageProps {
  params: Promise<{ code: string }>;
}

const findParty = cache(peekParty);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const party = await findParty((await params).code);
  if (!party) return inviteMetadata("A PokéGuessr party", "GeoGuessr for Pokémon with your friends: Battle Royale and team duels, everyone on the same places.");
  const host = party.players.find((p) => p.id === party.hostId)?.name ?? "A trainer";
  const map = geoRegions().find((r) => r.id === party.settings.region);
  const where = !map || map.id === WORLD_REGION ? "the Pokémon world" : map.name;
  return inviteMetadata(`${host} invites you to a PokéGuessr party`, `${PARTY_MODE_NAMES[party.settings.mode]} in ${where}: everyone gets the same places. ${party.players.length} trainer${party.players.length === 1 ? "" : "s"} in the room.`);
}

export default async function GeoPartyPage({ params }: PageProps) {
  const { code } = await params;
  if ((await findParty(code)) === null) notFound();
  return <GeoParty key={code} code={code} regions={geoRegions()} />;
}
