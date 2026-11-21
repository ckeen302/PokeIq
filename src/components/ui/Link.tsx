"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, type ComponentProps } from "react";
import { PHONE_QUERY } from "@/lib/phone";
import { useLocale } from "@/i18n/locale-context";
import { localeHref } from "@/i18n/href";
import { stripLocale } from "@/i18n/paths";

/** Read once, when the page loads in the browser (the server never prefetches, so it needs no answer). */
const PHONE = typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;

/**
 * Pages rendered per request (the leaderboard, profiles, the TCG search page,
 * the battle ladder). Prefetching one runs a server function for every page
 * view that merely shows the link (the nav's trophy is on every page), and
 * all it gets is the page's loading screen. These are fetched when the
 * pointer or focus reaches the link instead, still before the click.
 */
const PER_REQUEST = /^\/(?:leaderboard|u\/|pokedex\/tcg(?:\?|$)|battle\/(?:ladder|insights))/;

/**
 * next/link, except on phones: there a link fetches its page when it's
 * touched, not as soon as it scrolls into view. A phone shows a long column of
 * links (the Pokédex, the move list, the tab bar's pages) and prefetching each
 * one, with its scripts, made a phone's first visit cost several times the
 * requests of the page itself. Wider screens keep Next's usual prefetching.
 */
const Link = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function Link({ prefetch, onTouchStart, ...rest }, ref) {
  const router = useRouter();
  const props = useLocaleProps(rest);
  const href = typeof props.href === "string" ? props.href : null;
  // A link that leaves the page's language (to a page not translated into it) is an ordinary link: a full page load.
  if (props["data-locale-exit"]) return <a ref={ref} onTouchStart={onTouchStart} {...anchorProps(props)} />;
  if (!PHONE && prefetch === undefined && href && PER_REQUEST.test(stripLocale(href))) {
    const warm = () => router.prefetch(href);
    return (
      <NextLink
        ref={ref}
        prefetch={false}
        onTouchStart={onTouchStart}
        {...props}
        onMouseEnter={(e) => {
          warm();
          props.onMouseEnter?.(e);
        }}
        onFocus={(e) => {
          warm();
          props.onFocus?.(e);
        }}
      />
    );
  }
  if (!PHONE || prefetch !== undefined) return <NextLink ref={ref} prefetch={prefetch} onTouchStart={onTouchStart} {...props} />;
  return (
    <NextLink
      ref={ref}
      prefetch={false}
      onTouchStart={(e) => {
        if (href && href.startsWith("/")) router.prefetch(href);
        onTouchStart?.(e);
      }}
      {...props}
    />
  );
});

type LinkProps = ComponentProps<typeof NextLink>;

/** The props with a site path sent to the page's language (English pages: unchanged, the same object). */
export function useLocaleProps<P extends { href: ComponentProps<typeof NextLink>["href"] }>(props: P): P & { "data-locale-exit"?: true } {
  const locale = useLocale();
  if (locale === "en" || typeof props.href !== "string") return props;
  const to = localeHref(props.href, locale);
  return to.external ? { ...props, href: to.href, "data-locale-exit": true } : { ...props, href: to.href };
}

/** next/link's own props, which a plain <a> doesn't take. */
const LINK_ONLY = ["prefetch", "replace", "scroll", "shallow", "passHref", "legacyBehavior", "locale", "onNavigate", "data-locale-exit"];

export function anchorProps(props: LinkProps & { "data-locale-exit"?: true }): ComponentProps<"a"> {
  const a: Record<string, unknown> = { ...props, href: String(props.href) };
  for (const k of LINK_ONLY) delete a[k];
  return a as ComponentProps<"a">;
}

export default Link;
