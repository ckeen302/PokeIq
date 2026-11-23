import type { Metadata } from "next";
import { MASS_BATTLE_PATH } from "@/lib/mass-battle/share";
import { MassBattleView, massBattleMetadata, type MassBattleQuery } from "../view";
import { alt, contentType, size } from "../opengraph-image";

/**
 * A shared battle, question or playback: /lab/mass-battle?b=… (or ?ask=, ?v=) is rewritten here (next.config), so the
 * Lab's own page stays static while a link renders with its battle and its own preview card. The address keeps the query.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<MassBattleQuery> }): Promise<Metadata> {
  const meta = massBattleMetadata(await searchParams);
  if (meta.openGraph?.images) return meta;
  // A link whose battle doesn't read (or a playback on its own) shows the Lab's own card, as it did when this was the
  // Lab's page: the card file of /lab/mass-battle doesn't carry over to a route of its own.
  const card = { url: `${MASS_BATTLE_PATH}/opengraph-image`, alt, type: contentType, ...size };
  return { ...meta, openGraph: { ...meta.openGraph, images: [card] }, twitter: { ...meta.twitter, images: [card] } };
}

export default async function SharedPage({ searchParams }: { searchParams: Promise<MassBattleQuery> }) {
  return <MassBattleView sp={await searchParams} />;
}
