import { FACTS, type Facts } from "./facts";
import type { Category } from "./categories";

/**
 * PokéConnections' name-wordplay categories: purple and blue groups that
 * are about what a Pokémon's NAME contains. Every test is a plain string
 * check over the name's letters, so each answer is provable from the name
 * alone. A group's `guard` is a wider list than its `test` (more colours,
 * more body parts, more small words), so no tile elsewhere in the puzzle
 * can pass on a technicality.
 */

/** A name's letters only, lower case ("Mr. Mime" -> "mrmime"). */
export const lettersOf = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

/** The earliest hidden word (the longest at that spot), or null. */
function findHidden(name: string, words: readonly string[]): { word: string; at: number } | null {
  const l = lettersOf(name);
  let best: { word: string; at: number } | null = null;
  for (const w of words) {
    const at = l.indexOf(w);
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && w.length > best.word.length)) best = { word: w, at };
  }
  return best;
}

/** "Ch[arm]ander": the name with the hidden word marked. */
function marked(name: string, hit: { word: string; at: number }): string {
  if (lettersOf(name).length !== name.length) return `“${hit.word}” in ${name}`;
  return `${name.slice(0, hit.at)}[${name.slice(hit.at, hit.at + hit.word.length)}]${name.slice(hit.at + hit.word.length)}`;
}

// --- Colours -----------------------------------------------------------------

/** The colour words a name must hide (Loudred, Goldeen, Roselia, Vileplume, Crustle...). */
export const COLOUR_WORDS = ["red", "gold", "rose", "plum", "rust"] as const;
/** Every colour a name may NOT hide if it's meant to be outside the group. */
const COLOUR_GUARD = [...COLOUR_WORDS, "blue", "green", "black", "white", "pink", "silver", "yellow", "orange", "purple", "violet", "brown", "gray", "grey", "tan", "ash", "sand", "mint", "cream", "lime", "jade", "ruby", "coral", "amber", "olive", "navy", "teal", "cyan", "peach", "ivory"];

// --- Body parts ---------------------------------------------------------------

/** Body-part words a name must hide (Charmander: arm; Politoed: toe; Cubone: bone). */
export const BODY_WORDS = ["arm", "toe", "head", "ear", "leg", "eye", "foot", "hand", "nose", "tail", "wing", "fin", "horn", "claw", "lip", "hip", "chin", "shin", "bone", "rib", "knee", "neck", "back", "palm", "skin", "heel", "thumb", "tooth", "mouth", "face", "belly", "brow", "hair", "fang"];
const BODY_GUARD = [...BODY_WORDS, "lung", "gum", "jaw", "nail", "vein", "ankle", "calf", "thigh", "skull", "tongue", "beak", "paw", "fist", "heart", "brain", "wrist", "elbow", "shoulder", "waist", "chest", "limb"];

// --- Everyday words -------------------------------------------------------------

/** The everyday words (four letters or more) a name must be, or start with. */
export const WORDS = ["slow", "bell", "star", "horse", "king", "magma", "steel", "torch", "dust", "wing", "hunt", "dusk", "shield", "mime", "leaf", "dark", "cotton", "lamp", "bear", "frog", "claw", "crab", "rock", "wool", "bolt", "coal", "apple", "bomb", "char", "sand", "shell", "spin", "trap", "gloom"];
/** Plus every shorter or other small word a name must not start with if it's meant to be outside the group. */
const WORD_GUARD = [
  ...WORDS,
  ..."cat bee rat pin bag ray pig saw axe hat cut ink mud ant bat bug dog owl ape ash elm oak hen egg ice sun sea sky web net fox ram elk cow".split(" "),
  ..."fire hawk stone snow rain wind moon light fish bird wolf bull lion tiger mouse toad duck swan wasp worm root seed flower wood vine grass iron bone skull ghost shadow night dawn storm thunder spark flash shock flame ember blaze wave tide drop splash bubble dive swim swing swift quick fast heavy tough hard soft sweet sour salt pepper honey sugar candy cake bread berry peach plum cherry melon lemon bean corn rice milk cream ball drum horn crown ring pearl tail fang sting needle thorn fern moss spore dirt cloud mist frost hail cold burn lava smoke whirl roll gust breeze clown dance song tune beat drill hammer slash punch kick hop jump run walk dash rush chase silk thread sheep goat deer buck hare rabbit mole seal whale shark eel snake lizard gator turtle crow raven dove robin finch".split(" "),
];

/** The longest of `words` the name equals or starts with. */
function startsWithWord(name: string, words: readonly string[]): string | null {
  const l = lettersOf(name);
  let best: string | null = null;
  for (const w of words) if (l.startsWith(w) && (!best || w.length > best.length)) best = w;
  return best;
}

// --- Rhymes -------------------------------------------------------------------

/** Every 3 or 4 letter name ending shared by at least five evolution families (the rest fail MIN_MEMBERS anyway). */
function rhymeEndings(skip: ReadonlySet<string>): string[] {
  const families = new Map<string, Set<number>>();
  for (const f of FACTS) {
    if (!f.pooled) continue;
    const l = lettersOf(f.name);
    for (const n of [3, 4]) {
      if (l.length <= n) continue;
      const s = l.slice(-n);
      if (!families.has(s)) families.set(s, new Set());
      families.get(s)!.add(f.familyKey);
    }
  }
  return [...families].filter(([s, fam]) => fam.size >= 5 && !skip.has(`ends:${s}`)).map(([s]) => s).sort();
}

const rhymesWith = (f: Facts, ending: string) => {
  const l = lettersOf(f.name);
  return l.length > ending.length && l.endsWith(ending);
};

export function wordplayCategories(existingIds: ReadonlySet<string>): Category[] {
  const out: Category[] = [];
  out.push({
    id: "wordplay:colour",
    family: "wordplay",
    label: "Hides a colour in its name",
    rule: `Every name has a colour tucked inside it: ${COLOUR_WORDS.join(", ")}.`,
    difficulty: 2.95,
    test: (f) => findHidden(f.name, COLOUR_WORDS) !== null,
    guard: (f) => findHidden(f.name, COLOUR_GUARD) !== null,
    why: (f) => marked(f.name, findHidden(f.name, COLOUR_WORDS)!),
  });
  out.push({
    id: "wordplay:body",
    family: "wordplay",
    label: "Hides a body part in its name",
    rule: "Every name has a body part tucked inside it: an arm, a toe, an ear, a fin...",
    difficulty: 3.3,
    test: (f) => findHidden(f.name, BODY_WORDS) !== null,
    guard: (f) => findHidden(f.name, BODY_GUARD) !== null,
    why: (f) => marked(f.name, findHidden(f.name, BODY_WORDS)!),
  });
  out.push({
    id: "wordplay:word",
    family: "wordplay",
    label: "Starts with an everyday word",
    rule: "Every name is, or starts with, a plain English word: slow, star, bell, bear...",
    difficulty: 3.25,
    test: (f) => startsWithWord(f.name, WORDS) !== null,
    guard: (f) => startsWithWord(f.name, WORD_GUARD) !== null,
    why: (f) => {
      const w = startsWithWord(f.name, WORDS)!;
      const rest = lettersOf(f.name).slice(w.length);
      return rest ? `“${w}” + “${rest}”` : `“${w}” on its own`;
    },
  });
  for (const ending of rhymeEndings(existingIds)) {
    out.push({
      id: `wordplay:rhyme:${ending}`,
      family: "wordplay",
      label: `Rhyming names: -${ending}`,
      rule: `Every name ends in the same letters: -${ending}.`,
      difficulty: 3.0,
      test: (f) => rhymesWith(f, ending),
      why: (f) => {
        const l = lettersOf(f.name);
        return `${l.slice(0, -ending.length)}-${ending}`;
      },
    });
  }
  return out;
}
