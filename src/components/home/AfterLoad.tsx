"use client";

import { useEffect, useState } from "react";

/**
 * True once the page has finished loading (its picture above the fold
 * included), so what's fetched next never competes with the first screen on a
 * slow phone connection.
 */
export function useAfterLoad(): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (document.readyState === "complete") {
      setLoaded(true);
      return;
    }
    const done = () => setLoaded(true);
    window.addEventListener("load", done, { once: true });
    return () => window.removeEventListener("load", done);
  }, []);
  return loaded;
}

/** Its children (pictures further down the page) only once the page has loaded. */
export function AfterLoad({ children }: { children: React.ReactNode }) {
  return useAfterLoad() ? children : null;
}
