import en from "./en/game-info.json";
import { defineNamespace } from "@/i18n/catalog";

/** The SEO block under a game (components/seo/GameInfo): its own headings, rendered on the server. */
export default defineNamespace("game-info", en);
