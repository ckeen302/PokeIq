import { ArrowLeftRight, Bone, Egg, Fish, Footprints, Gift, Hammer, Leaf, MapPin, Mountain, Sparkles, Star, TreeDeciduous, Waves, type LucideIcon } from "lucide-react";
import type { EncounterKind } from "@/lib/nuzlocke/model";

/** The icons for how a Pokémon is met. */
export const METHOD_ICONS = { gift: Gift, trade: ArrowLeftRight, egg: Egg, fossil: Bone, roaming: Footprints, static: Star, rod: Fish, water: Waves, cave: Mountain, smash: Hammer, tree: TreeDeciduous, grass: Leaf, sparkle: Sparkles, place: MapPin } satisfies Record<string, LucideIcon>;
export type MethodIconKey = keyof typeof METHOD_ICONS;

/** Which icon a way of meeting gets: by its kind first (a gift, a trade…), else by the method's words. */
export function methodIconKey(method: string, kind: EncounterKind): MethodIconKey {
  if (kind !== "wild") return kind;
  const m = method.toLowerCase();
  if (/rod|fish/.test(m)) return "rod";
  if (/surf|water|dive|swim/.test(m)) return "water";
  if (/rock smash|smash/.test(m)) return "smash";
  if (/cave|walk|rock climb|mountain/.test(m)) return "cave";
  if (/headbutt|tree|honey/.test(m)) return "tree";
  if (/grass|tall|field|flower|wander|overworld|horde|sos|swarm|outbreak/.test(m)) return "grass";
  if (/shiny|raid|den/.test(m)) return "sparkle";
  return "place";
}

export const methodIcon = (method: string, kind: EncounterKind): LucideIcon => METHOD_ICONS[methodIconKey(method, kind)];
