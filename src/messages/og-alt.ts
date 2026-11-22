import en from "./en/og-alt.json";
import { defineNamespace } from "@/i18n/catalog";

/** Each share image's alt text, keyed by its route (scripts/i18n/mirror.mjs altKey): server only. */
export default defineNamespace("og-alt", en);
