// MOCK ONLY: three directions for the Shiny Pokémon Maker, for review (?v=a|b|c, &pop=1 opens the colour popover).
import type { Metadata } from "next";
import { ShinyMakerMock, type Direction } from "@/components/tools/mock/ShinyMakerMock";

export const metadata: Metadata = {
  title: "Shiny Pokémon Maker",
  description: "Design your own shiny Pokémon: pick a Pokémon, colour its parts and share it.",
  robots: { index: false },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ v?: string; pop?: string }> }) {
  const { v, pop } = await searchParams;
  const direction: Direction = v === "b" || v === "c" ? v : "a";
  return <ShinyMakerMock direction={direction} popover={pop === "1"} />;
}
