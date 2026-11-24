// i18n/navigation as an English-only build has it (next.config swaps this file in while no other language is live):
// next/navigation's own hooks, what the components imported before languages existed (the path as served, see served-path).
import { DEFAULT_LOCALE, type Locale } from "./config";

export { useRouter } from "next/navigation";
export { useServedPathname as usePathname } from "./served-path";
export { localeHref } from "./href";

export const useLocale = (): Locale => DEFAULT_LOCALE;
