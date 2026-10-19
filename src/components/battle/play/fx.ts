/** Where battle effect images and sprites come from. */

/** PokéIQ's copies of Pokémon Showdown's CC0 effect images (and our own redrawn ones). */
export const FX = "/battle/fx/";

/**
 * The Pokémon sprite host (Pokémon Showdown's sprite layout). Set
 * NEXT_PUBLIC_SPRITE_HOST to a mirror (e.g. our own storage bucket) to stop
 * hotlinking Showdown's servers.
 */
export const SPRITE_HOST = (process.env.NEXT_PUBLIC_SPRITE_HOST || "https://play.pokemonshowdown.com").replace(/\/$/, "");

/** An underground backdrop for moves like Dig and Earthquake's big cousins (our own, not a game image). */
export const CAVE_BG = "radial-gradient(120% 90% at 50% 100%, #6b4a2c 0%, #3d2a19 45%, #1a120b 100%)";
