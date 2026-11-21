"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, LIVE_OTHER_LOCALES, type Locale } from "@/i18n/config";
import { RouteSlot } from "./RouteSlot";

/**
 * The language of the page under the root layout, from its first URL segment: a live language's code
 * (/es/...) or English. The segment, not the pathname, so a 404 page served at any address reads the same on the
 * server and in the browser.
 */
function useRootLocale(): Locale {
  const segment = useSelectedLayoutSegment();
  return (LIVE_OTHER_LOCALES as readonly (string | null)[]).includes(segment) ? (segment as Locale) : DEFAULT_LOCALE;
}

/** The document's <html>, with the page's language in `lang`. */
export function HtmlRoot({ className, children }: { className: string; children: ReactNode }) {
  return (
    <html lang={useRootLocale()} className={className} suppressHydrationWarning>
      {children}
    </html>
  );
}

/**
 * English pages get the root layout's header, <main> and footer; a page in another language gets none of them,
 * because its own layout (app/[locale]) draws them in its language.
 */
export function ChromeGate({ before, after, children }: { before: ReactNode; after: ReactNode; children: ReactNode }) {
  if (useRootLocale() !== DEFAULT_LOCALE) return children;
  return (
    <>
      {before}
      <main className={MAIN_CLASS}>
        <RouteSlot>{children}</RouteSlot>
      </main>
      {after}
    </>
  );
}

export const MAIN_CLASS = "container flex-1 pb-28 pt-8 max-md:pb-12 max-md:pt-6 lg:pb-12";
