import en from "./en/site.json";
import { defineNamespace } from "@/i18n/catalog";

/** The site itself, read on the server: its tagline and description, the footer's text, the 404, the feedback page. */
export default defineNamespace("site", en);
