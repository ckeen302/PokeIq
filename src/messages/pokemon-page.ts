import en from "./en/pokemon-page.json";
import { defineNamespace } from "@/i18n/catalog";

/** A species page's server text (/pokemon/[slug]): metadata, the summary under the entry and its links, structured data. */
export default defineNamespace("pokemon-page", en);
