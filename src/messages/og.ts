import en from "./en/og.json";
import { defineNamespace } from "@/i18n/catalog";

/** The share images' text (src/lib/og, every opengraph-image route): server only, drawn in the page's language. */
export default defineNamespace("og", en);
