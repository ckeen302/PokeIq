"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, type ComponentProps } from "react";
import { PHONE_QUERY } from "@/lib/phone";
import { anchorProps, useLocaleProps } from "@/i18n/link-props";
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
  // LIVE_LOCALES is a build-time constant, so the hook is called on every render or on none.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const props = process.env.LIVE_LOCALES ? useLocaleProps(rest) : (rest as ReturnType<typeof useLocaleProps<typeof rest>>);
  const href = typeof props.href === "string" ? props.href : null;
  // A link that leaves the page's language (to a page not translated into it) is an ordinary link: a full page load.
  if (process.env.LIVE_LOCALES && props["data-locale-exit"]) return <a ref={ref} onTouchStart={onTouchStart} {...anchorProps(props)} />;
  if (!PHONE && prefetch === undefined && href && PER_REQUEST.test(process.env.LIVE_LOCALES ? stripLocale(href) : href)) {
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

export default Link;
