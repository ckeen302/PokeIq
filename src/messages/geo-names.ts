import en from "./en/geo-names.json";
import { defineNamespace } from "@/i18n/catalog";

/**
 * PokéGuessr's names: the regions and games in each language's official names (from src/data/i18n, PokéAPI), the
 * themed maps, eras and difficulties, and how a place is written. Shared by every PokéGuessr page (duels too).
 */
export default defineNamespace("geo-names", en);
