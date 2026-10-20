"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `run` now and then every `ms` while the tab is visible (paused while
 * it's hidden, run again on coming back). `ms` null stops polling.
 */
export function useVisiblePoll(run: () => void | Promise<void>, ms: number | null) {
  const fn = useRef(run);
  fn.current = run;
  useEffect(() => {
    if (ms === null) return;
    let timer: number | undefined;
    let stopped = false;
    const tick = async () => {
      window.clearTimeout(timer);
      if (stopped || document.visibilityState !== "visible") return;
      await fn.current();
      if (!stopped) timer = window.setTimeout(tick, ms);
    };
    const onVisible = () => document.visibilityState === "visible" && void tick();
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms]);
}
