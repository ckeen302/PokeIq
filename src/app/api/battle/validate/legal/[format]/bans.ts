import "server-only";
import { TeamValidator } from "pokemon-showdown";
import type { FormatBans } from "@/lib/battle/dex";
import type { BattleFormatId } from "@/lib/battle/formats";

/**
 * What a format bans outright, straight from Pokémon Showdown's validator:
 * each species through its own checkSpecies (tiers, clauses, Mythicals…),
 * and each move, item and ability through the format's rule table. Reasons
 * are the validator's own wording. The team check still runs the full
 * validator; this only lets the search mark and filter banned picks.
 */
export function formatBans(format: BattleFormatId): FormatBans {
  const v = TeamValidator.get(format);
  const out: FormatBans = { species: {}, moves: {}, items: {}, abilities: {} };
  for (const s of v.dex.species.all()) {
    if (!s.exists || s.battleOnly || s.num <= 0) continue;
    try {
      const problem = v.checkSpecies({ name: s.name, species: s.name, ability: "", item: "", moves: [] } as never, s, s, {});
      // "Mewtwo (Mewtwo) is tagged Uber, which is banned." -> "tagged Uber, which is banned"
      if (problem && !/does not exist|placeholder/.test(problem)) out.species[s.id] = problem.replace(/^.*? is /, "").replace(/\.$/, "");
    } catch {
      // A species the validator can't read is left to the full team check.
    }
  }
  const rule = (kind: "move" | "item" | "ability", id: string) => v.ruleTable.check(`${kind}:${id}`);
  for (const m of v.dex.moves.all()) {
    const r = rule("move", m.id);
    if (r) out.moves[m.id] = r;
  }
  for (const i of v.dex.items.all()) {
    const r = rule("item", i.id);
    if (r) out.items[i.id] = r;
  }
  for (const a of v.dex.abilities.all()) {
    const r = rule("ability", a.id);
    if (r) out.abilities[a.id] = r;
  }
  return out;
}
