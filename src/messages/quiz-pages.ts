import en from "./en/quiz-pages.json";
import { defineNamespace } from "@/i18n/catalog";

/** The quiz pages' server text: titles, descriptions, headings and how-to (/quiz, /quiz/<preset>, /daily, duel and challenge links). */
export default defineNamespace("quiz-pages", en);
