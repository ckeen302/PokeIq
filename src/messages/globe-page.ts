import en from "./en/globe-page.json";
import { defineNamespace } from "@/i18n/catalog";

/**
 * What the globe page's server sends a page in another language: where each region is based on (src/lib/region-origins.ts
 * in English) and the game labels. English pages use the originals.
 */
export default defineNamespace("globe-page", en);
