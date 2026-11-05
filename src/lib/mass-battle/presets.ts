import { DEFAULT_RUNS, simpleQuestion } from "./share";
import { type ArenaId, type ArmySpec, type BattleLevel, type BattleSpec, type FieldSpec, type Formation, type GroupRule, type ItemPolicy, type MBSpecies, type PlaybackSpec, type Question, type Roster, type SetChoice, type Spacing, type SpreadUse, type Stance, type Targeting, type UnitSpec } from "./types";

/**
 * The ready-made battles, each with its own page, share link and preview
 * card. A preset can say anything the Battle setup panel can (and fills it
 * in): a side is a few species with counts and sets, or a group ("every
 * fully evolved Fire type") resolved against the real data, with its
 * formation and how it fights; the field (weather, terrain, time of day);
 * held items; the "how many?" question's settings; and how the battle is
 * shown. Nobody holds an item unless a preset says so (the fair default).
 */

/** How a side fights (left out: nearest foe, charge, normal spacing, spread moves when they pay). */
interface SideBehaviour {
  spacing?: Spacing;
  targeting?: Targeting;
  stance?: Stance;
  spread?: SpreadUse;
}

type SideDef = SideBehaviour &
  (
    | { formation: Formation; units: [slug: string, count: number, set?: SetChoice][] }
    | { formation: Formation; group: GroupRule; each: number; set?: SetChoice }
  );

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
  /** Weather, terrain and time of day (left out: clear, none, day). */
  field?: FieldSpec;
  /** "sets": everyone holds its random-battle item (left out: no items unless a set says so). */
  items?: ItemPolicy;
  /**
   * "How many?" presets: the question the solver answers: an army of the first side's species (with its set there)
   * against the second's, in the preset's field, with the share of battles to win and the battles per size.
   */
  question?: { challenger: string; boss: string; threshold?: number; runs?: number };
  /** How the battle is shown, unless the link says otherwise. */
  playback?: Partial<PlaybackSpec>;
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
  {
    id: "fire-vs-water-sun",
    kind: "battle",
    title: "Fire vs Water in harsh sunlight",
    hook: "Fire vs Water… but the sun is out ☀️",
    blurb: "The same armies as Fire vs Water, under harsh sunlight: Fire moves hit 1.5× harder and Water moves half as hard, as in the games.",
    arena: "volcano",
    level: 100,
    seed: 2026,
    field: { weather: "sun", terrain: "none", time: "day" },
    labels: ["Water types", "Fire types"],
    sides: [
      { formation: "line", group: { types: ["water"], fullyEvolved: true, legendary: "no" }, each: 5 },
      { formation: "line", group: { types: ["fire"], fullyEvolved: true, legendary: "no" }, each: 10 },
    ],
  },
  {
    id: "light-ball-pikachu-vs-snorlax",
    kind: "howmany",
    title: "How many Pikachu with a Light Ball beat Snorlax?",
    hook: "How many Pikachu does it take to beat Snorlax… with a Light Ball? ⚡",
    blurb: "Pikachu's own held item doubles its Attack and Special Attack. Every Pikachu holds one; Snorlax holds nothing.",
    arena: "plains",
    level: 100,
    seed: 25,
    sides: [{ formation: "swarm", units: [["pikachu", 5, { item: "Light Ball" }]] }, { formation: "line", units: [["snorlax", 1]] }],
    question: { challenger: "pikachu", boss: "snorlax" },
    playback: { numbers: true },
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
  /** How it's shown: the preset's own choices (the rest stays as the viewer has it). */
  playback: Partial<PlaybackSpec>;
}

const behaviourOf = (d: SideBehaviour): Omit<ArmySpec, "units" | "formation"> => ({
  ...(d.spacing && d.spacing !== "normal" ? { spacing: d.spacing } : {}),
  ...(d.targeting && d.targeting !== "nearest" ? { targeting: d.targeting } : {}),
  ...(d.stance === "hold" ? { stance: d.stance } : {}),
  ...(d.spread === "never" ? { spread: d.spread } : {}),
});

/** A preset's armies against the roster (species it can't field are left out). */
export function resolvePreset(p: PresetDef, roster: Pick<Roster, "species">): ResolvedPreset {
  const bySlug = new Map(roster.species.map((s) => [s.slug, s]));
  const canFight = (s: MBSpecies | undefined): s is MBSpecies => !!s && (!!s.randbats || s.levelUp.length > 0);
  const side = (d: SideDef): ArmySpec => {
    if ("units" in d) {
      const units: UnitSpec[] = d.units.flatMap(([slug, count, set]) => {
        const s = bySlug.get(slug);
        return canFight(s) ? [{ id: s.id, count, ...(set ? { set } : {}) }] : [];
      });
      return { formation: d.formation, ...behaviourOf(d), units };
    }
    return { formation: d.formation, ...behaviourOf(d), units: [{ id: 0, count: d.each, group: d.group, ...(d.set ? { set: d.set } : {}) }] };
  };
  const sides: [ArmySpec, ArmySpec] = [side(p.sides[0]), side(p.sides[1])];
  const spec: BattleSpec = { sides, level: p.level, arena: p.arena, seed: p.seed };
  if (p.field && (p.field.weather !== "none" || p.field.terrain !== "none" || p.field.time !== "day")) spec.field = { ...p.field };
  if (p.items === "sets") spec.items = "sets";
  // The question: its challenger and boss as the sides have them (their sets and how they fight), in the preset's field.
  const c = p.question ? bySlug.get(p.question.challenger) : undefined, b = p.question ? bySlug.get(p.question.boss) : undefined;
  let q: Question | null = null;
  if (c && b && p.question) {
    q = simpleQuestion(c.id, b.id, p.level, p.arena);
    const setOf = (army: ArmySpec, id: number) => army.units.find((u) => u.id === id)?.set;
    const cs = setOf(sides[0], c.id), bs = setOf(sides[1], b.id);
    q.army = { ...q.army, ...behaviourOf(p.sides[0]), units: [{ id: c.id, count: 1, ...(cs ? { set: cs } : {}) }] };
    q.boss = { ...q.boss, ...behaviourOf(p.sides[1]), units: [{ id: b.id, count: 1, ...(bs ? { set: bs } : {}) }] };
    if (spec.field) q.field = spec.field;
    if (spec.items) q.items = spec.items;
    if (p.question.threshold === 0.9) q.threshold = 0.9;
    if (p.question.runs && p.question.runs !== DEFAULT_RUNS) q.runs = p.question.runs;
  }
  return { id: p.id, kind: p.kind, title: p.title, hook: p.hook, blurb: p.blurb, spec, question: q, labels: p.labels ?? null, playback: { ...p.playback } };
}
