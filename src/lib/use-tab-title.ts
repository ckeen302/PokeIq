"use client";

import { useEffect, useRef } from "react";

/**
 * Names what's on screen in the tab's title ("Pikachu in 3D · Professor's Lab · PokéIQ"), in front of the page's
 * own title, while `prefix` is set. Next re-renders the head's title when the address is rewritten
 * (history.replaceState), which would put the page's title back: the title is set again whenever that happens.
 */
export function useTabTitle(prefix: string | null) {
  const base = useRef<string | null>(null);
  useEffect(() => {
    if (!prefix) return;
    base.current ??= document.title;
    const want = `${prefix} · ${base.current}`;
    const apply = () => {
      if (document.title !== want) document.title = want;
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      mo.disconnect();
      if (base.current) document.title = base.current;
    };
  }, [prefix]);
}
