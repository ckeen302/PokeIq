import en from "./en/battle-log.json";
import { defineNamespace } from "@/i18n/catalog";

/**
 * The battle log: Pokémon Showdown's battle text table (scripts/i18n/battle-log.mjs writes the English from
 * @pkmn/view's), plus PokéIQ's own lines under "pokeiq". Only another language's battle screen loads it
 * (src/lib/battle/log/local.ts): English pages write their log with @pkmn/view's own formatter.
 */
export default defineNamespace("battle-log", en);
