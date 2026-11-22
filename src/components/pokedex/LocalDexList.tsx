import { getLocale, serverT } from "@/i18n/server";
import dexRef from "@/messages/dex-ref";
import { ABILITIES, ITEMS, MOVES } from "@/lib/dex/data";
import { dexLocal, itemCategory } from "@/lib/dex/local";
import { DexListExplorer, type AbilityListItem, type ItemListItem, type MoveListItem } from "./DexListExplorer";

/**
 * The Moves / Abilities / Items explorer on a page in another language: the same entries, in the same order, with
 * the language's official names (the English name, and rōmaji in Japanese, as search aliases), its in-game
 * descriptions and the types' names. Only that language's words reach the browser; English pages render
 * DexListExplorer with the records as they are.
 */
export async function LocalDexList({ kind }: { kind: "moves" | "abilities" | "items" }) {
  const L = await dexLocal(getLocale());
  if (kind === "moves") {
    const items: MoveListItem[] = MOVES.map((m) => {
      const name = L.move(m.name);
      return { slug: m.slug, name, type: m.type, cls: m.cls, power: m.power, accuracy: m.accuracy, pp: m.pp, aliases: L.aliases(name, m.name) };
    });
    return <DexListExplorer kind="moves" items={items} typeNames={L.types()} />;
  }
  if (kind === "abilities") {
    const items: AbilityListItem[] = ABILITIES.map((a) => {
      const name = L.ability(a.name);
      return { slug: a.slug, name, effect: L.abilityText(a.slug) ?? "", count: a.holders.length, aliases: L.aliases(name, a.name) };
    });
    return <DexListExplorer kind="abilities" items={items} />;
  }
  const t = serverT(dexRef);
  const items: ItemListItem[] = ITEMS.map((i) => {
    const name = L.item(i.name);
    return { slug: i.slug, name, category: itemCategory(t, i.category), aliases: L.aliases(name, i.name) };
  });
  return <DexListExplorer kind="items" items={items} />;
}
