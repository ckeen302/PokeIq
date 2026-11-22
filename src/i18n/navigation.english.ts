// i18n/navigation as an English-only build has it (next.config swaps this file in while no other language is live):
// next/navigation's own hooks, exactly what the components imported before languages existed.
import { DEFAULT_LOCALE, type Locale } from "./config";

export { usePathname, useRouter } from "next/navigation";
export { localeHref } from "./href";

export const useLocale = (): Locale => DEFAULT_LOCALE;
