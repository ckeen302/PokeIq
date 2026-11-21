import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import POKEDEX from "@/data/pokedex.json";
import ART from "@/data/sizes-art.json";
import DETAILS from "@/data/pokedex-details.json";
import { LabDex } from "@/components/lab-dex/LabDex";
import type { LabEntry } from "@/components/lab-dex/roster";

/**
 * MOCK (not linked anywhere): the Professor's Lab, a 3D Pokédex. A ring of
 * capsule pods round a holo-table, the selected Pokémon standing on it.
 * Built from the real /pokedex/sizes figures (HOME render on a relief mesh).
 */

export const metadata: Metadata = pageMetadata({
  title: "Professor's Lab (mock)",
  description: "A 3D Pokédex inside a research lab (design mock).",
  path: "/lab/pokedex-mock",
  noindex: true,
});

/** The wheel, in Pokédex order. */
const RING = [1, 3, 4, 5, 6, 7, 9, 25, 94, 133, 149, 150];

type Dex = { id: number; name: string; genus: string; gen: number; types: string[]; stats: Record<string, number>; bst: number; height: number; weight: number };
type Details = Record<string, { entries?: { text: string }[]; abilities?: { name: string; hidden: boolean }[] }>;

export default function Page() {
  const dex = POKEDEX as unknown as Dex[];
  const art = ART as unknown as Record<string, [number, number, number, number, number]>;
  const details = DETAILS as unknown as Details;
  const roster: LabEntry[] = RING.map((id) => {
    const p = dex.find((x) => x.id === id)!;
    const d = details[String(id)];
    return {
      id,
      name: p.name,
      genus: p.genus,
      gen: p.gen,
      types: p.types,
      stats: [p.stats.hp, p.stats.atk, p.stats.def, p.stats.spa, p.stats.spd, p.stats.spe],
      bst: p.bst,
      heightM: p.height / 10,
      weightKg: p.weight / 10,
      box: art[String(id)],
      flavor: d?.entries?.[0]?.text ?? "",
      abilities: (d?.abilities ?? []).map((a) => a.name),
    };
  });
  return <LabDex roster={roster} />;
}
