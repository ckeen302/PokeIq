"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "@/i18n/navigation";

const subscribe = () => () => {};

/**
 * The path the nav lights its tab from. The site's 404 is one page prerendered for every missing address, so its
 * HTML lights no tab; while that page hydrates the nav lights none either (else React throws a hydration mismatch
 * on /pokedex/…, /quiz/…, any address under a tab), then lights the tab for the address it is at.
 */
export function useNavPathname(): string {
  const pathname = usePathname();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  if (!hydrated && typeof document !== "undefined" && document.querySelector("[data-not-found]")) return "";
  return pathname;
}
