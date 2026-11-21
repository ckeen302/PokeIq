import type { Locale } from "./config";
import type en from "@/messages/en";

/**
 * Translations live in src/messages/<locale>/<namespace>.json; src/messages/<locale>/index.ts gathers a language's
 * namespaces. English is the source: its keys are the type every other language is checked against
 * (scripts/i18n/check-messages.mjs) and what `useTranslations` keys are typed with (global.d.ts).
 */
export type Messages = typeof en;

export async function loadMessages(locale: Locale): Promise<Messages> {
  switch (locale) {
    default:
      return (await import("@/messages/en")).default;
  }
}
