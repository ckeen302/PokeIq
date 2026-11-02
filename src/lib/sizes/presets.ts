import { bySize, type SizeItem } from "./types";

/**
 * The ready-made lineups on /pokedex/sizes. Each has its own page
 * (/pokedex/sizes/<id>, with a preview card) and a hook title for videos.
 * The real-world references join every lineup they fit in (from half the
 * smallest figure to twice the largest); the adult human always stands in
 * the line so every lineup has a familiar scale.
 */

export interface SizePreset {
  id: string;
  label: string;
  /** Page title and the video's hook card. */
  title: string;
  hook: string;
  blurb: string;
  pick(i: SizeItem): boolean;
}

/** Starter lines: the 27 first-stage starters (Bulbasaur to Quaxly) and their evolutions. */
export const STARTER_BASES = [1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912] as const;
const EEVEE_CHAIN_SPECIES = 133;

/** The house reference's documented height (sizes-refs.json "house"). */
export const HOUSE_M = 6.2;
/** The phone reference's documented height (sizes-refs.json "phone"). */
export const PHONE_M = 0.1476;

const isMon = (i: SizeItem) => i.kind === "pokemon";

export const PRESETS: SizePreset[] = [
  {
    id: "every-pokemon",
    label: "Every Pokémon",
    title: "Every Pokémon by size",
    hook: "Every Pokémon by size 😳",
    blurb: "All 1,025 Pokémon in one line, from 0.1 m to Eternamax Eternatus at 100 m.",
    pick: (i) => isMon(i) || i.kind === "eternamax",
  },
  {
    id: "legendaries",
    label: "Legendaries & Mythicals",
    title: "Every Legendary and Mythical Pokémon by size",
    hook: "Every Legendary Pokémon by size 😳",
    blurb: "Every Legendary and Mythical Pokémon side by side, ending with Eternamax Eternatus.",
    pick: (i) => (isMon(i) && (i.legendary || i.mythical)) || i.kind === "eternamax",
  },
  {
    id: "starters",
    label: "Starters",
    title: "Every starter Pokémon by size",
    hook: "Every starter Pokémon by size 🔥💧🌿",
    blurb: "All 27 starter lines, Bulbasaur to Quaquaval, from first stage to final evolution.",
    pick: (i) => isMon(i) && STARTER_CHAINS.has(i.chain),
  },
  {
    id: "eeveelutions",
    label: "Eeveelutions",
    title: "Eevee and every Eeveelution by size",
    hook: "Every Eeveelution by size ✨",
    blurb: "Eevee and its eight evolutions, Vaporeon to Sylveon.",
    pick: (i) => isMon(i) && i.chain === EEVEE_CHAIN,
  },
  {
    id: "gen-1",
    label: "Gen 1",
    title: "Every Generation I Pokémon by size",
    hook: "All 151 Gen 1 Pokémon by size 😳",
    blurb: "The original 151, from Diglett to Onix.",
    pick: (i) => isMon(i) && i.gen === 1,
  },
  {
    id: "gigantamax",
    label: "Gigantamax",
    title: "Every Gigantamax Pokémon by size",
    hook: "Every Gigantamax Pokémon by size 😳",
    blurb: "Every Gigantamax form at its Pokédex height (each a minimum), with Eternamax Eternatus at the end.",
    pick: (i) => i.kind === "gmax" || i.kind === "eternamax",
  },
  {
    id: "bigger-than-a-house",
    label: "Bigger than a house",
    title: "Pokémon bigger than a house",
    hook: "Pokémon bigger than a house 🏠",
    blurb: `Every Pokémon over ${HOUSE_M} m, the height of a two-storey house.`,
    pick: (i) => isMon(i) && i.m > HOUSE_M,
  },
  {
    id: "smaller-than-your-phone",
    label: "Smaller than your phone",
    title: "Pokémon smaller than your phone",
    hook: "Pokémon smaller than your phone 📱",
    blurb: "Every Pokémon shorter than a smartphone (an iPhone 16 is 147.6 mm).",
    pick: (i) => isMon(i) && i.m < PHONE_M,
  },
];

// Filled by `bindPresets` (it needs the evolution chain ids, which live with the data).
let STARTER_CHAINS = new Set<number>();
let EEVEE_CHAIN = -1;

/** Resolves the chain-based presets against the item list (call once with every item). */
export function bindPresets(all: SizeItem[]) {
  STARTER_CHAINS = new Set(all.filter((i) => i.kind === "pokemon" && (STARTER_BASES as readonly number[]).includes(i.species)).map((i) => i.chain));
  EEVEE_CHAIN = all.find((i) => i.kind === "pokemon" && i.species === EEVEE_CHAIN_SPECIES)?.chain ?? -1;
}

export const DEFAULT_PRESET = PRESETS[0];
export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

/** References that fit a lineup: the human always; the others from half the smallest figure to twice the largest. */
export function refsFor(figures: SizeItem[], all: SizeItem[], presetId?: string): SizeItem[] {
  if (!figures.length) return [];
  const lo = Math.min(...figures.map((f) => f.m)) / 2;
  const hi = Math.max(...figures.map((f) => f.m)) * 2;
  return all.filter((i) => {
    if (i.kind !== "ref") return false;
    if (i.ref?.presets) return !!presetId && i.ref.presets.includes(presetId);
    if (i.ref?.kind === "human") return true;
    return i.m >= lo && i.m <= hi;
  });
}

/** A preset's line: its figures plus the references that fit, small to large. */
export function presetLineup(preset: SizePreset, all: SizeItem[]): SizeItem[] {
  bindPresets(all);
  const figures = all.filter(preset.pick);
  return [...figures, ...refsFor(figures, all, preset.id)].sort(bySize);
}

/** A comparison's line: the chosen figures (in size order) plus the human. */
export function compareLineup(chosen: SizeItem[], all: SizeItem[]): SizeItem[] {
  const human = all.filter((i) => i.ref?.kind === "human");
  return [...chosen, ...human].sort(bySize);
}

/** Pokémon the camera pauses on as it passes (when they are in the line). */
export const MILESTONES = ["pikachu", "snorlax", "onix", "wailord", "eternatus"] as const;
/** The finale of the full line. */
export const FINALE = "eternatus-eternamax";
