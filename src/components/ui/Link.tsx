"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, useRef, type ComponentProps } from "react";
import { PHONE_QUERY } from "@/lib/phone";
import { anchorProps, useLocaleProps } from "@/i18n/link-props";

/** Read once, when the page loads in the browser (the server never prefetches, so it needs no answer). */
const PHONE = typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;

/**
 * How long the pointer rests on a link before its page is fetched: a pointer passing over a list on its way
 * elsewhere fetches nothing, and a click (which comes a few hundred milliseconds after the pointer arrives)
 * still finds the page ready.
 */
const HOVER_MS = 60;

/**
 * next/link, fetching a page when someone is about to open it rather than as soon as its link shows.
 *
 * Wider screens: when the pointer rests on the link or it gets keyboard focus. Next's own prefetching fetched every
 * link in view, with its scripts: on a desktop that was over 100 KB after every page load for the header alone, and
 * megabytes on a page of links (a move's learners, the Pokédex's lists), all competing with the page itself.
 * Pages rendered per request (the leaderboard, profiles, the battle ladder) gain the most: prefetching one ran a
 * server function for every page view that merely showed the link.
 *
 * Phones: when the link is touched. A phone shows a long column of links (the Pokédex, the move list, the tab bar's
 * pages) and prefetching each one made a phone's first visit cost several times the requests of the page itself.
 *
 * A link given an explicit `prefetch` keeps Next's own behaviour.
 */
const Link = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function Link({ prefetch, onTouchStart, ...rest }, ref) {
  const router = useRouter();
  const timer = useRef(0);
  // LIVE_LOCALES is a build-time constant, so the hook is called on every render or on none.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const props = process.env.LIVE_LOCALES ? useLocaleProps(rest) : (rest as ReturnType<typeof useLocaleProps<typeof rest>>);
  const href = typeof props.href === "string" ? props.href : null;
  // A link that leaves the page's language (to a page not translated into it) is an ordinary link: a full page load.
  if (process.env.LIVE_LOCALES && props["data-locale-exit"]) return <a ref={ref} onTouchStart={onTouchStart} {...anchorProps(props)} />;
  if (prefetch !== undefined || !href || !href.startsWith("/")) return <NextLink ref={ref} prefetch={prefetch} onTouchStart={onTouchStart} {...props} />;
  const warm = () => router.prefetch(href);
  if (PHONE)
    return (
      <NextLink
        ref={ref}
        prefetch={false}
        onTouchStart={(e) => {
          warm();
          onTouchStart?.(e);
        }}
        {...props}
      />
    );
  return (
    <NextLink
      ref={ref}
      prefetch={false}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
      {...props}
      onMouseEnter={(e) => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(warm, HOVER_MS);
        props.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        window.clearTimeout(timer.current);
        props.onMouseLeave?.(e);
      }}
      onFocus={(e) => {
        warm();
        props.onFocus?.(e);
      }}
    />
  );
});

export default Link;
