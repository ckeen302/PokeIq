import type { Metadata } from "next";
import { PokeballMakerView, one, pokeballMakerMetadata, type Query } from "../view";

/**
 * A shared design: /tools/pokeball-maker?d=… is rewritten here (next.config), so the maker's own page stays static
 * while a link renders with its design and its own preview card. The address people see keeps ?d=.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }): Promise<Metadata> {
  return pokeballMakerMetadata(one((await searchParams).d));
}

export default async function SharedPage({ searchParams }: { searchParams: Promise<Query> }) {
  return <PokeballMakerView raw={one((await searchParams).d)} />;
}
