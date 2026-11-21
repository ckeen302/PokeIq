"use client";

import { forwardRef, type ComponentProps } from "react";
import { useLocale } from "@/i18n/locale-context";
import { localeHref } from "@/i18n/href";

/**
 * A plain <a> (a full page load, no client navigation) whose site path goes to the page's language version when
 * there is one. On an English page it is exactly the <a> it replaces.
 */
const Anchor = forwardRef<HTMLAnchorElement, ComponentProps<"a">>(function Anchor({ href, ...props }, ref) {
  const locale = useLocale();
  return <a ref={ref} href={href === undefined ? href : localeHref(href, locale).href} {...props} />;
});

export default Anchor;
