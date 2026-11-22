import en from "./en/battle-replay-words.json";
import { defineNamespace } from "@/i18n/catalog";

/** A replay's few words, for the server and the browser: who played, who won, how many turns, how long ago. */
export default defineNamespace("battle-replay-words", en);
