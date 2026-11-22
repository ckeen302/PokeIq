import "server-only";
import geo from "@/data/geo.json";
import { serverT } from "@/i18n/server";
import globePage from "@/messages/globe-page";
import { atlasNames } from "@/lib/dex/atlas-names";
import { dexNames, type DexNames } from "@/lib/dex/local-names";
import type { GlobeLocal } from "@/components/globe/WorldGlobe";
import type { GlobeRegionCard } from "./regions";

/**
 * The globe in another language (server only): the atlas's names, the screenshots' game labels and where each region
 * is based on, in that language, plus its region cards' games and starters. English pages get null and the cards as
 * they are.
 */

const SHOT_GAMES = [...new Set((geo as unknown as { world: { locations: { shots: { game?: string }[] }[] } }).world.locations.flatMap((l) => l.shots.map((s) => s.game ?? "")))].filter(Boolean);

/** A timeline title ("Red and Green", "Blue (Japan)", "Legends: Z-A – Mega Dimension") in the language, else as given. */
function gameTitle(names: DexNames, title: string, japan: (game: string) => string): string {
  const jp = / \(Japan\)$/.exec(title);
  if (jp) {
    const base = gameTitle(names, title.slice(0, jp.index), japan);
    return base === title.slice(0, jp.index) ? title : japan(base);
  }
  const dash = title.split(" – ");
  if (dash.length === 2) {
    const [a, b] = dash.map((p) => gameTitle(names, p, japan));
    return a !== dash[0] && b !== dash[1] ? `${a} – ${b}` : title;
  }
  const parts = title.split(" and ").map((p) => names.versionOf(p));
  if (!parts.every(Boolean)) return title;
  return names.locale === "ja" ? parts.join("・") : new Intl.ListFormat(names.locale, { type: "conjunction" }).format(parts as string[]);
}

export function globeLocal(cards: GlobeRegionCard[]): { cards: GlobeRegionCard[]; local: GlobeLocal | null } {
  const names = dexNames();
  const atlas = atlasNames();
  if (names.locale === "en" || !atlas) return { cards, local: null };
  const t = serverT(globePage);
  const japan = (game: string) => t("japan", { game });
  const all: Record<string, string> = { ...atlas };
  for (const g of SHOT_GAMES) {
    const local = names.game(g);
    if (local !== g) all[g] = local;
  }
  const origins: Record<string, string> = {};
  for (const c of cards) if (c.origin) origins[c.name] = t(`origins.${c.name}` as `origins.${keyof typeof globePage.en.origins}`);
  return {
    cards: cards.map((c) => ({
      ...c,
      origin: origins[c.name] ?? c.origin,
      games: c.games.map((g) => ({ ...g, title: gameTitle(names, g.title, japan) })),
      starters: c.starters.map((s) => ({ ...s, name: names.species(s.id, s.name) })),
    })),
    local: { names: all, origins },
  };
}
