import { ArrowLeftRight, Bone, Egg, Fish, Footprints, Gift, Hammer, Leaf, MapPin, Mountain, Sparkles, Star, TreeDeciduous, Waves, type LucideIcon } from "lucide-react";
import type { EncounterKind } from "@/lib/nuzlocke/model";

/** An icon for how a Pokémon is met: by its kind first (a gift, a trade…), else by the method's words. */
export function methodIcon(method: string, kind: EncounterKind): LucideIcon {
  if (kind === "gift") return Gift;
  if (kind === "trade") return ArrowLeftRight;
  if (kind === "egg") return Egg;
  if (kind === "fossil") return Bone;
  if (kind === "roaming") return Footprints;
  if (kind === "static") return Star;
  const m = method.toLowerCase();
  if (/rod|fish/.test(m)) return Fish;
  if (/surf|water|dive|swim/.test(m)) return Waves;
  if (/cave|walk|rock climb|mountain/.test(m)) return Mountain;
  if (/rock smash|smash/.test(m)) return Hammer;
  if (/headbutt|tree|honey/.test(m)) return TreeDeciduous;
  if (/grass|tall|field|flower|wander|overworld|horde|sos|swarm|outbreak/.test(m)) return Leaf;
  if (/shiny|raid|den/.test(m)) return Sparkles;
  return MapPin;
}
