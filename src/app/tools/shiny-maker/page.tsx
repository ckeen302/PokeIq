import type { Metadata } from "next";
import { ShinyMakerView, shinyMakerMetadata } from "./view";

/**
 * /tools/shiny-maker: the Shiny Pokémon Maker. Built once and served from the CDN; a design link (?d=…) is rewritten
 * to ./shared (next.config), which opens the design.
 */
export function generateMetadata(): Promise<Metadata> {
  return shinyMakerMetadata(undefined);
}

export default function Page() {
  return <ShinyMakerView raw={undefined} />;
}
