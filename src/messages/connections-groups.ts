import en from "./en/connections-groups.json";
import { defineNamespace } from "@/i18n/catalog";

/** PokéConnections' groups, server-side only: their names, rules, "Why?" lines and red herrings (src/lib/connections/text.ts). */
export default defineNamespace("connections-groups", en);
