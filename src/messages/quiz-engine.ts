import en from "./en/quiz-engine.json";
import { defineNamespace } from "@/i18n/catalog";

/**
 * Quiz questions in other languages (server only, src/engines): prompts, hints and explanations. English questions
 * are written by the engines themselves, exactly as they always were; these are their wordings for other languages.
 */
export default defineNamespace("quiz-engine", en);
