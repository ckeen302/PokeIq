import type { Metadata } from "next";
import { inviteMetadata } from "@/lib/seo";
import { cache } from "react";
import { notFound } from "next/navigation";
import { GeoDuel } from "@/components/geo/GeoDuel";
import { geoRegions } from "@/lib/server/geo";
import { peekDuel } from "@/lib/server/duel-store";
import { DUEL_HP } from "@/lib/duel-types";
import { WORLD_REGION } from "@/lib/geo-types";

interface PageProps {
  params: Promise<{ code: string }>;
}

/** One read for the metadata and the page. */
const findDuel = cache(peekDuel);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const duel = await findDuel((await params).code);
  if (!duel) return inviteMetadata("A PokéGuessr duel", "GeoGuessr Duels for Pokémon: the same places for both of you, closer pin wins.");
  const [host, guest] = duel.players.map((p) => p.name);
  const map = geoRegions().find((r) => r.id === duel.region);
  const where = !map || map.id === WORLD_REGION ? "the Pokémon world" : map.name;
  const title = guest ? `${host} vs ${guest}: a PokéGuessr duel` : `${host || "A trainer"} challenges you to a PokéGuessr duel`;
  const description = `Head to head in ${where}: the same places for both of you, ${DUEL_HP.toLocaleString("en-US")} HP each, GeoGuessr Duels rules.`;
  return inviteMetadata(title, description);
}

export default async function GeoDuelPage({ params }: PageProps) {
  const { code } = await params;
  // A store hiccup isn't a missing duel: the page loads and keeps polling.
  if ((await findDuel(code)) === null) notFound();
  return <GeoDuel key={code} code={code} regions={geoRegions()} />;
}
