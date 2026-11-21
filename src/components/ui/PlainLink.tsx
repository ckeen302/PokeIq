"use client";

import NextLink from "next/link";
import { forwardRef, type ComponentProps } from "react";
import { anchorProps, useLocaleProps } from "./Link";

/**
 * next/link exactly (Next's own prefetching on every screen), with a site path sent to the page's language.
 * For the pages that always used next/link directly; ui/Link adds the phone prefetch rules on top.
 */
const PlainLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function PlainLink(rest, ref) {
  const props = useLocaleProps(rest);
  if (process.env.LIVE_LOCALES && props["data-locale-exit"]) return <a ref={ref} {...anchorProps(props)} />;
  return <NextLink ref={ref} {...props} />;
});

export default PlainLink;
