import { type Difficulty, type ModuleId, type QuizFormat } from "@/engines/types";

/** Display metadata for game modes + SEO landing-page presets. */

export interface ModuleInfo {
  id: ModuleId;
  title: string;
  tagline: string;
  description: string;
  emoji: string;
  /** HSL triplet used for per-mode accent glows. */
  accent: string;
  defaultFormat: QuizFormat;
  /** The optional filter in the setup screen (the session's `gens`). Defaults to Pokédex generations. */
  filter?: QuizFilter;
}

export interface QuizFilter {
  label: string;
  /** Chip labels for values 1..n, with an optional hover title. */
  chips: { label: string; title?: string }[];
  /** Shown when nothing is selected. */
  note?: string;
}

const REGION_TITLES = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];

export const GEN_FILTER: QuizFilter = {
  label: "Generations",
  chips: REGION_TITLES.map((title, i) => ({ label: `Gen ${i + 1}`, title })),
};

/**
 * The generations a run plays when the player picks no filter: every one, for the
 * modes that use the generation filter ("All" means all nine); undefined for the rest.
 */
export function defaultGens(module: ModuleId): number[] | undefined {
  return filterFor(module) === GEN_FILTER ? GEN_FILTER.chips.map((_, i) => i + 1) : undefined;
}

/** Real Shiny? draws from all 1,025 Pokémon without a filter, so its filter needs no note. */
const SHINY_FILTER: QuizFilter = { label: GEN_FILTER.label, chips: GEN_FILTER.chips };

/** Same nine values: a game's generation, remakes included (FireRed is Gen 3). */
const GAMES_FILTER: QuizFilter = { label: GEN_FILTER.label, chips: GEN_FILTER.chips };

const ANIME_FILTER: QuizFilter = {
  label: "Series",
  chips: ["Original", "Advanced", "Diamond & Pearl", "Black & White", "XY", "Sun & Moon", "Journeys", "Horizons"].map((label) => ({ label })),
};

/** Same nine values: the generation an ability, move or item was introduced in. */
const ITEM_FILTER: QuizFilter = {
  ...GEN_FILTER,
  label: "Introduced in",
  note: "Without a filter, questions cover Gens 1–7. Pick generations to play any of the nine.",
};

/** Whose Team Is This?: a game's generation, or the anime series' region (the same nine values). */
const TEAM_FILTER: QuizFilter = {
  label: "Generation or region",
  chips: REGION_TITLES.map((title, i) => ({ label: `Gen ${i + 1}`, title: `${title}: games of Gen ${i + 1}, anime set in ${title}` })),
  note: "Games count by generation (FireRed is Gen 3); anime teams by the region of the series.",
};

export interface DifficultyChoice {
  id: Difficulty;
  label: string;
  /** What the choice changes, shown under it. */
  blurb: string;
}

/**
 * The only quizzes with a difficulty choice, because it changes the game:
 * Whose Team Is This? (the whole team, or one Pokémon at a time) and Real
 * Shiny? (how close the fakes are). Their first choice is the default.
 */
const DIFFICULTY_CHOICES: Partial<Record<ModuleId, DifficultyChoice[]>> = {
  "whose-team": [
    { id: "medium", label: "Normal", blurb: "The whole team" },
    { id: "hard", label: "Hard", blurb: "One Pokémon at a time, ace last" },
  ],
  shiny: [
    { id: "easy", label: "Easy", blurb: "The fakes are far off" },
    { id: "hard", label: "Hard", blurb: "The fakes are barely different" },
  ],
};

/**
 * Every other quiz plays one fixed tuning: medium (look-alike options, a balanced
 * question mix), over every generation unless the player filters (defaultGens).
 */
export const FIXED_DIFFICULTY: Difficulty = "medium";

/** The difficulty choices a mode offers: empty for a mode with one fixed tuning. */
export function difficultiesFor(module: ModuleId): DifficultyChoice[] {
  return DIFFICULTY_CHOICES[module] ?? [];
}

/**
 * The difficulty a new run or duel of this mode plays. A mode with a choice
 * keeps a valid one (anything else gets its default); every other mode plays
 * its fixed tuning, whatever an old link or invite asked for.
 */
export function playDifficulty(module: ModuleId, requested?: unknown): Difficulty {
  const choices = DIFFICULTY_CHOICES[module];
  if (!choices) return FIXED_DIFFICULTY;
  return choices.find((c) => c.id === requested)?.id ?? choices[0].id;
}

/**
 * A mode's name for a difficulty ("Normal" for Whose Team's medium), or null
 * for a mode without a choice (its difficulty isn't worth showing).
 */
export function difficultyLabel(module: ModuleId, difficulty: Difficulty): string | null {
  const choices = DIFFICULTY_CHOICES[module];
  if (!choices) return null;
  // An old run's level the mode no longer offers (Real Shiny's Medium) isn't named either.
  return choices.find((d) => d.id === difficulty)?.label ?? null;
}

export function filterFor(module: ModuleId): QuizFilter {
  return MODULE_INFO[module].filter ?? GEN_FILTER;
}

export const MODULE_INFO: Record<ModuleId, ModuleInfo> = {
  "whos-that": {
    id: "whos-that",
    title: "Who's That Pokémon?",
    tagline: "Name the silhouette",
    description: "Identify Pokémon from their silhouettes, with look-alikes among the options.",
    emoji: "👤",
    accent: "42 98% 60%",
    defaultFormat: "classic",
  },
  cry: {
    id: "cry",
    title: "Cry Quiz",
    tagline: "Name that sound",
    description: "Listen to a Pokémon's cry and pick who made it. Headphones recommended.",
    emoji: "🔊",
    accent: "258 94% 74%",
    defaultFormat: "classic",
  },
  dex: {
    id: "dex",
    title: "Dex Detective",
    tagline: "Pokédex entries, genus & abilities",
    description: "Identify Pokémon from censored Pokédex entries, their category, and their abilities.",
    emoji: "📖",
    accent: "199 89% 62%",
    defaultFormat: "classic",
  },
  types: {
    id: "types",
    title: "Type Master",
    tagline: "Matchups & weaknesses",
    description: "Typings, 4× weaknesses, immunities and damage multipliers — straight from the type chart.",
    emoji: "⚔️",
    accent: "340 86% 60%",
    defaultFormat: "classic",
  },
  "higher-lower": {
    id: "higher-lower",
    title: "Higher or Lower",
    tagline: "Stats, height & weight",
    description: "Two Pokémon, one stat. Who's faster, heavier, bulkier? Keep the streak alive.",
    emoji: "📊",
    accent: "154 68% 46%",
    defaultFormat: "survival",
  },
  games: {
    id: "games",
    title: "Mainline Games",
    tagline: "Gyms, rivals, regions & more",
    description: "Gym Leaders, Champions, villains, starters, regions and mechanics from every core RPG, Red and Blue to Legends: Z-A.",
    emoji: "🎮",
    accent: "12 90% 62%",
    defaultFormat: "classic",
    filter: GAMES_FILTER,
  },
  anime: {
    id: "anime",
    title: "Pokémon Anime",
    tagline: "Ash, friends & Team Rocket",
    description: "Ash's Pokémon, his companions and rivals, Team Rocket, league results, movies and Horizons. English dub names.",
    emoji: "📺",
    accent: "48 96% 58%",
    defaultFormat: "classic",
    filter: ANIME_FILTER,
  },
  competitive: {
    id: "competitive",
    title: "Abilities, Moves & Items",
    tagline: "Battle data from Showdown",
    description: "Which Pokémon can have an ability, what type a move is, what an item or ability does. Straight from the Pokémon Showdown data.",
    emoji: "⚔️",
    accent: "350 84% 62%",
    defaultFormat: "classic",
    filter: ITEM_FILTER,
  },
  shiny: {
    id: "shiny",
    title: "Real Shiny?",
    tagline: "Spot the genuine shiny",
    description: "Four colourings of one Pokémon, only one is its real shiny. Easy fakes are far off, Hard fakes are barely different. All 1,025.",
    emoji: "✨",
    accent: "280 90% 70%",
    defaultFormat: "classic",
    filter: SHINY_FILTER,
  },
  "zoom-reveal": {
    id: "zoom-reveal",
    title: "Zoom Reveal",
    tagline: "Name it from a close-up",
    description: "An extreme close-up of a Pokémon's official artwork. Every miss zooms out a step; the fewer steps you need, the more points.",
    emoji: "🔍",
    accent: "186 84% 52%",
    defaultFormat: "classic",
  },
  "whose-team": {
    id: "whose-team",
    title: "Whose Team Is This?",
    tagline: "Name the trainer from their team",
    description: "A famous trainer's team, from the games or the anime: name the trainer. Hard reveals one Pokémon at a time, ace last.",
    emoji: "🧢",
    accent: "205 90% 60%",
    defaultFormat: "classic",
    filter: TEAM_FILTER,
  },
  mixed: {
    id: "mixed",
    title: "Mixed Bag",
    tagline: "A bit of everything",
    description: "Silhouettes, Pokédex entries, type matchups and stat battles in one run.",
    emoji: "🎲",
    accent: "228 90% 70%",
    defaultFormat: "classic",
  },
};

export const PLAY_MODULES: ModuleId[] = ["whos-that", "cry", "dex", "types", "higher-lower", "games", "anime", "competitive", "shiny", "zoom-reveal", "whose-team", "mixed"];

export const FORMAT_INFO: Record<QuizFormat, { title: string; description: string }> = {
  classic: { title: "Classic", description: "10 questions · 15s each" },
  survival: { title: "Survival", description: "Endless · 3 lives" },
  blitz: { title: "Blitz", description: "60 seconds · as many as you can" },
  adaptive: { title: "PokéIQ Test", description: "20 adaptive questions · 20s each" },
};

/** Formats offered in the per-mode setup screen (the adaptive test has its own page). */
export const PLAYABLE_FORMATS = ["classic", "survival", "blitz"] as const;

export interface QuizPreset {
  slug: string;
  module: ModuleId;
  gens?: number[];
  format?: QuizFormat;
  title: string;
  h1: string;
  description: string;
}

const GEN_REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];

/** Every preset is a crawlable landing page (/quiz/<slug>) in the sitemap. */
export const QUIZ_PRESETS: QuizPreset[] = [
  {
    slug: "whos-that-pokemon",
    module: "whos-that",
    title: "Who's That Pokémon? Silhouette Quiz",
    h1: "Who's That Pokémon?",
    description: "Guess the Pokémon from its silhouette. Pick any of the nine generations, in Classic, Survival and Blitz modes.",
  },
  {
    slug: "pokemon-cry-quiz",
    module: "cry",
    title: "Pokémon Cry Quiz — Guess the Pokémon by Its Cry",
    h1: "Pokémon Cry Quiz",
    description: "Can you recognize Pokémon by their cries? Listen and guess across every generation.",
  },
  {
    slug: "pokedex-entry-quiz",
    module: "dex",
    title: "Pokédex Entry Quiz — Guess the Pokémon from Its Pokédex Entry",
    h1: "Dex Detective",
    description: "Read a censored Pokédex entry and name the Pokémon. Plus category and ability questions.",
  },
  {
    slug: "pokemon-type-quiz",
    module: "types",
    title: "Pokémon Type Chart Quiz — Weaknesses, Immunities & Matchups",
    h1: "Type Master",
    description: "Test your type chart knowledge: dual-type weaknesses, 4× matchups, immunities and typings.",
  },
  {
    slug: "pokemon-higher-or-lower",
    module: "higher-lower",
    format: "survival",
    title: "Pokémon Higher or Lower — Base Stats Game",
    h1: "Higher or Lower",
    description: "Which Pokémon is faster, heavier or has the higher base stat total? Keep your streak alive.",
  },
  {
    slug: "pokemon-games-quiz",
    module: "games",
    title: "Pokémon Games Quiz — Gym Leaders, Champions & Regions",
    h1: "Mainline Games Quiz",
    description: "How well do you know the core Pokémon RPGs? Gym Leaders, Elite Four, rivals, villains, starters and regions from Red and Blue to Legends: Z-A.",
  },
  {
    slug: "pokemon-ability-move-item-quiz",
    module: "competitive",
    title: "Pokémon Ability, Move & Item Quiz",
    h1: "Abilities, Moves & Items",
    description: "Which Pokémon can have this ability? What type is this move? What does this item do? Questions generated from the Pokémon Showdown data.",
  },
  {
    slug: "real-shiny-quiz",
    module: "shiny",
    title: "Which Is the Real Shiny? Pokémon Shiny Quiz",
    h1: "Which Is the Real Shiny?",
    description: "One of four colourings is the real shiny, the rest are fakes. Can you tell? All 1,025 Pokémon, on Easy or Hard.",
  },
  {
    slug: "pokemon-zoom-quiz",
    module: "zoom-reveal",
    title: "Pokémon Zoom Quiz — Zoom Reveal",
    h1: "Zoom Reveal",
    description: "Name the Pokémon from an extreme close-up of its official artwork. Each miss zooms out one step, six in all, plus a daily one.",
  },
  {
    slug: "pokemon-anime-quiz",
    module: "anime",
    title: "Pokémon Anime Quiz — Ash, Team Rocket & Horizons",
    h1: "Pokémon Anime Quiz",
    description: "Ash's Pokémon, his friends and rivals, Team Rocket, league results, the movies and Pokémon Horizons. Every answer checked against Bulbapedia.",
  },
  {
    slug: "whose-team-is-this",
    module: "whose-team",
    title: "Whose Team Is This? — Guess the Pokémon Trainer from Their Team",
    h1: "Whose Team Is This?",
    description: "Gym Leaders, Elite Four, Champions, rivals and villains from every core game, plus Ash and friends from the anime: name the trainer from their team.",
  },
  {
    slug: "pokemon-trivia-quiz",
    module: "mixed",
    title: "Pokémon Trivia Quiz — Mixed Questions",
    h1: "Pokémon Trivia",
    description: "A mixed Pokémon quiz: silhouettes, Pokédex entries, type matchups and stat battles.",
  },
  ...GEN_REGIONS.map((region, i) => ({
    slug: `gen-${i + 1}-pokemon-quiz`,
    module: "whos-that" as const,
    gens: [i + 1],
    title: `Gen ${i + 1} Pokémon Quiz — ${region} Who's That Pokémon?`,
    h1: `Gen ${i + 1} Pokémon Quiz (${region})`,
    description: `How well do you know the ${region} Pokédex? Name every Gen ${i + 1} Pokémon from its silhouette.`,
  })),
];

export function presetFor(slug: string): QuizPreset | undefined {
  return QUIZ_PRESETS.find((p) => p.slug === slug);
}

/** Canonical landing page for each module (used for nav + links). */
export function moduleHref(module: ModuleId): string {
  return `/quiz/${QUIZ_PRESETS.find((p) => p.module === module && !p.gens)!.slug}`;
}
