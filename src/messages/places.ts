import en from "./en/places.json";
import { defineNamespace } from "@/i18n/catalog";

/** The Pokédex Places pages (/pokedex/places and each place): server components only. */
export default defineNamespace("places", en);
