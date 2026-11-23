import type { Metadata } from "next";
import { MassBattleView, massBattleMetadata, type MassBattleQuery } from "../view";

/**
 * A shared battle, question or playback: /lab/mass-battle?b=… (or ?ask=, ?v=) is rewritten here (next.config), so the
 * Lab's own page stays static while a link renders with its battle and its own preview card. The address keeps the query.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<MassBattleQuery> }): Promise<Metadata> {
  return massBattleMetadata(await searchParams);
}

export default async function SharedPage({ searchParams }: { searchParams: Promise<MassBattleQuery> }) {
  return <MassBattleView sp={await searchParams} />;
}
