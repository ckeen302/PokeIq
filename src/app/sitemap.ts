import type { MetadataRoute } from "next";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { QUIZ_PRESETS } from "@/lib/modes";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/daily`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/iq-test`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/pokedle`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/play`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/pokedex`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/pokedex/study`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/leaderboard`, changeFrequency: "hourly", priority: 0.5 },
    ...QUIZ_PRESETS.map((p) => ({ url: `${SITE_URL}/quiz/${p.slug}`, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...POKEDEX.map((p) => ({ url: `${SITE_URL}/pokemon/${p.slug}`, changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
