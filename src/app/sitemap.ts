import type { MetadataRoute } from "next";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { QUIZ_PRESETS } from "@/lib/modes";
import { NEA_CATEGORIES, NEA_PATH } from "@/lib/name-em-all/categories";
import { ABILITIES, ITEMS, MOVES } from "@/lib/dex/data";
import { SITE_URL } from "@/lib/site";
import { PLACES } from "@/lib/dex/places-data";
import { getSets } from "@/lib/tcg/api";
import { trainerSitemapPaths } from "@/lib/trainers/data";
import { POOL as WHICH_POKEMON_POOL } from "@/lib/which-pokemon/pool";
import { QUIZ_PATH as WHICH_POKEMON_PATH } from "@/lib/which-pokemon/match";

// TCG sets come from the Pokémon TCG API: refresh daily; without the API the sitemap simply omits them.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const sets = (await getSets()) ?? [];
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/daily`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/iq-test`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/pokedle`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/guessr`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/connections`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/pikadoku`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/connections/community`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/connections/create`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/atlas`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/play`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/pokedex`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/pokedex/study`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/pokedex/moves`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/pokedex/abilities`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/pokedex/items`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/pokedex/places`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/pokedex/types`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/pokedex/natures`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/pokedex/tcg`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/pokedex/trainers`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/leaderboard`, changeFrequency: "hourly", priority: 0.5 },
    { url: `${SITE_URL}/battle`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/battle/play`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/battle/teams`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/battle/calc`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/battle/lab`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/battle/factory`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/battle/tower`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/battle/watch`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/battle/replays`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/battle/ladder`, changeFrequency: "daily", priority: 0.6 },
    ...QUIZ_PRESETS.map((p) => ({ url: `${SITE_URL}/quiz/${p.slug}`, changeFrequency: "weekly" as const, priority: 0.8 })),
    { url: `${SITE_URL}${WHICH_POKEMON_PATH}`, changeFrequency: "monthly", priority: 0.8 },
    ...WHICH_POKEMON_POOL.map((p) => ({ url: `${SITE_URL}${WHICH_POKEMON_PATH}/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.5 })),
    { url: `${SITE_URL}${NEA_PATH}`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}${NEA_PATH}/daily`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    ...NEA_CATEGORIES.map((c) => ({ url: `${SITE_URL}${NEA_PATH}/${c.id}`, changeFrequency: "monthly" as const, priority: 0.6 })),
    ...POKEDEX.map((p) => ({ url: `${SITE_URL}/pokemon/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.5 })),
    ...MOVES.map((m) => ({ url: `${SITE_URL}/pokedex/moves/${m.slug}`, changeFrequency: "monthly" as const, priority: 0.4 })),
    ...ABILITIES.map((a) => ({ url: `${SITE_URL}/pokedex/abilities/${a.slug}`, changeFrequency: "monthly" as const, priority: 0.4 })),
    ...ITEMS.map((i) => ({ url: `${SITE_URL}/pokedex/items/${i.slug}`, changeFrequency: "monthly" as const, priority: 0.3 })),
    ...PLACES.map((p) => ({ url: `${SITE_URL}/pokedex/places/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.3 })),
    ...sets.map((s) => ({ url: `${SITE_URL}/pokedex/tcg/${s.id}`, changeFrequency: "weekly" as const, priority: 0.4 })),
    ...trainerSitemapPaths().map((p) => ({ url: `${SITE_URL}${p.path}`, changeFrequency: "monthly" as const, priority: p.priority })),
  ];
}
