"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";

/**
 * The page's language, for client components. English pages render no provider at all (the default is English);
 * the /<lang>/ layout provides its language.
 */
const LocaleContext = /*#__PURE__*/ createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

function useContextLocale(): Locale {
  return useContext(LocaleContext);
}

const english = (): Locale => DEFAULT_LOCALE;

/** English-only builds (LIVE_LOCALES inlined as ""): every page is English, and none of this reaches the browser. */
export const useLocale: () => Locale = process.env.LIVE_LOCALES ? useContextLocale : english;
