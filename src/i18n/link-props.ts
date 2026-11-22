import type NextLink from "next/link";
import type { ComponentProps } from "react";
import { useLocale } from "./locale-context";
import { localeHref } from "./href";

// For ui/Link and ui/PlainLink. Kept out of those "use client" modules, whose every export reaches the browser,
// so an English-only build drops all of it.

type LinkProps = ComponentProps<typeof NextLink>;

/** The props with a site path sent to the page's language (English pages: unchanged, the same object). */
function useLiveLocaleProps<P extends { href: ComponentProps<typeof NextLink>["href"] }>(props: P): P & { "data-locale-exit"?: true } {
  const locale = useLocale();
  if (locale === "en" || typeof props.href !== "string") return props;
  const to = localeHref(props.href, locale);
  return to.external ? { ...props, href: to.href, "data-locale-exit": true } : { ...props, href: to.href };
}

const same = <P,>(props: P) => props as P & { "data-locale-exit"?: true };

/** English-only builds (LIVE_LOCALES inlined as ""): the props as given, and none of the language code in the browser. */
export const useLocaleProps: <P extends { href: ComponentProps<typeof NextLink>["href"] }>(props: P) => P & { "data-locale-exit"?: true } = process.env.LIVE_LOCALES
  ? useLiveLocaleProps
  : same;

/** next/link's own props, which a plain <a> doesn't take. */
const LINK_ONLY = ["prefetch", "replace", "scroll", "shallow", "passHref", "legacyBehavior", "locale", "onNavigate", "data-locale-exit"];

export function anchorProps(props: LinkProps & { "data-locale-exit"?: true }): ComponentProps<"a"> {
  const a: Record<string, unknown> = { ...props, href: String(props.href) };
  for (const k of LINK_ONLY) delete a[k];
  return a as ComponentProps<"a">;
}

