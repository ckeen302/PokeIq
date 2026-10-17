import type { Difficulty, ModuleId, QuizFormat } from "@/engines/types";

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
}

export const MODULE_INFO: Record<ModuleId, ModuleInfo> = {
  "whos-that": {
    id: "whos-that",
    title: "Who's That Pokémon?",
    tagline: "Name the silhouette",
    description: "Identify Pokémon from their silhouettes — hard mode zooms in on a single detail.",
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

export const PLAY_MODULES: ModuleId[] = ["whos-that", "cry", "dex", "types", "higher-lower", "mixed"];

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
  difficulty?: Difficulty;
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
    description: "Guess the Pokémon from its silhouette. All 1,025 Pokémon, three difficulties, Survival and Blitz modes.",
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
    difficulty: "hard" as const,
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
