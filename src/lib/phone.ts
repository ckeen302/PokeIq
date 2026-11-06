"use client";

import { useEffect, useState } from "react";

/** Phones: below Tailwind's `md` breakpoint, where the bottom tab bar shows and layouts stack. */
export const PHONE_QUERY = "(max-width: 767.98px)";

export function isPhone(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
}

/**
 * A search box's placeholder without its keyboard hint ("…  ( / )") on phones,
 * where there is no "/" key to press and the hint only
 * crowds the text (or `phone`, a shorter text that fits a phone's narrower box). The server and the first render keep the full text, so
 * wider screens never change.
 */
export function usePlaceholder(text: string, phone?: string): string {
  const [short, setShort] = useState(false);
  useEffect(() => {
    if (isPhone()) setShort(true);
  }, []);
  return short ? (phone ?? text.replace(/\s*\(\s*\/\s*\)\s*$/, "")) : text;
}
