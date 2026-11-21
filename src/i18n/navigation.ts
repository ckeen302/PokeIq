"use client";

import { usePathname as useNextPathname, useRouter as useNextRouter } from "next/navigation";
import { useMemo } from "react";
import { useLocale } from "./locale-context";
import { stripLocale } from "./paths";
import { localeHref } from "./href";
import { DEFAULT_LOCALE } from "./config";

export { localeHref } from "./href";

export { useLocale } from "./locale-context";

/** The current page's English path, whatever language it is shown in ("/es/pokedle" → "/pokedle"). */
export function usePathname(): string {
  return stripLocale(useNextPathname());
}

/** next/navigation's router, with English paths sent to the current language's version of the page. */
export function useRouter(): ReturnType<typeof useNextRouter> {
  const router = useNextRouter();
  const locale = useLocale();
  return useMemo(() => {
    if (locale === DEFAULT_LOCALE) return router;
    const go = (method: "push" | "replace") => (href: string, options?: Parameters<typeof router.push>[1]) => {
      const to = localeHref(href, locale);
      if (to.external) window.location.assign(to.href);
      else router[method](to.href, options);
    };
    return { ...router, push: go("push"), replace: go("replace"), prefetch: (href: string, options?: Parameters<typeof router.prefetch>[1]) => router.prefetch(localeHref(href, locale).href, options) };
  }, [router, locale]);
}
