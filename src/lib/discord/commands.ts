import { SITE_URL } from "@/lib/site";
import { dailyNumber } from "@/lib/daily";
import { POKEDEX, artworkUrl, titleCase, type Pokemon } from "@/lib/pokemon/pokedex";

export const PINK = 0xf1417c;
export const VIOLET = 0xa47efb;

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  thumbnail?: { url: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

export function dailyEmbed(now = new Date()): Embed {
  const date = todayUtc(now);
  const n = dailyNumber(date);
  const link = (label: string, path: string) => `[${label}](${SITE_URL}${path})`;
  return {
    title: `PokéIQ Daily #${n}`,
    description: [
      link(`Pokédle #${n}`, "/pokedle"),
      link("PokéConnections", "/connections"),
      link("Pikadoku", "/pikadoku"),
      link("PokéGuessr daily", "/guessr"),
      link("Daily Challenge quiz", "/daily"),
    ].join("\n"),
    url: SITE_URL,
    color: PINK,
    footer: { text: date },
  };
}

export function helpEmbed(): Embed {
  return {
    title: "PokéIQ bot",
    color: VIOLET,
    description: [
      "`/daily` today's puzzles",
      "`/dex pokemon:<name>` Pokédex card",
      "`/duel game:<game>` open a casual duel",
      "`/leaderboard game:<game>` today's top 10",
      "`/help` this list",
      "",
      `[${SITE_URL.replace(/^https?:\/\//, "")}](${SITE_URL})`,
    ].join("\n"),
  };
}

export function findPokemon(query: string): Pokemon | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return POKEDEX.find((p) => p.slug === q || p.name.toLowerCase() === q) ?? POKEDEX.find((p) => p.name.toLowerCase().startsWith(q));
}

export function pokemonChoices(query: string, limit = 25): { name: string; value: string }[] {
  const q = query.trim().toLowerCase();
  const starts: Pokemon[] = [];
  const contains: Pokemon[] = [];
  for (const p of POKEDEX) {
    const n = p.name.toLowerCase();
    if (!q || n.startsWith(q)) starts.push(p);
    else if (n.includes(q)) contains.push(p);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit).map((p) => ({ name: p.name.slice(0, 100), value: p.slug }));
}

export function dexEmbed(p: Pokemon): Embed {
  const s = p.stats;
  const abilities = p.abilities.map((a) => titleCase(a.name.replace(/-/g, " ")) + (a.hidden ? " (hidden)" : "")).join(", ");
  return {
    title: `#${p.id} ${p.name}`,
    url: `${SITE_URL}/pokemon/${p.slug}`,
    color: PINK,
    thumbnail: { url: artworkUrl(p.id) },
    description: p.genus,
    fields: [
      { name: "Type", value: p.types.map(titleCase).join(" / "), inline: true },
      { name: "Base stat total", value: String(p.bst), inline: true },
      { name: "Key stats", value: `HP ${s.hp} · Atk ${s.atk} · Def ${s.def}\nSpA ${s.spa} · SpD ${s.spd} · Spe ${s.spe}` },
      { name: "Abilities", value: abilities || "None" },
    ],
  };
}

export type DuelGame = "pokedle" | "connections" | "pikadoku" | "guessr" | "quiz";
export const DUEL_PATHS: Record<DuelGame, string> = {
  pokedle: "/pokedle/duel",
  connections: "/connections/duel",
  pikadoku: "/pikadoku/duel",
  guessr: "/guessr/duel",
  quiz: "/quiz/duel",
};
export const GAME_LABELS: Record<DuelGame, string> = { pokedle: "Pokédle", connections: "PokéConnections", pikadoku: "Pikadoku", guessr: "PokéGuessr", quiz: "Quiz" };

export const duelEmbed = (game: DuelGame, code: string): Embed => ({
  title: `${GAME_LABELS[game]} duel`,
  description: `[Join the duel](${SITE_URL}${DUEL_PATHS[game]}/${code})`,
  color: VIOLET,
});

export const errorEmbed = (message: string): Embed => ({ description: message, color: PINK });

/** A name the duel schema accepts, from a Discord display name. */
export function duelName(raw: string | undefined): string {
  const cleaned = (raw ?? "").replace(/[^\p{L}\p{N} _.\-']/gu, "").trim().slice(0, 24);
  return cleaned || "Trainer";
}
