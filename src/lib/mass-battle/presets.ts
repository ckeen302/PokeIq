import { simpleQuestion } from "./share";
import type { ArenaId, BattleLevel, BattleSpec, Formation, GroupRule, MBSpecies, Question, Roster, SetChoice, UnitSpec } from "./types";

/**
 * The ready-made battles, each with its own page, share link and preview
 * card. A side is a few species with counts, or a group ("every fully
 * evolved Fire type") resolved against the real data. Nobody holds an item
 * unless a preset says so (the fair default).
 */

type SideDef =
  | { formation: Formation; units: [slug: string, count: number, set?: SetChoice][] }
  | { formation: Formation; group: GroupRule; each: number };

export interface PresetDef {
  id: string;
  /** "howmany": the page shows the solver's answer battle; "battle": these armies (the answer, if any, is a bonus). */
  kind: "howmany" | "battle";
  /** Card and page title. */
  title: string;
  /** The video's opening line. */
  hook: string;
  blurb: string;
  arena: ArenaId;
  level: BattleLevel;
  seed: number;
  sides: [SideDef, SideDef];
  /** "How many?" presets: the question the solver answers (an army of the first side's species against the second's). */
  question?: { challenger: string; boss: string };
  /** Names for sides made of many species. */
  labels?: [string, string];
}

export const PRESETS: PresetDef[] = [
  {
    id: "magikarp-vs-arceus",
    kind: "howmany",
    title: "How many Magikarp beat Arceus?",
    hook: "How many Magikarp does it take to beat Arceus? 😳",
    blurb: "The weakest Pokémon against the one said to have shaped the universe. The solver finds the smallest army that wins.",
    arena: "colosseum",
    level: 100,
    seed: 4101,
    sides: [{ formation: "swarm", units: [["magikarp", 40]] }, { formation: "line", units: [["arceus", 1]] }],
    question: { challenger: "magikarp", boss: "arceus" },
  },
  {
    id: "rattata-vs-mewtwo",
    kind: "battle",
    title: "1,000 Rattata vs 1 Mewtwo",
    hook: "1,000 Rattata vs 1 Mewtwo. Who wins? 🐀",
    blurb: "A thousand of the commonest Pokémon in Kanto against its most powerful one.",
    arena: "plains",
    level: 100,
    seed: 1150,
    sides: [{ formation: "swarm", units: [["rattata", 1000]] }, { formation: "line", units: [["mewtwo", 1]] }],
    question: { challenger: "rattata", boss: "mewtwo" },
  },
  {
    id: "pikachu-vs-snorlax",
    kind: "battle",
    title: "100 Pikachu vs 1 Snorlax",
    hook: "100 Pikachu vs 1 Snorlax ⚡",
    blurb: "A wave of Pikachu against the heaviest wall in Kanto.",
    arena: "plains",
    level: 100,
    seed: 25143,
    sides: [{ formation: "wedge", units: [["pikachu", 100]] }, { formation: "line", units: [["snorlax", 1]] }],
    question: { challenger: "pikachu", boss: "snorlax" },
  },
  {
    id: "kanto-starters",
    kind: "battle",
    title: "Kanto starters war",
    hook: "600 Kanto starters vs their final evolutions 🔥💧🌿",
    blurb: "Bulbasaur, Charmander and Squirtle in their hundreds against a few dozen Venusaur, Charizard and Blastoise.",
    arena: "plains",
    level: 100,
    seed: 147,
    labels: ["Starters", "Final evolutions"],
    sides: [
      { formation: "line", units: [["bulbasaur", 200], ["charmander", 200], ["squirtle", 200]] },
      { formation: "wedge", units: [["venusaur", 20], ["charizard", 20], ["blastoise", 20]] },
    ],
  },
  {
    id: "fire-vs-water",
    kind: "battle",
    title: "Fire vs Water",
    hook: "Every Fire type vs every Water type 🔥🌊",
    blurb: "Every fully evolved Fire type against every fully evolved Water type: the oldest matchup in Pokémon, at scale.",
    arena: "volcano",
    level: 100,
    seed: 2026,
    // Water on the blue side, Fire on the red.
    labels: ["Water types", "Fire types"],
    sides: [
      { formation: "line", group: { types: ["water"], fullyEvolved: true, legendary: "no" }, each: 5 },
      { formation: "line", group: { types: ["fire"], fullyEvolved: true, legendary: "no" }, each: 10 },
    ],
  },
  {
    id: "legendaries-vs-everyone",
    kind: "battle",
    title: "Legendaries vs everyone",
    hook: "Every legendary Pokémon vs an army of Kanto 👑",
    blurb: "Every legendary Pokémon against ten of every other fully evolved Pokémon from Kanto.",
    arena: "colosseum",
    level: 100,
    seed: 151,
    labels: ["Legendaries", "Kanto"],
    sides: [
      { formation: "wedge", group: { legendary: true }, each: 1 },
      { formation: "line", group: { gen: 1, fullyEvolved: true, legendary: "no" }, each: 10 },
    ],
  },
  {
    id: "bug-swarm-vs-charizard",
    kind: "battle",
    title: "Bug swarm vs one Charizard",
    hook: "1,000 bugs vs 1 Charizard 🔥🐝",
    blurb: "Beedrill, Butterfree, Venomoth and Scyther swarm a Charizard that is super effective against every one of them.",
    arena: "volcano",
    level: 100,
    seed: 6,
    labels: ["Bug swarm", "Charizard"],
    sides: [
      { formation: "swarm", units: [["beedrill", 250], ["butterfree", 250], ["venomoth", 250], ["scyther", 250]] },
      { formation: "line", units: [["charizard", 1]] },
    ],
    question: { challenger: "beedrill", boss: "charizard" },
  },
  {
    id: "eeveelution-civil-war",
    kind: "battle",
    title: "Eeveelution civil war",
    hook: "Eeveelution civil war: which half wins? 🦊",
    blurb: "Vaporeon, Jolteon, Flareon and Espeon against Umbreon, Leafeon, Glaceon and Sylveon.",
    arena: "snowfield",
    level: 100,
    seed: 133,
    labels: ["Vaporeon & co.", "Umbreon & co."],
    sides: [
      { formation: "wedge", units: [["vaporeon", 25], ["jolteon", 25], ["flareon", 25], ["espeon", 25]] },
      { formation: "wedge", units: [["umbreon", 25], ["leafeon", 25], ["glaceon", 25], ["sylveon", 25]] },
    ],
  },
];

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));
export const DEFAULT_PRESET = PRESETS[0];

export interface ResolvedPreset {
  id: string;
  kind: "howmany" | "battle";
  title: string;
  hook: string;
  blurb: string;
  spec: BattleSpec;
  question: Question | null;
  labels: [string, string] | null;
}

/** A preset's armies against the roster (species it can't field are left out). */
export function resolvePreset(p: PresetDef, roster: Pick<Roster, "species">): ResolvedPreset {
  const bySlug = new Map(roster.species.map((s) => [s.slug, s]));
  const canFight = (s: MBSpecies | undefined): s is MBSpecies => !!s && (!!s.randbats || s.levelUp.length > 0);
  const side = (d: SideDef) => {
    if ("units" in d) {
      const units: UnitSpec[] = d.units.flatMap(([slug, count, set]) => {
        const s = bySlug.get(slug);
        return canFight(s) ? [{ id: s.id, count, ...(set ? { set } : {}) }] : [];
      });
      return { formation: d.formation, units };
    }
    return { formation: d.formation, units: [{ id: 0, count: d.each, group: d.group }] };
  };
  const c = p.question ? bySlug.get(p.question.challenger) : undefined, b = p.question ? bySlug.get(p.question.boss) : undefined;
  const q = c && b ? simpleQuestion(c.id, b.id, p.level, p.arena) : null;
  return { id: p.id, kind: p.kind, title: p.title, hook: p.hook, blurb: p.blurb, spec: { sides: [side(p.sides[0]), side(p.sides[1])], level: p.level, arena: p.arena, seed: p.seed }, question: q, labels: p.labels ?? null };
}
