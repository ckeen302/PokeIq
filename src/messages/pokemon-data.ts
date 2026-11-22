import en from "./en/pokemon-data.json";
import { defineNamespace } from "@/i18n/catalog";

/** Server-only words for a species page's data in other languages: evolution methods, where to find it, regional Pokédexes, growth rates, body shapes. */
export default defineNamespace("pokemon-data", en);
