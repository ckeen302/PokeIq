"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

/**
 * The path a page's HTML was rendered for, on the header's nav (SiteNav). It differs from the address only on the
 * prebuilt 404: a missing page under a route with a fixed list (/pokedex/moves/zzz, /quiz/zzz) is served the one
 * 404 page built for "/_not-found". Hydrating that page with the address's path would light a nav tab the HTML
 * doesn't have, and React throws the server HTML away (error #418).
 */
export const SERVED_PATH_ATTR = "data-served-path";

let served: string | null | undefined;

/** The served path when it isn't the address's (read once, from the page's own HTML), else null. */
function servedPath(): string | null {
  if (served === undefined) {
    const path = typeof document === "undefined" ? null : document.querySelector(`[${SERVED_PATH_ATTR}]`)?.getAttribute(SERVED_PATH_ATTR);
    served = path && path !== window.location.pathname ? path : null;
  }
  return served;
}

const subscribe = () => () => {};
const none = () => null;

/** next/navigation's usePathname, except while hydrating a page served for another path (then that path, as the HTML has it). */
export function useServedPathname(): string {
  const path = usePathname();
  // The server snapshot is what hydration reads; right after it React renders again with the address's path.
  return useSyncExternalStore(subscribe, none, servedPath) ?? path;
}
