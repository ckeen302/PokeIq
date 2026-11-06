"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, type ComponentProps } from "react";
import { PHONE_QUERY } from "@/lib/phone";

/** Read once, when the page loads in the browser (the server never prefetches, so it needs no answer). */
const PHONE = typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;

/**
 * next/link, except on phones: there a link fetches its page when it's
 * touched, not as soon as it scrolls into view. A phone shows a long column of
 * links (the Pokédex, the move list, the tab bar's pages) and prefetching each
 * one, with its scripts, made a phone's first visit cost several times the
 * requests of the page itself. Wider screens keep Next's usual prefetching.
 */
const Link = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function Link({ prefetch, onTouchStart, ...props }, ref) {
  const router = useRouter();
  if (!PHONE || prefetch !== undefined) return <NextLink ref={ref} prefetch={prefetch} onTouchStart={onTouchStart} {...props} />;
  const href = typeof props.href === "string" ? props.href : null;
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
