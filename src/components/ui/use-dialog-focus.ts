"use client";

import { useEffect, useRef } from "react";

/**
 * A pop-up's keyboard handling: while it's open the focus is on its close
 * button (the ref), Escape closes it, and closing gives the focus back to
 * where it was.
 */
export function useDialogFocus(onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [onClose]);
  return closeRef;
}
