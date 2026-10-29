import type { TrainerConfig } from "./config";

/**
 * Ready-made looks for the trainer creator, each based on one of the
 * series' best-known characters and labelled by its look, never by name.
 * Picking one fills every slot; anything can be changed afterwards. Every
 * preset uses free items only, so anyone can save one.
 *
 * Each spec below was written from the character's official art (sampled
 * hex in brackets, then the nearest swatch), and the build was checked
 * side by side against that art. Reference images are never shipped.
 */

export type PresetLook = Omit<TrainerConfig, "v" | "partner" | "shiny">;

export interface TrainerPreset {
  id: string;
  /** What the look is called in the creator. */
  name: string;
  look: PresetLook;
}

/** Shared defaults: every preset spells out what it changes. */
const BASE: PresetLook = {
  body: "sturdy",
  skin: "s2",
  eyes: "round",
  eyeColor: "dark",
  expr: "happy",
  hair: "short",
  bangs: "auto",
  hairColor: "black",
  hat: "none",
  hatColor: "red",
  hatTrim: "white",
  top: "tee",
  topColor: "white",
  topTrim: "white",
  accent: "white",
  closed: false,
  emblem: "none",
  bottoms: "pants",
  bottomsColor: "navy",
  bottomsTrim: "white",
  legwear: "none",
  shoes: "sneakers",
  shoesColor: "red",
  shoesTrim: "white",
  gloves: "none",
  glovesColor: "black",
  pack: "none",
  packColor: "red",
  packTrim: "red",
  cape: "none",
  capeColor: "red",
  capeTrim: "black",
  eyewear: "none",
  neck: "none",
  wrist: "none",
  hairAcc: "none",
  ears: "none",
  accColor: "black",
  ball: "poke",
  stage: "plain",
};

const look = (l: Partial<PresetLook>): PresetLook => ({ ...BASE, ...l });

export const TRAINER_PRESETS: readonly TrainerPreset[] = [
  {
    // Spec: messy black spikes poking out under the cap and at the
    // sideburns; brown eyes, open determined grin. Cap: red crown and brim
    // [#d5382b] with a white front panel and a green open-arc logo. Short
    // blue jacket [#0058b3] with white collar and cuffs, worn open over a
    // very dark green tee [#0a4036]. Green fingerless gloves [#2f9e5c],
    // light-blue jeans [#89b3dd], blue-and-white sneakers.
    id: "kanto-hero",
    name: "Kanto Hero",
    look: look({
      eyeColor: "brown",
      expr: "determined",
      hair: "spiky",
      hat: "league",
      hatColor: "red",
      hatTrim: "green",
      top: "jacket",
      topColor: "blue",
      topTrim: "white",
      accent: "forest",
      bottoms: "pants",
      bottomsColor: "denim",
      shoesColor: "blue",
      gloves: "fingerless",
      glovesColor: "green",
    }),
  },
  {
    // Spec: short black hair under a red cap [#9c433f] with a white Poké
    // Ball logo; calm, steady stare, grey eyes. Red sleeveless jacket with a
    // white collar over a black short-sleeved shirt. Blue jeans [#296884],
    // red-and-white sneakers, tan backpack [#92725d].
    id: "kanto-champion",
    name: "Kanto Champion",
    look: look({
      eyes: "focused",
      eyeColor: "grey",
      expr: "calm",
      hair: "short",
      hat: "ballcap",
      hatColor: "red",
      hatTrim: "white",
      top: "vest",
      topColor: "red",
      topTrim: "white",
      accent: "black",
      bottomsColor: "blue",
      shoesColor: "red",
      pack: "classic",
      packColor: "khaki",
      packTrim: "brown",
    }),
  },
  {
    // Spec: bright orange hair [#f47524] with a spiky side ponytail high on
    // her left; teal eyes [#5b8574], big smile. Yellow sleeveless crop top
    // [#fee677], red suspenders [#853026] over teal denim shorts, bare
    // legs, red sneakers with yellow trim.
    id: "water-leader",
    name: "Water Gym Leader",
    look: look({
      body: "slim",
      eyes: "lashes",
      eyeColor: "teal",
      hair: "sidetail",
      bangs: "parted",
      hairColor: "orange",
      top: "croptop",
      topColor: "yellow",
      topTrim: "yellow",
      bottoms: "suspenders",
      bottomsColor: "teal",
      bottomsTrim: "red",
      shoesColor: "red",
      shoesTrim: "yellow",
      accColor: "red",
    }),
  },
  {
    // Spec: dark brown upswept spikes [#3d281c], open forehead, eyes drawn
    // as narrow lines, tan skin [#dba26f]. Olive-green vest [#688f52] with
    // pockets over an orange tee [#c17d49]; brown trousers [#8b4a46]; navy
    // sneakers; a red-brown belt pouch.
    id: "rock-leader",
    name: "Rock Gym Leader",
    look: look({
      skin: "s4",
      eyes: "squint",
      expr: "calm",
      hair: "spikyup",
      hairColor: "espresso",
      top: "vest",
      topColor: "olive",
      topTrim: "olive",
      accent: "orange",
      closed: true,
      bottomsColor: "brown",
      shoesColor: "navy",
      pack: "pouch",
      packColor: "crimson",
      packTrim: "crimson",
    }),
  },
  {
    // Spec: chestnut hair [#8b4319] in long spikes swept up and back, smug
    // half-smile, dark grey eyes. Violet long-sleeved tee [#6f609c], a
    // round yellow-green pendant on a long cord, dark trousers [#2c3945],
    // green backpack [#428871].
    id: "rival",
    name: "Rival",
    look: look({
      eyes: "sharp",
      eyeColor: "grey",
      expr: "smug",
      hair: "spikyup",
      bangs: "spiky",
      hairColor: "chestnut",
      top: "longtee",
      topColor: "violet",
      topTrim: "violet",
      bottomsColor: "charcoal",
      shoesColor: "black",
      pack: "classic",
      packColor: "green",
      packTrim: "olive",
      neck: "pendant",
      accColor: "mustard",
    }),
  },
  {
    // Spec: very long blonde hair [#f6e892 / #ddc07d] to below the hips, a
    // side-swept fringe over one eye, big black hair ornaments on both
    // sides; grey eyes, calm. Long black coat [#2b2d2f] fastened at the top,
    // open below the waist, with black fur collar and cuffs; black flared
    // trousers and black heels with a gold stripe.
    id: "sinnoh-champion",
    name: "Sinnoh Champion",
    look: look({
      body: "slim",
      skin: "s1",
      eyes: "sharp",
      eyeColor: "grey",
      expr: "calm",
      hair: "flowing",
      bangs: "side",
      hairColor: "blonde",
      top: "longcoat",
      topColor: "black",
      topTrim: "black",
      accent: "charcoal",
      closed: true,
      bottoms: "flared",
      bottomsColor: "black",
      shoes: "formal",
      shoesColor: "black",
      shoesTrim: "mustard",
      hairAcc: "ornaments",
      accColor: "black",
    }),
  },
  {
    // Spec: a huge crimson-magenta mane [#8d191a] swept back into one long
    // hook; blue eyes, smug look, green drop earrings. White cropped uniform
    // jacket with a big red letter R [#e23922] on the chest over a black
    // undershirt, bare midriff, white mini skirt; dark green elbow gloves
    // and thigh-high boots [#1f4638].
    id: "rocket-agent",
    name: "Rocket Agent",
    look: look({
      body: "slim",
      skin: "s1",
      eyes: "lashes",
      eyeColor: "blue",
      expr: "smug",
      hair: "volume",
      hairColor: "magenta",
      top: "uniform",
      topColor: "white",
      topTrim: "red",
      accent: "black",
      emblem: "letter",
      bottoms: "skirt",
      bottomsColor: "white",
      bottomsTrim: "forest",
      legwear: "thigh",
      shoes: "tallboots",
      shoesColor: "forest",
      shoesTrim: "forest",
      gloves: "long",
      glovesColor: "forest",
      ears: "drops",
      accColor: "green",
    }),
  },
  {
    // Spec: long pale green hair [#afcb9a] tied loosely and flowing out
    // behind; a cap with a light grey crown and black front and brim; grey
    // eyes, calm. White shirt worn open over a black tee, beige trousers
    // [#c4b7a5], green sneakers [#577a5a], a pendant and chunky bracelets.
    id: "unova-idealist",
    name: "Unova Idealist",
    look: look({
      body: "slim",
      eyes: "sharp",
      eyeColor: "grey",
      expr: "calm",
      hair: "flowing",
      hairColor: "mint",
      hat: "twotone",
      hatColor: "white",
      hatTrim: "black",
      top: "shirt",
      topColor: "white",
      topTrim: "white",
      accent: "black",
      bottomsColor: "khaki",
      shoesColor: "olive",
      neck: "pendant",
      wrist: "bracelets",
      accColor: "mustard",
    }),
  },
  {
    // Spec: long violet hair [#6b619f] to the waist, parted fringe; tan
    // skin; gold eyes, confident grin. Black cap with a gold zigzag crown.
    // Long crimson cape [#731624] with a pale gold fur collar [#e1c48f] and
    // a checked lining; black shirt, white shorts over white leggings, black
    // high-tops with gold laces, white wristbands.
    id: "galar-champion",
    name: "Galar Champion",
    look: look({
      skin: "s4",
      eyes: "sharp",
      eyeColor: "amber",
      expr: "determined",
      hair: "flowing",
      hairColor: "violet",
      hat: "crown",
      hatColor: "black",
      hatTrim: "mustard",
      top: "tee",
      topColor: "black",
      topTrim: "crimson",
      bottoms: "shorts",
      bottomsColor: "white",
      bottomsTrim: "white",
      legwear: "tights",
      shoes: "hightops",
      shoesColor: "black",
      shoesTrim: "mustard",
      cape: "royal",
      capeColor: "crimson",
      capeTrim: "khaki",
      wrist: "bands",
      accColor: "white",
    }),
  },
  {
    // Spec: straight midnight-blue hair past the shoulders with a blunt
    // fringe; dark blue eyes, bright smile. White beanie with a pink
    // pom and pink half-ball mark; long pink scarf [#d16d72]. Black
    // sleeveless top over white; pink mini skirt [#dc9da7]; black
    // over-the-knee socks; pink boots; yellow shoulder bag.
    id: "sinnoh-coordinator",
    name: "Sinnoh Coordinator",
    look: look({
      body: "slim",
      skin: "s1",
      eyes: "lashes",
      eyeColor: "blue",
      hair: "long",
      bangs: "blunt",
      hairColor: "navy",
      hat: "beanie",
      hatColor: "white",
      hatTrim: "pink",
      top: "tank",
      topColor: "black",
      topTrim: "white",
      accent: "white",
      bottoms: "skirt",
      bottomsColor: "rose",
      bottomsTrim: "black",
      legwear: "thigh",
      shoes: "tallboots",
      shoesColor: "rose",
      shoesTrim: "white",
      pack: "shoulder",
      packColor: "mustard",
      packTrim: "mustard",
      neck: "scarf",
      accColor: "pink",
    }),
  },
  {
    // Spec: grey-brown hair [#a59a7a] standing up and swept back, open
    // forehead, heavy brows, warm grin. Long white lab coat, open, over a
    // red collared shirt [#af333b]; camel trousers [#e1a859]; brown shoes.
    id: "kanto-professor",
    name: "Kanto Professor",
    look: look({
      eyes: "focused",
      hair: "quiff",
      hairColor: "ash",
      top: "labcoat",
      topColor: "white",
      topTrim: "white",
      accent: "crimson",
      bottomsColor: "camel",
      shoes: "formal",
      shoesColor: "brown",
      shoesTrim: "brown",
    }),
  },
  {
    // Spec: ice-blue silver hair [#b1d8de] in sharp spikes swept back with a
    // lock over the brow; light blue eyes, slight smile. Dark suit jacket
    // [#3e3b44] with silver lapel pins over a white shirt and a crimson
    // cravat [#af6671]; dark grey trousers [#4e5355]; black dress shoes.
    id: "hoenn-champion",
    name: "Hoenn Champion",
    look: look({
      body: "slim",
      eyes: "sharp",
      eyeColor: "ice",
      expr: "smug",
      hair: "quiff",
      bangs: "side",
      hairColor: "ice",
      top: "suit",
      topColor: "charcoal",
      topTrim: "grey",
      accent: "white",
      bottomsColor: "charcoal",
      shoes: "formal",
      shoesColor: "black",
      shoesTrim: "black",
      neck: "cravat",
      accColor: "crimson",
    }),
  },
  {
    // Spec: long honey-blonde hair [#cdb081], loose waves; blue-grey eyes,
    // open smile. Pinkish-red hat [#ab545b] with a black band and white
    // sunglasses resting on it. Black sleeveless top, high-waisted red
    // pleated skirt [#b44632], dark grey thigh-highs, black boots, a pink
    // shoulder bag.
    id: "kalos-performer",
    name: "Kalos Performer",
    look: look({
      body: "slim",
      skin: "s1",
      eyes: "lashes",
      eyeColor: "ice",
      hair: "long",
      bangs: "parted",
      hairColor: "honey",
      hat: "sunhat",
      hatColor: "cherry",
      hatTrim: "black",
      top: "tank",
      topColor: "black",
      topTrim: "black",
      accent: "black",
      bottoms: "skirt",
      bottomsColor: "red",
      bottomsTrim: "charcoal",
      legwear: "thigh",
      shoes: "hightops",
      shoesColor: "black",
      shoesTrim: "rose",
      pack: "shoulder",
      packColor: "cherry",
      packTrim: "cherry",
      eyewear: "sunglasses",
      accColor: "white",
    }),
  },
  {
    // Spec: spiky red hair [#c94a4a] swept up and back; brown eyes, fierce
    // shout. Long black cape with a tall standing collar and a crimson
    // lining [#94384d]; navy bodysuit [#35476b] with orange piping and
    // stripes; black knee boots with orange bands.
    id: "dragon-master",
    name: "Dragon Master",
    look: look({
      eyes: "sharp",
      eyeColor: "brown",
      expr: "determined",
      hair: "spikyup",
      hairColor: "red",
      top: "longtee",
      topColor: "navy",
      topTrim: "orange",
      bottoms: "joggers",
      bottomsColor: "navy",
      bottomsTrim: "orange",
      shoes: "tallboots",
      shoesColor: "black",
      shoesTrim: "orange",
      cape: "collar",
      capeColor: "black",
      capeTrim: "crimson",
    }),
  },
  {
    // Spec: black bob [#2a2a29] with a blunt fringe and two little tufts on
    // top tied with dark red ribbons; teal eyes, cool and calm; a choker.
    // Black studded jacket, open, over a pink dress [#f2a1a1]; black boots
    // with pink trim.
    id: "spikemuth-rival",
    name: "Spikemuth Rival",
    look: look({
      body: "slim",
      skin: "s1",
      eyes: "lashes",
      eyeColor: "teal",
      expr: "calm",
      hair: "bob",
      bangs: "blunt",
      top: "jacket",
      topColor: "black",
      topTrim: "grey",
      accent: "rose",
      bottoms: "skirt",
      bottomsColor: "rose",
      shoes: "boots",
      shoesColor: "black",
      shoesTrim: "rose",
      hairAcc: "ribbons",
      neck: "choker",
      accColor: "crimson",
    }),
  },
];

/** A preset as a full trainer, keeping the account's partner Pokémon. */
export function presetTrainer(preset: TrainerPreset, partner = 25, shiny = false): TrainerConfig {
  return { v: 2, ...preset.look, partner, shiny };
}

/** Which preset this trainer is exactly (ignoring partner and stage), if any. */
export function matchPreset(t: TrainerConfig): TrainerPreset | undefined {
  return TRAINER_PRESETS.find((p) => (Object.keys(p.look) as (keyof PresetLook)[]).every((k) => k === "stage" || p.look[k] === t[k]));
}
