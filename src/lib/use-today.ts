"use client";

import { useEffect, useState } from "react";
import { localDateString } from "./daily";

function msUntilLocalMidnight(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * The player's local date (YYYY-MM-DD), or null until mounted, so prerendered
 * HTML never bakes in the build day. Rolls over at local midnight and when a
 * backgrounded tab comes back on a new day.
 */
export function useToday(): string | null {
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const sync = () => {
      setToday(localDateString());
      clearTimeout(timer);
      timer = setTimeout(sync, msUntilLocalMidnight() + 1000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return today;
}
