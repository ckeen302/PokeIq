"use client";

import { useRouter as useNextRouter } from "next/navigation";
import { useMemo } from "react";
import { useLocale } from "./locale-context";
import { stripLocale } from "./paths";
import { localeHref } from "./href";
import { DEFAULT_LOCALE } from "./config";
import { useServedPathname } from "./served-path";

export { localeHref } from "./href";

export { useLocale } from "./locale-context";

/** The current page's English path, whatever language it is shown in ("/es/pokedle" → "/pokedle"). */
function useEnglishPath(): string {
  return stripLocale(useServedPathname());
}

/** next/navigation's router, with English paths sent to the current language's version of the page. */
function useLocaleRouter(): ReturnType<typeof useNextRouter> {
  const router = useNextRouter();
  const locale = useLocale();
  return useMemo(() => {
    if (!process.env.LIVE_LOCALES || locale === DEFAULT_LOCALE) return router;
    const go = (method: "push" | "replace") => (href: string, options?: Parameters<typeof router.push>[1]) => {
      const to = localeHref(href, locale);
      if (to.external) window.location.assign(to.href);
      else router[method](to.href, options);
    };
    return { ...router, push: go("push"), replace: go("replace"), prefetch: (href: string, options?: Parameters<typeof router.prefetch>[1]) => router.prefetch(localeHref(href, locale).href, options) };
  }, [router, locale]);
}

// English-only builds (LIVE_LOCALES inlined as ""): next/navigation's hooks (the path as served, see served-path).
export const usePathname: () => string = process.env.LIVE_LOCALES ? useEnglishPath : useServedPathname;
export const useRouter: typeof useNextRouter = process.env.LIVE_LOCALES ? useLocaleRouter : useNextRouter;
