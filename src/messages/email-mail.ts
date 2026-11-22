import en from "./en/email-mail.json";
import { defineNamespace } from "@/i18n/catalog";

/** The emails PokéIQ sends trainers (src/lib/server/email/templates): the daily email and the confirmation. Server only. */
export default defineNamespace("email-mail", en);
