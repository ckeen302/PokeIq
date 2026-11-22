import en from "./en/battle-rules.json";
import { defineNamespace } from "@/i18n/catalog";

/** Custom rules: the editor, Showdown's format picker, the rules check and a ruleset's description (lib/battle/custom-rules-text). */
export default defineNamespace("battle-rules", en);
