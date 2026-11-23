import type { Metadata } from "next";
import { PokeballMakerView, pokeballMakerMetadata } from "./view";

/**
 * /tools/pokeball-maker: the Poké Ball Maker. Built once and served from the CDN; a design link (?d=…) is rewritten
 * to ./shared (next.config), which opens the design.
 */
export function generateMetadata(): Promise<Metadata> {
  return pokeballMakerMetadata(undefined);
}

export default function Page() {
  return <PokeballMakerView raw={undefined} />;
}
