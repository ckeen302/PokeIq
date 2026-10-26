import { Dex } from "@pkmn/dex";
import type { TypeName } from "@pkmn/data";
import { gens, type MonSnap } from "./model";

/**
 * What the move menu shows about a move, and how it fares against the
 * Pokémon you can see. Everything comes from the battle's own generation of
 * Showdown's data (Bite is Normal in Gen 1, Crunch is special in Gen 3, Steel
 * resists Ghost until Gen 6...).
 */

export interface MoveInfo {
  id: string;
  name: string;
  type: string;
  category: "Physical" | "Special" | "Status";
  power: number;
  accuracy: number | true;
  priority: number;
  desc: string;
  target: string;
  contact: boolean;
}

/**
 * `name` as a request or the protocol spells it. Showdown names the type of
 * Hidden Power ("Hidden Power Fire") and adds the power of moves whose power
 * depends on the Pokémon ("Hidden Power Fire 70" before Gen 6, "Return 102",
 * "Frustration 1"): that power is the one shown.
 */
export function moveInfo(name: string, gen = 9): MoveInfo {
  const dex = Dex.forGen(Math.min(9, Math.max(1, gen)));
  const exact = dex.moves.get(name);
  // "Conversion 2" is a move; "Return 102" is Return at 102 power.
  const withPower = exact.exists ? null : /^(.+?) (\d+)$/.exec(name);
  const m = withPower ? dex.moves.get(withPower[1]) : exact;
  return {
    id: m.id,
    name: m.exists ? m.name : name,
    type: m.type ?? "Normal",
    category: (m.category ?? "Status") as MoveInfo["category"],
    power: withPower ? Number(withPower[2]) : (m.basePower ?? 0),
    accuracy: m.accuracy ?? true,
    priority: m.priority ?? 0,
    desc: m.shortDesc || m.desc || "",
    target: m.target ?? "normal",
    contact: !!m.flags?.contact,
  };
}

export type Effect = "immune" | "resisted" | "neutral" | "super";

/**
 * Type effectiveness of a move against what's known of a Pokémon (its
 * revealed Tera type counts), on the generation's type chart, with the moves
 * that bend it as Showdown does: Freeze-Dry hits Water super effectively,
 * Flying Press adds Flying, and Thousand Arrows hits any Flying type
 * neutrally (whatever its other type).
 * Abilities and items (Levitate, Air Balloon...) aren't known in advance and
 * aren't counted.
 */
export function effectiveness(move: MoveInfo, foe: MonSnap | null | undefined, teraType?: string, gen = 9): Effect | null {
  if (!foe || foe.fainted || move.category === "Status" || !foe.types.length) return null;
  const type = (move.id === "terablast" && teraType ? teraType : move.type) as TypeName;
  if (type === ("Stellar" as TypeName)) return "neutral";
  const data = gens.get(Math.min(9, Math.max(1, gen)));
  const types = foe.types as TypeName[];
  try {
    if (move.id === "thousandarrows" && types.includes("Flying")) return "neutral";
    if (!data.types.canDamage(type, types)) return "immune";
    let mult = 1;
    for (const t of types) {
      mult *= move.id === "freezedry" && t === "Water" ? 2 : data.types.totalEffectiveness(type, [t]);
      if (move.id === "flyingpress") mult *= data.types.totalEffectiveness("Flying", [t]);
    }
    return mult > 1 ? "super" : mult < 1 ? "resisted" : "neutral";
  } catch {
    return null;
  }
}

/** Move targets a player picks in doubles, and where they may aim (Showdown's target locations). */
const CHOOSABLE = new Set(["normal", "any", "adjacentAlly", "adjacentAllyOrSelf", "adjacentFoe"]);

export function targetChoices(target: string | undefined, slot: number): number[] {
  if (!target || !CHOOSABLE.has(target)) return [];
  const self = -(slot + 1);
  const ally = -(2 - slot);
  if (target === "adjacentAlly") return [ally];
  if (target === "adjacentAllyOrSelf") return [self, ally];
  if (target === "adjacentFoe") return [1, 2];
  // normal and any: either foe or your partner, as on Showdown (Pollen Puff, Heal Pulse, Skill Swap or Beat Up on an ally).
  return [1, 2, ally];
}
