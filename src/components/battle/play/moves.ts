import { Dex } from "@pkmn/dex";
import type { TypeName } from "@pkmn/data";
import { gen9, type MonSnap } from "./model";

/** What the move menu shows about a move, and how it fares against the Pokémon you can see. */

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

export function moveInfo(name: string): MoveInfo {
  const m = Dex.moves.get(name);
  return {
    id: m.id,
    name: m.name || name,
    type: m.type ?? "Normal",
    category: (m.category ?? "Status") as MoveInfo["category"],
    power: m.basePower ?? 0,
    accuracy: m.accuracy ?? true,
    priority: m.priority ?? 0,
    desc: m.shortDesc || m.desc || "",
    target: m.target ?? "normal",
    contact: !!m.flags?.contact,
  };
}

export type Effect = "immune" | "resisted" | "neutral" | "super";

/** Type effectiveness of a move against what's known of a Pokémon (its revealed Tera type counts). */
export function effectiveness(move: MoveInfo, foe: MonSnap | null | undefined, teraType?: string): Effect | null {
  if (!foe || foe.fainted || move.category === "Status" || !foe.types.length) return null;
  const type = (move.id === "terablast" && teraType ? teraType : move.type) as TypeName;
  if (type === ("Stellar" as TypeName)) return "neutral";
  try {
    if (!gen9.types.canDamage(type, foe.types as TypeName[])) return "immune";
    const mult = gen9.types.totalEffectiveness(type, foe.types as TypeName[]);
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
  // normal, any, adjacentFoe: either foe (aiming "any" at your partner is legal but never wanted).
  return [1, 2];
}
