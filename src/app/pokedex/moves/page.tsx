import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { MOVES } from "@/lib/dex/data";
import { DexListExplorer } from "@/components/pokedex/DexListExplorer";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Moves — Power, Accuracy, PP & Who Learns Them",
  description: "Every Pokémon move with type, category, power, accuracy and PP. Filter by type and category, then see which Pokémon learn each one.",
  path: "/pokedex/moves",
});

export default function MovesPage() {
  const items = MOVES.map((m) => ({ slug: m.slug, name: m.name, type: m.type, cls: m.cls, power: m.power, accuracy: m.accuracy, pp: m.pp }));
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader
        kicker={`Move database · ${items.length.toLocaleString("en-US")} entries`}
        title="Poké"
        accent="dex"
        blurb={`All ${items.length.toLocaleString("en-US")} moves — type, category, power, accuracy, PP and the Pokémon that learn them.`}
      />
      <DexTabs active="moves" />
      <DexListExplorer kind="moves" items={items} />
    </div>
  );
}
