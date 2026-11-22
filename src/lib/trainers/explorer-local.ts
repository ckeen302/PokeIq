import "server-only";
import { serverT } from "@/i18n/server";
import trainersNs from "@/messages/trainers";
import type { DexNames } from "@/lib/dex/local-names";
import type { ExplorerLocal } from "@/components/trainers/TrainerExplorer";
import { TRAINER_GAMES, TRAINER_REGIONS, type TrainerGame } from "./games";
import { gameFile, speciesOf } from "./data";
import { tagName } from "./i18n";

/** A trainer game's title in the language ("Red & Blue" → "Rouge & Bleu"), English when a version has no official name. */
export const gameName = (names: DexNames, g: Pick<TrainerGame, "key" | "name">) =>
  names.versions(TRAINER_GAMES.find((x) => x.key === g.key)?.versions ?? [], g.name, names.locale === "ja" ? "・" : " & ");

const cache = new Map<string, ExplorerLocal>();

/**
 * What the Trainers search on a page in another language needs besides the English search index
 * (/pokedex/trainers/search-index.json): the official names of the regions, areas and Pokémon in it and its battle
 * tags, only where they differ from English. English pages send nothing.
 */
export function explorerLocal(names: DexNames): ExplorerLocal {
  let out = cache.get(names.locale);
  if (out) return out;
  const t = serverT(trainersNs);
  const regions: Record<string, string> = {};
  for (const r of TRAINER_REGIONS) if (names.region(r) !== r) regions[r] = names.region(r);
  const areas: Record<string, string> = {};
  const species: Record<string, string> = {};
  const tags: Record<string, string> = {};
  for (const g of TRAINER_GAMES) {
    const f = gameFile(g.key)!;
    for (const a of f.areas) {
      const local = names.place(a.name);
      if (local !== a.name) areas[a.name] = local;
    }
    for (const team of f.teams) {
      if (team.tag && !(team.tag in tags)) {
        const local = tagName(t, names, team.tag);
        if (local !== team.tag) tags[team.tag] = local;
      }
      for (const m of team.team) {
        if (m.s in species) continue;
        const s = speciesOf(m.s);
        const local = s && names.species(s.id, s.name);
        if (s && local !== s.name) species[m.s] = local!;
      }
    }
  }
  out = { regions, areas, species, tags };
  cache.set(names.locale, out);
  return out;
}
